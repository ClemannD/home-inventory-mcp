/**
 * Email sign-in codes: six digits, valid for 10 minutes, five guesses each.
 * An address gets one code per 30 seconds and five per hour.
 */
import { escapeHtml } from "../http";
import { first, run } from "../db";
import { appName, type Env } from "../env";
import { canSendMail, mailHtml, sendMail } from "../mail";
import { secretEquals, sha256 } from "./crypto";
import { ensureOwner, userByEmail, type UserRow } from "./users";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_MS = 30 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;

export type CodeResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

interface CodeRow {
  code_hash: string;
  expires_at: number;
  attempts: number;
  sent_at: number;
  window_start: number;
  window_sends: number;
}

/** A uniformly random six-digit string. */
const randomCode = (): string => {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
    if (n < limit) return String(n % 1_000_000).padStart(6, "0");
  }
};

const codeHash = (email: string, code: string): Promise<string> => sha256(`${email}:${code}`);

const codeMail = (env: Env, code: string) => {
  const name = appName(env);
  return {
    subject: `${code} is your ${name} sign-in code`,
    text: `Your ${name} sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    html: mailHtml(
      `<p style="margin:0 0 8px;">Your ${escapeHtml(name)} sign-in code:</p>` +
        `<p style="margin:0 0 20px;font-size:30px;line-height:36px;font-weight:600;letter-spacing:6px;">${code}</p>` +
        `<p style="margin:0;color:#72726d;font-size:13px;">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>`
    )
  };
};

/**
 * Emails a code to `email` if it belongs to a member. Returns ok either way,
 * so the response doesn't reveal who is a member.
 */
export const requestCode = async (env: Env, email: string): Promise<CodeResult<null>> => {
  await ensureOwner(env);
  const user = await userByEmail(env, email);
  if (!user) return { ok: true, value: null };

  const now = Date.now();
  const row = await first<CodeRow>(env.DB, "SELECT * FROM sign_in_codes WHERE email = ?", email);
  if (row && now - row.sent_at < RESEND_MS) {
    return { ok: false, status: 429, error: "A code was just sent. Wait 30 seconds before asking for another." };
  }
  const freshWindow = !row || now - row.window_start > WINDOW_MS;
  const windowStart = freshWindow ? now : row.window_start;
  const windowSends = freshWindow ? 1 : row.window_sends + 1;
  if (windowSends > MAX_SENDS_PER_WINDOW) {
    return { ok: false, status: 429, error: "Too many codes requested. Try again in an hour." };
  }

  const code = randomCode();
  await run(
    env.DB,
    `INSERT INTO sign_in_codes (email, code_hash, expires_at, attempts, sent_at, window_start, window_sends)
     VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
       sent_at = excluded.sent_at, window_start = excluded.window_start, window_sends = excluded.window_sends`,
    email,
    await codeHash(email, code),
    now + CODE_TTL_MS,
    now,
    windowStart,
    windowSends
  );

  if (env.DEV_LOG_CODES === "1") console.log(`[sign-in code] ${email}: ${code}`);
  if (canSendMail(env)) {
    try {
      await sendMail(env, { to: user.email, ...codeMail(env, code) });
    } catch (e) {
      console.error("sign-in code email failed", e);
      return { ok: false, status: 502, error: "The code couldn't be emailed. Try again, or sign in with a passkey." };
    }
  } else if (env.DEV_LOG_CODES !== "1") {
    return { ok: false, status: 503, error: "Email sign-in isn't set up on this server. Sign in with a passkey." };
  }
  return { ok: true, value: null };
};

/** Checks a code. On success the code is used up and the member is returned. */
export const verifyCode = async (env: Env, email: string, code: string): Promise<CodeResult<UserRow>> => {
  const row = await first<CodeRow>(env.DB, "SELECT * FROM sign_in_codes WHERE email = ?", email);
  const expired = { ok: false as const, status: 400, error: "That code has expired. Request a new one." };
  if (!row || row.expires_at < Date.now()) return expired;
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, status: 429, error: "Too many wrong codes. Request a new one." };
  await run(env.DB, "UPDATE sign_in_codes SET attempts = attempts + 1 WHERE email = ?", email);

  if (!(await secretEquals(await codeHash(email, code.trim()), row.code_hash))) {
    return { ok: false, status: 401, error: "That code isn't right." };
  }
  // Keep the row for its rate-limit window, but make the code unusable.
  await run(env.DB, "UPDATE sign_in_codes SET expires_at = 0 WHERE email = ?", email);
  const user = await userByEmail(env, email);
  return user ? { ok: true, value: user } : expired;
};
