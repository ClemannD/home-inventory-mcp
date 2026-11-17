/** Household members. Being in the users table is what allows an email address to sign in. */
import type { Member } from "../../shared/api";
import { all, first, iso, newId, run } from "../db";
import type { Env } from "../env";

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "member";
  created_at: number;
  last_sign_in_at: number | null;
}

export const toMember = (u: UserRow): Member => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  created_at: iso(u.created_at)!,
  last_sign_in_at: iso(u.last_sign_in_at)
});

/**
 * Creates the owner from OWNER_EMAIL when the users table is empty, and adds
 * that address to the email ingest allowlist. Does nothing once any user exists.
 */
export const ensureOwner = async (env: Env): Promise<void> => {
  const owner = env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return;
  const any = await first(env.DB, "SELECT 1 FROM users LIMIT 1");
  if (any) return;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id, email, role, created_at) VALUES (?, ?, 'owner', ?)").bind(newId("usr"), owner, now),
    env.DB.prepare("INSERT OR IGNORE INTO email_senders (address, created_at) VALUES (?, ?)").bind(owner, now)
  ]);
};

export const userByEmail = (env: Env, email: string): Promise<UserRow | null> =>
  first<UserRow>(env.DB, "SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());

export const userById = (env: Env, id: string): Promise<UserRow | null> => first<UserRow>(env.DB, "SELECT * FROM users WHERE id = ?", id);

export const listMembers = async (env: Env): Promise<Member[]> =>
  (await all<UserRow>(env.DB, "SELECT * FROM users ORDER BY role = 'owner' DESC, created_at")).map(toMember);

export const addMember = async (env: Env, email: string, name: string | null): Promise<Member> => {
  const existing = await userByEmail(env, email);
  if (existing) return toMember(existing);
  const row: UserRow = { id: newId("usr"), email, name, role: "member", created_at: Date.now(), last_sign_in_at: null };
  await run(env.DB, "INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, 'member', ?)", row.id, email, name, row.created_at);
  return toMember(row);
};

/** Removes a member and, through ON DELETE CASCADE, their passkeys and sessions. Owners can't be removed. */
export const removeMember = async (env: Env, id: string): Promise<boolean> => {
  const result = await run(env.DB, "DELETE FROM users WHERE id = ? AND role = 'member'", id);
  return result.meta.changes > 0;
};

export const renameMember = async (env: Env, id: string, name: string | null): Promise<void> => {
  await run(env.DB, "UPDATE users SET name = ? WHERE id = ?", name, id);
};
