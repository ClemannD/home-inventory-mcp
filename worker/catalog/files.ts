/**
 * Files: uploads stored in R2 (photos, receipts, manuals) and plain links.
 * Text is extracted from PDFs and images with Workers AI `toMarkdown` when the
 * AI binding exists, so manuals and scanned receipts are searchable.
 */
import type { FileInfo } from "../../shared/api";
import type { FileKind } from "../../shared/entry-types";
import type { FilePatch, LinkInput } from "../../shared/schemas";
import { all, first, iso, newId, run } from "../db";
import type { Env } from "../env";
import { indexFile, removeFromIndex } from "./search";

/** Largest file accepted, in bytes. Workers request bodies are capped at 100 MB. */
export const MAX_FILE_BYTES = 95 * 1024 * 1024;
const MAX_NAME = 180;
const MAX_TEXT = 1_000_000;
/** Types `toMarkdown` converts. Images cost Workers AI usage; PDFs and documents don't. */
const AI_CONVERTIBLE = /^(application\/pdf|image\/(jpeg|png|webp)|application\/vnd\.openxmlformats-officedocument\.|application\/vnd\.oasis\.opendocument\.)/;
const PLAIN_TEXT = /^text\/(plain|csv|markdown)$/;

interface FileRow {
  id: string;
  item_id: string | null;
  entry_id: string | null;
  kind: FileKind;
  name: string;
  content_type: string | null;
  size: number | null;
  r2_key: string | null;
  url: string | null;
  text: string | null;
  text_status: FileInfo["text_status"];
  created_at: number;
}

const toInfo = (row: FileRow): FileInfo => ({
  id: row.id,
  item_id: row.item_id,
  entry_id: row.entry_id,
  kind: row.kind,
  name: row.name,
  content_type: row.content_type,
  size: row.size,
  stored: row.r2_key !== null,
  url: row.url,
  text_status: row.text_status,
  created_at: iso(row.created_at)!
});

const COLUMNS = "id, item_id, entry_id, kind, name, content_type, size, r2_key, url, text_status, created_at";

export const cleanName = (raw: string): string => {
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[/\\\u0000-\u001f\u007f]+/g, "_").trim().replace(/^\.+/, "");
  return (name || "file").slice(-MAX_NAME);
};

export const cleanType = (raw: string | null | undefined): string =>
  raw && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(raw.split(";")[0]!.trim()) ? raw.split(";")[0]!.trim().toLowerCase() : "application/octet-stream";

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean => prefix.every((b, i) => bytes[offset + i] === b);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Leading bytes each accepted type must have. */
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) => startsWith(b, ascii("%PDF-")),
  "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/gif": (b) => startsWith(b, ascii("GIF8")),
  "image/webp": (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8),
  "image/heic": (b) => startsWith(b, ascii("ftyp"), 4),
  "image/heif": (b) => startsWith(b, ascii("ftyp"), 4),
  "image/avif": (b) => startsWith(b, ascii("ftyp"), 4),
  "text/plain": (b) => !b.includes(0),
  "text/csv": (b) => !b.includes(0),
  "text/markdown": (b) => !b.includes(0)
};

export const SNIFFABLE_TYPES = Object.keys(SIGNATURES);

/**
 * Checks that `bytes` start the way `contentType` requires. Returns an error
 * message, or undefined when they match. A file rebuilt from its rendered
 * content instead of copied byte for byte usually fails this.
 */
export const checkSignature = (contentType: string, bytes: Uint8Array): string | undefined => {
  const check = SIGNATURES[contentType];
  if (!check) return `${contentType} isn't accepted. Use one of: ${SNIFFABLE_TYPES.join(", ")}`;
  if (!check(bytes)) return `the data isn't a valid ${contentType} file (its first bytes are wrong)`;
  return undefined;
};

export const listFiles = async (env: Env, where: { itemId?: string; entryId?: string }): Promise<FileInfo[]> => {
  const rows = where.itemId
    ? await all<FileRow>(env.DB, `SELECT ${COLUMNS} FROM files WHERE item_id = ? ORDER BY created_at`, where.itemId)
    : await all<FileRow>(env.DB, `SELECT ${COLUMNS} FROM files WHERE entry_id = ? ORDER BY created_at`, where.entryId);
  return rows.map(toInfo);
};

export const getFileRow = (env: Env, id: string): Promise<FileRow | null> => first<FileRow>(env.DB, "SELECT * FROM files WHERE id = ?", id);

export const getFile = async (env: Env, id: string): Promise<FileInfo | null> => {
  const row = await getFileRow(env, id);
  return row ? toInfo(row) : null;
};

export type Target = { itemId?: string | null; entryId?: string | null };

/** Checks that at most one parent is set and that it exists. Returns an error message, or undefined. */
export const checkTarget = async (env: Env, target: Target): Promise<string | undefined> => {
  if (target.itemId && target.entryId) return "attach a file to an item or an entry, not both";
  if (target.itemId && !(await first(env.DB, "SELECT 1 FROM items WHERE id = ?", target.itemId))) return `no item ${target.itemId}`;
  if (target.entryId && !(await first(env.DB, "SELECT 1 FROM entries WHERE id = ?", target.entryId))) return `no entry ${target.entryId}`;
  return undefined;
};

const textStatusFor = (env: Env, contentType: string): FileInfo["text_status"] =>
  PLAIN_TEXT.test(contentType) || (AI_CONVERTIBLE.test(contentType) && env.AI) ? "pending" : "unsupported";

export interface StoreFileInput extends Target {
  readonly body: ReadableStream | ArrayBuffer | Uint8Array;
  readonly name: string;
  readonly contentType: string;
  readonly kind: FileKind;
  readonly userId: string | null;
  /** Where the file was downloaded from, for fetched copies. */
  readonly url?: string | null;
}

/**
 * Writes the file to R2 and records it. The caller must run the returned
 * `extract` (usually in `ctx.waitUntil`) to fill in the file's text.
 */
export const storeFile = async (env: Env, input: StoreFileInput): Promise<{ file: FileInfo; extract: () => Promise<void> }> => {
  const id = newId("fil");
  const name = cleanName(input.name);
  const contentType = cleanType(input.contentType);
  const key = `files/${id}/${name}`;
  const object = await env.FILES.put(key, input.body, { httpMetadata: { contentType } });
  if (object.size > MAX_FILE_BYTES) {
    await env.FILES.delete(key);
    throw new Error("file is larger than 95 MB");
  }
  const status = textStatusFor(env, contentType);
  await run(
    env.DB,
    `INSERT INTO files (id, item_id, entry_id, kind, name, content_type, size, r2_key, url, text_status, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.itemId || null,
    input.entryId || null,
    input.kind,
    name,
    contentType,
    object.size,
    key,
    input.url ?? null,
    status,
    Date.now(),
    input.userId
  );
  await indexFile(env.DB, id);
  const file = (await getFile(env, id))!;
  return { file, extract: status === "pending" ? () => extractText(env, id) : async () => {} };
};

/** Fills in `files.text` from the stored object and re-indexes the file. Never throws. */
export const extractText = async (env: Env, id: string): Promise<void> => {
  const row = await getFileRow(env, id);
  if (!row?.r2_key || !row.content_type) return;
  try {
    const object = await env.FILES.get(row.r2_key);
    if (!object) throw new Error("object missing");
    let text: string;
    if (PLAIN_TEXT.test(row.content_type)) {
      text = await object.text();
    } else if (env.AI && AI_CONVERTIBLE.test(row.content_type)) {
      const blob = new Blob([await object.arrayBuffer()], { type: row.content_type });
      const result = await env.AI.toMarkdown({ name: row.name, blob });
      if (result.format === "error") throw new Error(result.error);
      text = result.data;
    } else {
      await run(env.DB, "UPDATE files SET text_status = 'unsupported' WHERE id = ?", id);
      return;
    }
    await run(env.DB, "UPDATE files SET text = ?, text_status = 'done' WHERE id = ?", text.slice(0, MAX_TEXT), id);
    await indexFile(env.DB, id);
  } catch (e) {
    console.error(`text extraction failed for ${id}`, e);
    await run(env.DB, "UPDATE files SET text_status = 'failed' WHERE id = ?", id);
  }
};

const nameFromUrl = (url: string): string => {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last) : new URL(url).hostname;
};

/**
 * Records a link. With `store_copy`, downloads it into R2 as well and keeps
 * the URL as the file's source.
 */
export const addLink = async (env: Env, input: LinkInput, userId: string | null): Promise<{ file: FileInfo; extract: () => Promise<void> }> => {
  const target = { itemId: input.item_id ?? null, entryId: input.entry_id ?? null };
  if (input.store_copy) {
    const response = await fetch(input.url, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { accept: "*/*" } });
    if (!response.ok || !response.body) throw new Error(`downloading the link failed: HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_FILE_BYTES) throw new Error("the linked file is larger than 95 MB");
    const contentType = cleanType(response.headers.get("content-type"));
    if (contentType === "text/html") throw new Error("the link is a web page, not a file; save it without store_copy");
    return storeFile(env, {
      ...target,
      body: await response.arrayBuffer(),
      name: input.name ?? nameFromUrl(input.url),
      contentType,
      kind: input.kind,
      userId,
      url: input.url
    });
  }
  const id = newId("fil");
  await run(
    env.DB,
    `INSERT INTO files (id, item_id, entry_id, kind, name, url, text_status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'none', ?, ?)`,
    id,
    target.itemId,
    target.entryId,
    input.kind,
    cleanName(input.name ?? nameFromUrl(input.url)),
    input.url,
    Date.now(),
    userId
  );
  await indexFile(env.DB, id);
  return { file: (await getFile(env, id))!, extract: async () => {} };
};

export const updateFile = async (env: Env, id: string, patch: FilePatch): Promise<FileInfo | null> => {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = cleanName(patch.name);
  if (patch.kind !== undefined) values.kind = patch.kind;
  if (patch.item_id !== undefined) values.item_id = patch.item_id || null;
  if (patch.entry_id !== undefined) values.entry_id = patch.entry_id || null;
  const keys = Object.keys(values);
  if (keys.length) {
    const result = await run(env.DB, `UPDATE files SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...Object.values(values), id);
    if (!result.meta.changes) return null;
    await indexFile(env.DB, id);
  }
  return getFile(env, id);
};

export const deleteStoredFiles = async (env: Env, files: readonly { r2_key: string | null }[]): Promise<void> => {
  const keys = files.map((f) => f.r2_key).filter((k): k is string => !!k);
  // R2 deletes up to 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
};

export const deleteFile = async (env: Env, id: string): Promise<boolean> => {
  const row = await first<{ r2_key: string | null }>(env.DB, "DELETE FROM files WHERE id = ? RETURNING r2_key", id);
  if (!row) return false;
  await deleteStoredFiles(env, [row]);
  await removeFromIndex(env.DB, id);
  return true;
};

/** A slice of the file's extracted text. */
export const readText = async (
  env: Env,
  id: string,
  offset: number,
  length: number
): Promise<{ file: FileInfo; text: string; offset: number; total: number; more: boolean } | null> => {
  const row = await getFileRow(env, id);
  if (!row) return null;
  const text = row.text ?? "";
  const start = Math.max(0, Math.min(offset, text.length));
  const slice = text.slice(start, start + length);
  return { file: toInfo(row), text: slice, offset: start, total: text.length, more: start + slice.length < text.length };
};
