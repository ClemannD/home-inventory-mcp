/** Calendar dates as YYYY-MM-DD strings, in a given IANA time zone. */
import type { WarrantyState } from "./api";

/** Days before `ends_on` when a warranty counts as expiring. */
export const EXPIRING_DAYS = 30;

const DAY_MS = 86_400_000;

/** Today's date in `timeZone`, e.g. "2026-11-16". Falls back to UTC for an unknown zone. */
export const today = (timeZone: string, now = new Date()): string => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
};

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const warrantyStatus = (
  w: { starts_on: string | null; ends_on: string | null },
  todayDate: string
): { status: WarrantyState; days_left: number | null } => {
  if (w.starts_on && daysBetween(todayDate, w.starts_on) > 0) {
    return { status: "not_started", days_left: w.ends_on ? daysBetween(todayDate, w.ends_on) : null };
  }
  if (!w.ends_on) return { status: "lifetime", days_left: null };
  const days = daysBetween(todayDate, w.ends_on);
  return { status: days < 0 ? "expired" : days <= EXPIRING_DAYS ? "expiring" : "active", days_left: days };
};
