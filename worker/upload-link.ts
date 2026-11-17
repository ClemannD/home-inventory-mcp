/**
 * The page behind a one-time upload link (worker/catalog/uploads.ts). No
 * session is needed: the token in the path is the credential.
 *
 *   GET  /u/:token   the upload form
 *   POST /u/:token   multipart form with one or more `file` fields
 *
 * Browsers get HTML pages. Other clients (anything that doesn't accept
 * text/html, such as `curl -F file=@invoice.pdf <url>`) get JSON.
 */
import { entryType, type FileKind } from "../shared/entry-types";
import { appName, type Env } from "./env";
import { first } from "./db";
import { html, json } from "./http";
import { messagePage, uploadDonePage, uploadPage } from "./pages";
import type { FileInfo } from "../shared/api";
import { MAX_FILE_BYTES, storeFile } from "./catalog/files";
import { claimUploadLink, findUploadLink, releaseUploadLink, type UploadLink } from "./catalog/uploads";

const PATH = /^\/u\/([A-Za-z0-9_-]{20,64})$/;

const unusable = (env: Env, state: "missing" | "used" | "expired", asJson: boolean): Response => {
  const text = {
    missing: ["Link not found", "Check that you opened the whole link, or ask your assistant for a new one."],
    used: ["Link already used", "Each upload link works once. Ask your assistant for a new one."],
    expired: ["Link expired", "Upload links work for an hour. Ask your assistant for a new one."]
  }[state];
  const status = state === "missing" ? 404 : 410;
  return asJson ? json({ error: `${text[0]}. ${text[1]}` }, status) : html(messagePage(appName(env), text[0]!, text[1]!), status);
};

const targetLabel = async (env: Env, link: UploadLink): Promise<string> => {
  if (link.item_id) return "item";
  const row = await first<{ type: string }>(env.DB, "SELECT type FROM entries WHERE id = ?", link.entry_id);
  return entryType(row?.type ?? "")?.singular.toLowerCase() ?? "entry";
};

/** Photos sent through a link for documents are still photos of an item; PDFs sent to a photo link are documents. */
const kindFor = (link: UploadLink, type: string): FileKind => {
  if (link.kind === "photo" && !type.startsWith("image/")) return "document";
  return link.kind;
};

export const handleUploadLink = async (request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response | undefined> => {
  const match = PATH.exec(url.pathname);
  if (!match) return undefined;
  const asJson = !(request.headers.get("accept") ?? "").includes("text/html");
  /** A page for browsers, JSON for scripts. */
  const reply = (status: number, heading: string, text: string): Response =>
    asJson ? json({ error: `${heading}. ${text}` }, status) : html(messagePage(appName(env), heading, text), status);
  const found = await findUploadLink(env, match[1]!);
  if (found.state !== "ok") return unusable(env, found.state, asJson);
  const { link } = found;

  if (request.method === "GET") {
    return html(
      uploadPage({ appName: appName(env), targetTitle: link.target_title, targetLabel: await targetLabel(env, link), expiresAt: link.expires_at })
    );
  }
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length > MAX_FILE_BYTES) {
    return reply(413, "Too large", "Uploads through a link are limited to 95 MB in total. Send fewer files at once.");
  }
  if (!(await claimUploadLink(env, link.hash))) return unusable(env, "used", asJson);

  const saved: FileInfo[] = [];
  try {
    const form = await request.formData();
    for (const value of form.getAll("file")) {
      if (typeof value === "string" || value.size === 0) continue;
      const { file, extract } = await storeFile(env, {
        itemId: link.item_id,
        entryId: link.entry_id,
        body: await value.arrayBuffer(),
        name: value.name || "upload",
        contentType: value.type,
        kind: kindFor(link, value.type),
        userId: link.created_by
      });
      ctx.waitUntil(extract());
      saved.push(file);
    }
  } catch (e) {
    console.error("upload link failed", e);
    if (!saved.length) await releaseUploadLink(env, link.hash);
    return reply(500, "Upload failed", saved.length ? `${saved.length} file(s) were saved before the error.` : "Nothing was saved. Try again.");
  }
  if (!saved.length) {
    await releaseUploadLink(env, link.hash);
    return reply(400, "No files", "Choose at least one file to upload.");
  }
  const base = (env.PUBLIC_URL || url.origin).replace(/\/$/, "");
  const openHref = link.item_id ? `${base}/items/${link.item_id}` : `${base}/entries/${link.entry_id}`;
  if (asJson) return json({ saved, target: { id: link.item_id ?? link.entry_id, title: link.target_title }, open_url: openHref }, 201);
  return html(uploadDonePage(appName(env), saved.length, link.target_title, openHref));
};
