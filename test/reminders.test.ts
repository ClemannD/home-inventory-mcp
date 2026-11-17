/** The daily cron: which warranties get a reminder, and the email that goes out. */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, today, warrantyStatus } from "../shared/dates";
import type { Env } from "../worker/env";
import { sendWarrantyReminders, warrantiesToRemind } from "../worker/reminders";

const day = today("America/New_York");

const seed = async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, role, created_at) VALUES ('usr_a', 'a@example.com', 'owner', 0), ('usr_b', 'b@example.com', 'member', 0)"),
    env.DB.prepare("INSERT INTO items (id, name, created_at, updated_at) VALUES ('itm_tv', 'TV', 0, 0), ('itm_dw', 'Dishwasher', 0, 0), ('itm_old', 'Old fridge', 0, 0)"),
    env.DB.prepare("UPDATE items SET archived = 1 WHERE id = 'itm_old'"),
    env.DB.prepare(
      `INSERT INTO warranties (id, item_id, provider, ends_on, created_at, updated_at) VALUES
       ('w1', 'itm_tv', 'LG', ?, 0, 0), ('w2', 'itm_dw', 'Bosch', ?, 0, 0), ('w3', 'itm_dw', 'Store plan', ?, 0, 0), ('w4', 'itm_old', 'GE', ?, 0, 0)`
    ).bind(addDays(day, 30), addDays(day, 7), addDays(day, 10), addDays(day, 7))
  ]);
};

describe("warranty reminders", () => {
  beforeAll(seed);

  it("picks warranties ending in exactly 30 or 7 days on current items", async () => {
    const due = await warrantiesToRemind(env, day);
    expect(due.map((w) => [w.item_name, w.provider])).toEqual([
      ["Dishwasher", "Bosch"],
      ["TV", "LG"]
    ]);
  });

  it("emails every member one message", async () => {
    const sent: { to: unknown; subject: string }[] = [];
    const withMail = {
      ...env,
      EMAIL_FROM: "Home Inventory <inventory@example.com>",
      EMAIL: { send: async (m: { to: unknown; subject: string }) => (sent.push(m), { messageId: "1" }) }
    } as unknown as Env;
    expect(await sendWarrantyReminders(withMail)).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["a@example.com", "b@example.com"], subject: "2 warranties ending soon" });
  });

  it("sends nothing without an email binding", async () => {
    expect(await sendWarrantyReminders(env)).toBe(0);
  });
});

describe("warranty status", () => {
  it("covers each state", () => {
    expect(warrantyStatus({ starts_on: null, ends_on: null }, "2026-01-10")).toEqual({ status: "lifetime", days_left: null });
    expect(warrantyStatus({ starts_on: null, ends_on: "2026-01-09" }, "2026-01-10")).toEqual({ status: "expired", days_left: -1 });
    expect(warrantyStatus({ starts_on: null, ends_on: "2026-01-10" }, "2026-01-10")).toEqual({ status: "expiring", days_left: 0 });
    expect(warrantyStatus({ starts_on: null, ends_on: "2026-02-09" }, "2026-01-10")).toEqual({ status: "expiring", days_left: 30 });
    expect(warrantyStatus({ starts_on: null, ends_on: "2026-02-10" }, "2026-01-10")).toEqual({ status: "active", days_left: 31 });
    expect(warrantyStatus({ starts_on: "2026-02-01", ends_on: "2027-02-01" }, "2026-01-10")).toEqual({ status: "not_started", days_left: 387 });
  });

  it("uses the calendar date in the configured time zone", () => {
    // 03:00 UTC on Jan 10 is still Jan 9 in New York.
    expect(today("America/New_York", new Date("2026-01-10T03:00:00Z"))).toBe("2026-01-09");
    expect(today("Not/AZone", new Date("2026-01-10T03:00:00Z"))).toBe("2026-01-10");
  });
});
