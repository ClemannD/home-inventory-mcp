/** Display formatting for money, dates and sizes. */
import type { Warranty } from "../shared/api";

export const money = (value: number | null | undefined, currency: string): string =>
  value == null ? "" : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);

/** "Nov 29, 2024" from "2024-11-29", without a time-zone shift. */
export const date = (value: string | null | undefined): string => {
  if (!value) return "";
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
};

export const bytes = (n: number | null | undefined): string => {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) (v /= 1024), u++;
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`;
};

export const warrantyLabel = (w: Pick<Warranty, "status" | "days_left" | "ends_on">): string => {
  switch (w.status) {
    case "lifetime":
      return "Lifetime";
    case "not_started":
      return "Not started";
    case "expired":
      return `Expired ${date(w.ends_on)}`;
    case "expiring":
      return w.days_left === 0 ? "Ends today" : `${w.days_left} day${w.days_left === 1 ? "" : "s"} left`;
    case "active":
      return `Until ${date(w.ends_on)}`;
  }
};

export const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).replaceAll("_", " ");
