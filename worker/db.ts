/** Thin helpers over D1. */

export type Row = Record<string, unknown>;

export const all = async <T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> =>
  (await db.prepare(sql).bind(...params).all<T>()).results;

export const first = async <T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> =>
  db.prepare(sql).bind(...params).first<T>();

export const run = async (db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> =>
  db.prepare(sql).bind(...params).run();

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A prefixed random ID such as `itm_4f9k2m7q8x1z`: 12 characters, 60 bits. */
export const newId = (prefix: string): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return `${prefix}_${out}`;
};

export const iso = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString());

export const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};
