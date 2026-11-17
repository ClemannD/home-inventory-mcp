/** Entries: receipts, service records, notes, and any other type in shared/entry-types.ts. */
import type { Entry, EntrySummary, FieldValues } from "../../shared/api";
import { entryType } from "../../shared/entry-types";
import type { EntryInput, EntryPatch } from "../../shared/schemas";
import { all, first, iso, newId, parseJson, run } from "../db";
import type { Env } from "../env";
import { deleteStoredFiles, listFiles } from "./files";
import { indexEntry, matchingIds, removeFromIndex } from "./search";

interface EntryRow {
  id: string;
  type: string;
  title: string;
  item_id: string | null;
  item_name: string | null;
  occurred_on: string | null;
  notes: string | null;
  fields: string;
  source: "manual" | "email" | "mcp";
  created_at: number;
  updated_at: number;
  file_count: number;
}

const SELECT = `SELECT entries.*, items.name AS item_name,
  (SELECT count(*) FROM files WHERE files.entry_id = entries.id) AS file_count
  FROM entries LEFT JOIN items ON items.id = entries.item_id`;

const toSummary = (row: EntryRow): EntrySummary => ({
  id: row.id,
  type: row.type,
  title: row.title,
  item_id: row.item_id,
  item_name: row.item_name,
  occurred_on: row.occurred_on,
  fields: parseJson<FieldValues>(row.fields, {}),
  file_count: row.file_count,
  source: row.source,
  created_at: iso(row.created_at)!
});

/**
 * Coerces values for the type's declared fields: money and number to numbers,
 * list to string arrays (a string is split on new lines and commas). Other
 * keys are kept as given. Empty values are dropped.
 */
export const normalizeFields = (type: string, fields: FieldValues): FieldValues => {
  const defs = new Map((entryType(type)?.fields ?? []).map((f) => [f.key, f]));
  const out: FieldValues = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    const def = defs.get(key);
    if (def?.kind === "money" || def?.kind === "number") {
      const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(n)) out[key] = def.kind === "money" ? Math.round(n * 100) / 100 : n;
    } else if (def?.kind === "list") {
      const list = (Array.isArray(value) ? value : String(value).split(/[\n,]/)).map((s) => s.trim()).filter(Boolean);
      if (list.length) out[key] = list;
    } else {
      out[key] = value;
    }
  }
  return out;
};

export interface EntryFilters {
  readonly type?: string;
  readonly itemId?: string;
  readonly q?: string;
  readonly limit?: number;
}

export const listEntries = async (env: Env, filters: EntryFilters): Promise<EntrySummary[]> => {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.type) (where.push("entries.type = ?"), params.push(filters.type));
  if (filters.itemId) (where.push("entries.item_id = ?"), params.push(filters.itemId));
  if (filters.q?.trim()) {
    const ids = await matchingIds(env.DB, filters.q, "entry");
    if (!ids.size) return [];
    where.push("entries.id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify([...ids]));
  }
  const rows = await all<EntryRow>(
    env.DB,
    `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY coalesce(entries.occurred_on, date(entries.created_at / 1000, 'unixepoch')) DESC, entries.created_at DESC LIMIT ?`,
    ...params,
    Math.min(filters.limit ?? 500, 1000)
  );
  return rows.map(toSummary);
};

export const getEntry = async (env: Env, id: string): Promise<Entry | null> => {
  const row = await first<EntryRow>(env.DB, `${SELECT} WHERE entries.id = ?`, id);
  if (!row) return null;
  return { ...toSummary(row), notes: row.notes, files: await listFiles(env, { entryId: id }), updated_at: iso(row.updated_at)! };
};

export const createEntry = async (
  env: Env,
  input: EntryInput,
  userId: string | null,
  source: "manual" | "email" | "mcp"
): Promise<Entry> => {
  const id = newId("ent");
  const now = Date.now();
  await run(
    env.DB,
    `INSERT INTO entries (id, type, title, item_id, occurred_on, notes, fields, source, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.type,
    input.title,
    input.item_id || null,
    input.occurred_on ?? null,
    input.notes ?? null,
    JSON.stringify(normalizeFields(input.type, input.fields ?? {})),
    source,
    now,
    now,
    userId
  );
  await indexEntry(env.DB, id);
  return (await getEntry(env, id))!;
};

/** Applies `patch`. `fields` is merged key by key; a null value removes that key. */
export const updateEntry = async (env: Env, id: string, patch: EntryPatch): Promise<Entry | null> => {
  const row = await first<EntryRow>(env.DB, "SELECT * FROM entries WHERE id = ?", id);
  if (!row) return null;
  const type = patch.type ?? row.type;
  const values: Record<string, unknown> = {};
  if (patch.type !== undefined) values.type = patch.type;
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.item_id !== undefined) values.item_id = patch.item_id || null;
  if (patch.occurred_on !== undefined) values.occurred_on = patch.occurred_on;
  if (patch.notes !== undefined) values.notes = patch.notes;
  if (patch.fields !== undefined || patch.type !== undefined) {
    const merged: FieldValues = { ...parseJson<FieldValues>(row.fields, {}), ...(patch.fields ?? {}) };
    values.fields = JSON.stringify(normalizeFields(type, merged));
  }
  values.updated_at = Date.now();
  const keys = Object.keys(values);
  await run(env.DB, `UPDATE entries SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...Object.values(values), id);
  await indexEntry(env.DB, id);
  return getEntry(env, id);
};

/** Deletes the entry and its files, from R2 too. */
export const deleteEntry = async (env: Env, id: string): Promise<boolean> => {
  const files = await all<{ id: string; r2_key: string | null }>(env.DB, "SELECT id, r2_key FROM files WHERE entry_id = ?", id);
  const result = await run(env.DB, "DELETE FROM entries WHERE id = ?", id);
  if (!result.meta.changes) return false;
  await deleteStoredFiles(env, files);
  await removeFromIndex(env.DB, id, ...files.map((f) => f.id));
  return true;
};

export const entryExists = async (env: Env, id: string): Promise<boolean> => !!(await first(env.DB, "SELECT 1 FROM entries WHERE id = ?", id));

export const entryCounts = async (env: Env): Promise<Record<string, number>> => {
  const rows = await all<{ type: string; n: number }>(env.DB, "SELECT type, count(*) AS n FROM entries GROUP BY type");
  return Object.fromEntries(rows.map((r) => [r.type, r.n]));
};
