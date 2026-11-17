/** Addresses allowed to email the ingest address. Matched against the envelope sender. */
import { all, first, iso, run } from "../db";
import type { Env } from "../env";

export interface Sender {
  readonly address: string;
  readonly created_at: string;
}

export const listSenders = async (env: Env): Promise<Sender[]> =>
  (await all<{ address: string; created_at: number }>(env.DB, "SELECT address, created_at FROM email_senders ORDER BY address")).map((s) => ({
    address: s.address,
    created_at: iso(s.created_at)!
  }));

export const addSender = async (env: Env, address: string, userId: string | null): Promise<void> => {
  await run(env.DB, "INSERT OR IGNORE INTO email_senders (address, created_at, created_by) VALUES (?, ?, ?)", address, Date.now(), userId);
};

export const removeSender = async (env: Env, address: string): Promise<boolean> =>
  (await run(env.DB, "DELETE FROM email_senders WHERE address = ?", address)).meta.changes > 0;

export const isAllowedSender = async (env: Env, address: string): Promise<boolean> =>
  !!(await first(env.DB, "SELECT 1 FROM email_senders WHERE address = ?", address.trim().toLowerCase()));
