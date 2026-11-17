/**
 * Full-text search over items, entries and file text (SQLite FTS5). Each
 * write in the catalog calls the matching `index*` function, so the index is
 * updated in the same request as the row.
 */
import type { FieldValues, SearchHit } from "../../shared/api";
import { entryType } from "../../shared/entry-types";
import { all, first, parseJson } from "../db";

/** Characters of file text kept in the index. Longer documents are cut. */
const MAX_INDEXED_TEXT = 300_000;

type Kind = SearchHit["kind"];

const fieldsText = (raw: unknown): string =>
  Object.entries(parseJson<FieldValues>(raw, {}))
    .flatMap(([key, value]) => (value == null || value === "" ? [] : [`${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.join(", ") : String(value)}`]))
    .join("\n");

const join = (...parts: unknown[]): string =>
  parts.filter((p) => p != null && p !== "").map(String).join("\n");

const replace = (db: D1Database, ref: string, kind: Kind, title: string, body: string): Promise<unknown> =>
  db.batch([
    db.prepare("DELETE FROM search_index WHERE ref = ?").bind(ref),
    db.prepare("INSERT INTO search_index (ref, kind, title, body) VALUES (?, ?, ?, ?)").bind(ref, kind, title, body)
  ]);

export const removeFromIndex = async (db: D1Database, ...refs: string[]): Promise<void> => {
  if (refs.length) await db.batch(refs.map((ref) => db.prepare("DELETE FROM search_index WHERE ref = ?").bind(ref)));
};

export const indexItem = async (db: D1Database, id: string): Promise<void> => {
  const row = await first(db, "SELECT * FROM items WHERE id = ?", id);
  if (!row) return removeFromIndex(db, id);
  const warranties = await all<{ provider: string; coverage: string | null }>(db, "SELECT provider, coverage FROM warranties WHERE item_id = ?", id);
  await replace(
    db,
    id,
    "item",
    String(row.name),
    join(
      row.category,
      row.location,
      row.brand,
      row.model,
      row.serial,
      row.retailer,
      parseJson<string[]>(row.aliases, []).join(", "),
      row.notes,
      fieldsText(row.fields),
      ...warranties.map((w) => join("warranty", w.provider, w.coverage))
    )
  );
};

export const indexEntry = async (db: D1Database, id: string): Promise<void> => {
  const row = await first<Record<string, unknown> & { item_name: string | null }>(
    db,
    "SELECT entries.*, items.name AS item_name FROM entries LEFT JOIN items ON items.id = entries.item_id WHERE entries.id = ?",
    id
  );
  if (!row) return removeFromIndex(db, id);
  await replace(db, id, "entry", String(row.title), join(entryType(String(row.type))?.singular ?? row.type, row.item_name, fieldsText(row.fields), row.notes));
};

export const indexFile = async (db: D1Database, id: string): Promise<void> => {
  const row = await first<{ name: string; kind: string; text: string | null; url: string | null }>(db, "SELECT name, kind, text, url FROM files WHERE id = ?", id);
  if (!row) return removeFromIndex(db, id);
  await replace(db, id, "file", row.name, join(row.kind, row.url, row.text?.slice(0, MAX_INDEXED_TEXT)));
};

/** Turns free text into an FTS5 query: each word as a quoted prefix term. */
export const ftsQuery = (q: string, mode: "all" | "any" = "all"): string | undefined => {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
  if (!words.length) return undefined;
  return words.map((w) => `"${w}"*`).join(mode === "all" ? " " : " OR ");
};

interface IndexHit {
  ref: string;
  kind: Kind;
  title: string;
  snippet: string;
}

const matchIndex = async (db: D1Database, q: string, kinds: readonly Kind[], limit: number): Promise<IndexHit[]> => {
  const run = (match: string) =>
    all<IndexHit>(
      db,
      `SELECT ref, kind, title, snippet(search_index, -1, '[', ']', '…', 16) AS snippet
       FROM search_index WHERE search_index MATCH ? AND kind IN (${kinds.map(() => "?").join(",")})
       ORDER BY bm25(search_index, 0, 0, 6, 1) LIMIT ?`,
      match,
      ...kinds,
      limit
    );
  const strict = ftsQuery(q, "all");
  if (!strict) return [];
  const hits = await run(strict);
  if (hits.length) return hits;
  const loose = ftsQuery(q, "any");
  return loose && loose !== strict ? run(loose) : [];
};

/** Searches the catalog. Matching words in titles rank above matches in body text. */
export const search = async (
  db: D1Database,
  q: string,
  options: { kinds?: readonly Kind[]; limit?: number } = {}
): Promise<SearchHit[]> => {
  const hits = await matchIndex(db, q, options.kinds ?? ["item", "entry", "file"], Math.min(options.limit ?? 20, 100));
  const entryIds = hits.filter((h) => h.kind === "entry").map((h) => h.ref);
  const fileIds = hits.filter((h) => h.kind === "file").map((h) => h.ref);
  const entries = new Map(
    entryIds.length
      ? (await all<{ id: string; type: string }>(db, "SELECT id, type FROM entries WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(entryIds))).map((e) => [e.id, e])
      : []
  );
  const files = new Map(
    fileIds.length
      ? (
          await all<{ id: string; kind: string; item_id: string | null; entry_id: string | null; parent_title: string | null }>(
            db,
            `SELECT files.id, files.kind, files.item_id, files.entry_id, coalesce(items.name, entries.title) AS parent_title
             FROM files LEFT JOIN items ON items.id = files.item_id LEFT JOIN entries ON entries.id = files.entry_id
             WHERE files.id IN (SELECT value FROM json_each(?))`,
            JSON.stringify(fileIds)
          )
        ).map((f) => [f.id, f])
      : []
  );
  return hits.map((h) => ({
    kind: h.kind,
    id: h.ref,
    title: h.title,
    snippet: h.snippet,
    subtype: h.kind === "entry" ? (entries.get(h.ref)?.type ?? null) : h.kind === "file" ? (files.get(h.ref)?.kind ?? null) : null,
    parent_id: h.kind === "file" ? (files.get(h.ref)?.item_id ?? files.get(h.ref)?.entry_id ?? null) : null,
    parent_title: h.kind === "file" ? (files.get(h.ref)?.parent_title ?? null) : null
  }));
};

/**
 * IDs of items or entries matching `q`, including those whose attached files
 * match (a stove matches "reset" when its manual mentions it).
 */
export const matchingIds = async (db: D1Database, q: string, kind: "item" | "entry"): Promise<Set<string>> => {
  const hits = await matchIndex(db, q, [kind, "file"], 500);
  const ids = new Set(hits.filter((h) => h.kind === kind).map((h) => h.ref));
  const fileIds = hits.filter((h) => h.kind === "file").map((h) => h.ref);
  if (fileIds.length) {
    const column = kind === "item" ? "item_id" : "entry_id";
    const parents = await all<{ parent: string | null }>(
      db,
      `SELECT ${column} AS parent FROM files WHERE id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(fileIds)
    );
    for (const p of parents) if (p.parent) ids.add(p.parent);
  }
  return ids;
};
