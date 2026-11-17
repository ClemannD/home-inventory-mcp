/**
 * One-time upload links. An assistant can't pass your attachments to a tool,
 * so `create_upload_link` returns a URL you open to pick or photograph files.
 * The token in the URL is the only credential: it works for one submission
 * and expires after an hour.
 */
import type { FileKind } from "../../shared/entry-types";
import { randomToken, sha256 } from "../auth/crypto";
import { first, run } from "../db";
import type { Env } from "../env";

export const UPLOAD_LINK_TTL_MS = 60 * 60 * 1000;

export interface UploadLink {
  readonly hash: string;
  readonly item_id: string | null;
  readonly entry_id: string | null;
  readonly kind: FileKind;
  readonly created_by: string | null;
  readonly expires_at: number;
  readonly used_at: number | null;
  /** The item's name or the entry's title. */
  readonly target_title: string;
}

export const createUploadLink = async (
  env: Env,
  target: { itemId?: string | null; entryId?: string | null },
  kind: FileKind,
  userId: string | null
): Promise<{ token: string; expiresAt: number }> => {
  const token = randomToken(24);
  const now = Date.now();
  const expiresAt = now + UPLOAD_LINK_TTL_MS;
  await run(
    env.DB,
    "INSERT INTO upload_links (hash, item_id, entry_id, kind, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    await sha256(token),
    target.itemId || null,
    target.entryId || null,
    kind,
    userId,
    now,
    expiresAt
  );
  return { token, expiresAt };
};

const SELECT = `SELECT upload_links.*, coalesce(items.name, entries.title) AS target_title
  FROM upload_links LEFT JOIN items ON items.id = upload_links.item_id LEFT JOIN entries ON entries.id = upload_links.entry_id`;

export type LinkState = { state: "ok"; link: UploadLink } | { state: "missing" | "used" | "expired" };

/** Looks up a link without using it. */
export const findUploadLink = async (env: Env, token: string): Promise<LinkState> => {
  const link = await first<UploadLink>(env.DB, `${SELECT} WHERE upload_links.hash = ?`, await sha256(token));
  if (!link) return { state: "missing" };
  if (link.used_at) return { state: "used" };
  if (link.expires_at < Date.now()) return { state: "expired" };
  return { state: "ok", link };
};

/** Marks the link used, so a second submission is refused. Returns false when it was already used or has expired. */
export const claimUploadLink = async (env: Env, hash: string): Promise<boolean> => {
  const now = Date.now();
  const result = await run(env.DB, "UPDATE upload_links SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ?", now, hash, now);
  return result.meta.changes > 0;
};

/** Makes a claimed link usable again, after a submission that saved nothing. */
export const releaseUploadLink = async (env: Env, hash: string): Promise<void> => {
  await run(env.DB, "UPDATE upload_links SET used_at = NULL WHERE hash = ?", hash);
};
