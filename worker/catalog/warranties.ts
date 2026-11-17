/** Warranties belong to items. Status and days left are computed on read. */
import type { Warranty } from "../../shared/api";
import { addDays, warrantyStatus } from "../../shared/dates";
import type { WarrantyKind } from "../../shared/entry-types";
import type { WarrantyInput, WarrantyPatch } from "../../shared/schemas";
import { all, first, newId, run } from "../db";
import type { Env } from "../env";
import { indexItem } from "./search";

export interface WarrantyRow {
  id: string;
  item_id: string;
  provider: string;
  kind: string;
  starts_on: string | null;
  ends_on: string | null;
  coverage: string | null;
  contact: string | null;
  policy_number: string | null;
  notes: string | null;
}

export const toWarranty = (row: WarrantyRow, today: string): Warranty => ({
  id: row.id,
  item_id: row.item_id,
  provider: row.provider,
  kind: row.kind as WarrantyKind,
  starts_on: row.starts_on,
  ends_on: row.ends_on,
  coverage: row.coverage,
  contact: row.contact,
  policy_number: row.policy_number,
  notes: row.notes,
  ...warrantyStatus(row, today)
});

const FIELDS = ["provider", "kind", "starts_on", "ends_on", "coverage", "contact", "policy_number", "notes"] as const;

export const createWarranty = async (env: Env, itemId: string, input: WarrantyInput, today: string): Promise<Warranty | null> => {
  if (!(await first(env.DB, "SELECT 1 FROM items WHERE id = ?", itemId))) return null;
  const id = newId("wty");
  const now = Date.now();
  await run(
    env.DB,
    `INSERT INTO warranties (id, item_id, ${FIELDS.join(", ")}, created_at, updated_at) VALUES (?, ?, ${FIELDS.map(() => "?").join(", ")}, ?, ?)`,
    id,
    itemId,
    ...FIELDS.map((f) => input[f] ?? null),
    now,
    now
  );
  await indexItem(env.DB, itemId);
  return getWarranty(env, id, today);
};

export const getWarranty = async (env: Env, id: string, today: string): Promise<Warranty | null> => {
  const row = await first<WarrantyRow>(env.DB, "SELECT * FROM warranties WHERE id = ?", id);
  return row ? toWarranty(row, today) : null;
};

export const updateWarranty = async (env: Env, id: string, patch: WarrantyPatch, today: string): Promise<Warranty | null> => {
  const keys = FIELDS.filter((f) => patch[f] !== undefined);
  const row = await first<WarrantyRow>(env.DB, "SELECT * FROM warranties WHERE id = ?", id);
  if (!row) return null;
  if (keys.length) {
    await run(
      env.DB,
      `UPDATE warranties SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
      ...keys.map((k) => patch[k] ?? null),
      Date.now(),
      id
    );
    await indexItem(env.DB, row.item_id);
  }
  return getWarranty(env, id, today);
};

export const deleteWarranty = async (env: Env, id: string): Promise<boolean> => {
  const row = await first<{ item_id: string }>(env.DB, "DELETE FROM warranties WHERE id = ? RETURNING item_id", id);
  if (!row) return false;
  await indexItem(env.DB, row.item_id);
  return true;
};

export interface WarrantyListing extends Warranty {
  readonly item_name: string;
}

/**
 * Warranties on items that aren't archived, soonest end first. With
 * `endingWithinDays`, only those ending between today and that many days out.
 */
export const listWarranties = async (
  env: Env,
  today: string,
  options: { endingWithinDays?: number; includeExpired?: boolean } = {}
): Promise<WarrantyListing[]> => {
  const where = ["items.archived = 0"];
  const params: unknown[] = [];
  if (options.endingWithinDays !== undefined) {
    where.push("warranties.ends_on BETWEEN ? AND ?");
    params.push(today, addDays(today, options.endingWithinDays));
  } else if (!options.includeExpired) {
    where.push("(warranties.ends_on IS NULL OR warranties.ends_on >= ?)");
    params.push(today);
  }
  const rows = await all<WarrantyRow & { item_name: string }>(
    env.DB,
    `SELECT warranties.*, items.name AS item_name FROM warranties JOIN items ON items.id = warranties.item_id
     WHERE ${where.join(" AND ")} ORDER BY warranties.ends_on IS NULL, warranties.ends_on`,
    ...params
  );
  return rows.map((r) => ({ ...toWarranty(r, today), item_name: r.item_name }));
};
