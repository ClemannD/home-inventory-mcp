/** Outgoing mail through the Email Service `send_email` binding. */
import { appName, type Env } from "./env";

export interface Mail {
  readonly to: string | string[];
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Whether this deployment can send mail. */
export const canSendMail = (env: Env): boolean => !!env.EMAIL && !!env.EMAIL_FROM;

/** Parses `Name <addr@x>` or a bare address into the binding's `{ email, name }` form. */
const fromAddress = (env: Env): { email: string; name: string } => {
  const raw = env.EMAIL_FROM ?? "";
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  return match ? { name: match[1] || appName(env), email: match[2]! } : { name: appName(env), email: raw.trim() };
};

/** Sends `mail`. Throws when the binding rejects it. */
export const sendMail = async (env: Env, mail: Mail): Promise<void> => {
  if (!env.EMAIL || !env.EMAIL_FROM) throw new Error("email sending is not configured (EMAIL binding and EMAIL_FROM)");
  await env.EMAIL.send({ from: fromAddress(env), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
};

/** Wraps a short message in a plain HTML layout. `body` must already be escaped. */
export const mailHtml = (body: string): string => `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#232322;">
<table role="presentation" width="100%" style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #eaeae6;border-radius:12px;padding:28px;">
<tr><td style="font-size:14px;line-height:20px;">${body}</td></tr>
</table></body></html>`;
