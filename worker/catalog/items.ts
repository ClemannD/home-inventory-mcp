/** Items: the things in the house. */
import type { Facets, FieldValues, Item, ItemDetail, ItemSummary, Warranty, WarrantyState } from "../../shared/api";
import type { ItemInput, ItemPatch } from "../../shared/schemas";
import { all, first, iso, newId, parseJson, run } from "../db";
import type { Env } from "../env";
import { listEntries } from "./entries";
import { deleteStoredFiles, listFiles } from "./files";
import { indexEntry, indexItem, matchingIds, removeFromIndex } from "./search";
import { toWarranty, type WarrantyRow } from "./warranties";

export interface ItemRow {
  id: string;
  name: string;
  category: string | null;
  location: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  purchased_on: string | null;
  price_cents: number | null;
  retailer: string | null;
  aliases: string;
  notes: string | null;
  fields: string;
  archived: number;
  created_at: number;
  updated_at: number;
  photo_id?: string | null;
}

export interface ItemFilters {
  readonly q?: string;
  readonly category?: string;
  readonly location?: string;
  readonly warranty?: WarrantyState | "none";
  /** Defaults to false: archived items are hidden. */
  readonly archived?: boolean;
  readonly limit?: number;
}

/** The warranty that lasts longest: one without an end date, else the latest end date. */
const bestWarranty = (warranties: Warranty[]): Warranty | undefined =>
  [...warranties].sort((a, b) => (a.ends_on === null ? -1 : b.ends_on === null ? 1 : b.ends_on.localeCompare(a.ends_on)))[0];

const summary = (row: ItemRow, warranties: Warranty[]): ItemSummary => {
  const w = bestWarranty(warranties);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location,
    brand: row.brand,
    model: row.model,
    purchased_on: row.purchased_on,
    archived: row.archived === 1,
    photo_id: row.photo_id ?? null,
    warranty: w ? { status: w.status, ends_on: w.ends_on, days_left: w.days_left, provider: w.provider } : null
  };
};

const toItem = (row: ItemRow, warranties: Warranty[]): Item => ({
  ...summary(row, warranties),
  serial: row.serial,
  price: row.price_cents == null ? null : row.price_cents / 100,
  retailer: row.retailer,
  aliases: parseJson<string[]>(row.aliases, []),
  notes: row.notes,
  fields: parseJson<FieldValues>(row.fields, {}),
  created_at: iso(row.created_at)!,
  updated_at: iso(row.updated_at)!
});

const PHOTO = "(SELECT id FROM files WHERE files.item_id = items.id AND files.kind = 'photo' ORDER BY created_at LIMIT 1) AS photo_id";

const warrantiesFor = async (env: Env, ids: string[], today: string): Promise<Map<string, Warranty[]>> => {
  const map = new Map<string, Warranty[]>();
  if (!ids.length) return map;
  const rows = await all<WarrantyRow>(env.DB, "SELECT * FROM warranties WHERE item_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
  for (const r of rows) {
    const list = map.get(r.item_id) ?? [];
    list.push(toWarranty(r, today));
    map.set(r.item_id, list);
  }
  return map;
};

export const listItems = async (env: Env, filters: ItemFilters, today: string): Promise<ItemSummary[]> => {
  const where: string[] = ["archived = ?"];
  const params: unknown[] = [filters.archived ? 1 : 0];
  if (filters.q?.trim()) {
    const ids = await matchingIds(env.DB, filters.q, "item");
    if (!ids.size) return [];
    where.push("id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify([...ids]));
  }
  if (filters.category) (where.push("category = ? COLLATE NOCASE"), params.push(filters.category));
  if (filters.location) (where.push("location = ? COLLATE NOCASE"), params.push(filters.location));
  const rows = await all<ItemRow>(
    env.DB,
    `SELECT items.*, ${PHOTO} FROM items WHERE ${where.join(" AND ")} ORDER BY name COLLATE NOCASE LIMIT ?`,
    ...params,
    Math.min(filters.limit ?? 1000, 1000)
  );
  const warranties = await warrantiesFor(env, rows.map((r) => r.id), today);
  const items = rows.map((r) => summary(r, warranties.get(r.id) ?? []));
  if (!filters.warranty) return items;
  return items.filter((i) => (filters.warranty === "none" ? i.warranty === null : i.warranty?.status === filters.warranty));
};

export const getItem = async (env: Env, id: string, today: string): Promise<ItemDetail | null> => {
  const row = await first<ItemRow>(env.DB, `SELECT items.*, ${PHOTO} FROM items WHERE id = ?`, id);
  if (!row) return null;
  const [warranties, files, entries] = await Promise.all([
    all<WarrantyRow>(env.DB, "SELECT * FROM warranties WHERE item_id = ? ORDER BY ends_on IS NULL, ends_on DESC", id),
    listFiles(env, { itemId: id }),
    listEntries(env, { itemId: id })
  ]);
  const ws = warranties.map((w) => toWarranty(w, today));
  return { ...toItem(row, ws), warranties: ws, files, entries };
};

export const itemExists = async (env: Env, id: string): Promise<boolean> => !!(await first(env.DB, "SELECT 1 FROM items WHERE id = ?", id));

const columns = (input: ItemPatch): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const copy = ["name", "category", "location", "brand", "model", "serial", "purchased_on", "retailer", "notes"] as const;
  for (const key of copy) if (input[key] !== undefined) out[key] = input[key] === "" ? null : input[key];
  if (input.price !== undefined) out.price_cents = input.price == null ? null : Math.round(input.price * 100);
  if (input.aliases !== undefined) out.aliases = JSON.stringify(input.aliases);
  if (input.archived !== undefined) out.archived = input.archived ? 1 : 0;
  return out;
};

export const createItem = async (env: Env, input: ItemInput, userId: string | null, today: string): Promise<ItemDetail> => {
  const id = newId("itm");
  const now = Date.now();
  const values = { ...columns(input), fields: JSON.stringify(input.fields ?? {}), id, created_at: now, updated_at: now, created_by: userId };
  const keys = Object.keys(values);
  await run(env.DB, `INSERT INTO items (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...Object.values(values));
  await indexItem(env.DB, id);
  return (await getItem(env, id, today))!;
};

/**
 * Applies `patch`. `fields` is merged key by key; a null value removes that
 * key. Returns null when the item doesn't exist.
 */
export const updateItem = async (env: Env, id: string, patch: ItemPatch, today: string): Promise<ItemDetail | null> => {
  const row = await first<ItemRow>(env.DB, "SELECT * FROM items WHERE id = ?", id);
  if (!row) return null;
  const values = columns(patch);
  if (patch.fields) {
    const merged = { ...parseJson<FieldValues>(row.fields, {}), ...patch.fields };
    for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
    values.fields = JSON.stringify(merged);
  }
  values.updated_at = Date.now();
  const keys = Object.keys(values);
  await run(env.DB, `UPDATE items SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...Object.values(values), id);
  await indexItem(env.DB, id);
  if (patch.name !== undefined && patch.name !== row.name) {
    // Linked entries index the item's name.
    for (const e of await all<{ id: string }>(env.DB, "SELECT id FROM entries WHERE item_id = ?", id)) await indexEntry(env.DB, e.id);
  }
  return getItem(env, id, today);
};

/** Deletes the item, its warranties, and its files (from R2 too). Linked entries are kept and unlinked. */
export const deleteItem = async (env: Env, id: string): Promise<boolean> => {
  const files = await all<{ id: string; r2_key: string | null }>(env.DB, "SELECT id, r2_key FROM files WHERE item_id = ?", id);
  const entries = await all<{ id: string }>(env.DB, "SELECT id FROM entries WHERE item_id = ?", id);
  const result = await run(env.DB, "DELETE FROM items WHERE id = ?", id);
  if (!result.meta.changes) return false;
  await deleteStoredFiles(env, files);
  await removeFromIndex(env.DB, id, ...files.map((f) => f.id));
  for (const e of entries) await indexEntry(env.DB, e.id);
  return true;
};

export const facets = async (env: Env): Promise<Facets> => {
  const [categories, locations] = await Promise.all([
    all<{ v: string }>(env.DB, "SELECT DISTINCT category AS v FROM items WHERE category IS NOT NULL AND archived = 0 ORDER BY v COLLATE NOCASE"),
    all<{ v: string }>(env.DB, "SELECT DISTINCT location AS v FROM items WHERE location IS NOT NULL AND archived = 0 ORDER BY v COLLATE NOCASE")
  ]);
  return { categories: categories.map((r) => r.v), locations: locations.map((r) => r.v) };
};
