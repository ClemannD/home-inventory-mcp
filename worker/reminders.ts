/** The daily cron: warranty reminder emails and cleanup. */
import { addDays, today as todayIn } from "../shared/dates";
import { pruneAuth } from "./auth/session";
import { all } from "./db";
import { appName, timezone, type Env } from "./env";
import { escapeHtml } from "./http";
import { canSendMail, mailHtml, sendMail } from "./mail";

/** Reminders go out when a warranty is this many days from ending. */
export const REMINDER_DAYS = [30, 7] as const;

interface Ending {
  item_id: string;
  item_name: string;
  provider: string;
  ends_on: string;
}

/** Warranties on current items that end exactly 30 or 7 days after `today`. */
export const warrantiesToRemind = (env: Env, today: string): Promise<Ending[]> =>
  all<Ending>(
    env.DB,
    `SELECT warranties.item_id, items.name AS item_name, warranties.provider, warranties.ends_on
     FROM warranties JOIN items ON items.id = warranties.item_id
     WHERE items.archived = 0 AND warranties.ends_on IN (${REMINDER_DAYS.map(() => "?").join(", ")})
     ORDER BY warranties.ends_on, items.name`,
    ...REMINDER_DAYS.map((d) => addDays(today, d))
  );

/** Emails every member a list of warranties ending in 30 or 7 days. Sends nothing when the list is empty. */
export const sendWarrantyReminders = async (env: Env): Promise<number> => {
  if (!canSendMail(env)) return 0;
  const today = todayIn(timezone(env));
  const ending = await warrantiesToRemind(env, today);
  if (!ending.length) return 0;
  const members = await all<{ email: string }>(env.DB, "SELECT email FROM users");
  if (!members.length) return 0;

  const base = (env.PUBLIC_URL || "").replace(/\/$/, "");
  const name = appName(env);
  const line = (w: Ending) => `${w.item_name}: ${w.provider} warranty ends ${w.ends_on}`;
  await sendMail(env, {
    to: members.map((m) => m.email),
    subject: ending.length === 1 ? `Warranty ending soon: ${ending[0]!.item_name}` : `${ending.length} warranties ending soon`,
    text: `${ending.map(line).join("\n")}\n\n${base}/items?warranty=expiring`,
    html: mailHtml(
      `<p style="margin:0 0 12px;font-weight:600;">Warranties ending soon</p><ul style="margin:0 0 16px;padding-left:18px;">` +
        ending
          .map((w) => `<li style="margin:0 0 6px;"><a href="${escapeHtml(`${base}/items/${w.item_id}`)}" style="color:#3268bf;">${escapeHtml(w.item_name)}</a>: ${escapeHtml(w.provider)}, ends ${w.ends_on}</li>`)
          .join("") +
        `</ul><p style="margin:0;color:#72726d;font-size:13px;">Sent by ${escapeHtml(name)}.</p>`
    )
  });
  return ending.length;
};

export const runDaily = async (env: Env): Promise<void> => {
  await pruneAuth(env);
  try {
    await sendWarrantyReminders(env);
  } catch (e) {
    console.error("warranty reminders failed", e);
  }
};
