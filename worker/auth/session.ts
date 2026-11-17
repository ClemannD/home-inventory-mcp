/**
 * Browser sessions: an opaque token in a cookie, stored in D1 as a SHA-256
 * hash. Over HTTPS the cookie is `__Host-session`, which pins it to this host
 * and path `/`. Plain-http localhost gets an unprefixed, non-Secure cookie.
 */
import { first, run } from "../db";
import type { Env } from "../env";
import { randomToken, sha256 } from "./crypto";
import type { UserRow } from "./users";

/** A session ends after this long unused. */
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** last_used_at is updated, and the cookie re-issued, at most this often. */
const SESSION_TOUCH_MS = 60 * 60 * 1000;

const cookieName = (url: URL): string => (url.protocol === "https:" ? "__Host-session" : "session");

const attributes = (url: URL, maxAgeSeconds: number): string =>
  `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${url.protocol === "https:" ? "; Secure" : ""}`;

export const readSessionToken = (request: Request, url: URL): string | undefined => {
  const name = cookieName(url);
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim() || undefined;
  }
  return undefined;
};

export const sessionCookie = (url: URL, token: string): string =>
  `${cookieName(url)}=${token}; ${attributes(url, Math.floor(SESSION_IDLE_MS / 1000))}`;

export const clearedSessionCookie = (url: URL): string => `${cookieName(url)}=; ${attributes(url, 0)}`;

/** Starts a session for `userId` and returns its token. */
export const createSession = async (env: Env, userId: string, request: Request): Promise<string> => {
  const token = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions (hash, user_id, created_at, last_used_at, user_agent) VALUES (?, ?, ?, ?, ?)").bind(
      await sha256(token),
      userId,
      now,
      now,
      request.headers.get("user-agent")?.slice(0, 300) ?? null
    ),
    env.DB.prepare("UPDATE users SET last_sign_in_at = ? WHERE id = ?").bind(now, userId)
  ]);
  return token;
};

export interface CurrentSession {
  readonly user: UserRow;
  readonly token: string;
  /** last_used_at was bumped, so the cookie should be re-issued with a fresh Max-Age. */
  readonly renewed: boolean;
}

export const currentSession = async (request: Request, env: Env, url: URL): Promise<CurrentSession | undefined> => {
  const token = readSessionToken(request, url);
  if (!token) return undefined;
  const hash = await sha256(token);
  const row = await first<UserRow & { session_last_used_at: number }>(
    env.DB,
    "SELECT users.*, sessions.last_used_at AS session_last_used_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.hash = ?",
    hash
  );
  const now = Date.now();
  if (!row || now - row.session_last_used_at > SESSION_IDLE_MS) return undefined;
  const { session_last_used_at: lastUsed, ...user } = row;
  if (now - lastUsed < SESSION_TOUCH_MS) return { user, token, renewed: false };
  await run(env.DB, "UPDATE sessions SET last_used_at = ? WHERE hash = ?", now, hash);
  return { user, token, renewed: true };
};

export const endSession = async (env: Env, token: string): Promise<void> => {
  await run(env.DB, "DELETE FROM sessions WHERE hash = ?", await sha256(token));
};

/** Deletes expired sessions, challenges, sign-in codes and upload links. Run from the daily cron. */
export const pruneAuth = async (env: Env): Promise<void> => {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE last_used_at < ?").bind(now - SESSION_IDLE_MS),
    env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM sign_in_codes WHERE expires_at < ? AND window_start < ?").bind(now, now - 60 * 60 * 1000),
    env.DB.prepare("DELETE FROM upload_links WHERE expires_at < ?").bind(now - 24 * 60 * 60 * 1000)
  ]);
};
