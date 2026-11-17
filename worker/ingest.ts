/**
 * Email ingest. Email Routing delivers mail for the ingest address to this
 * handler. Each message from an allowlisted envelope sender becomes an entry
 * (a receipt unless the address says otherwise), and its attachments become
 * the entry's files. Mail from anyone else is rejected.
 *
 * Plus addressing picks the entry type: `catalog+note@example.com` makes a
 * note. Unknown types fall back to a receipt.
 */
import PostalMime from "postal-mime";
import { today } from "../shared/dates";
import { DEFAULT_ENTRY_TYPE, entryType } from "../shared/entry-types";
import { userByEmail } from "./auth/users";
import { createEntry } from "./catalog/entries";
import { storeFile } from "./catalog/files";
import { isAllowedSender } from "./catalog/senders";
import { timezone, type Env } from "./env";

const MAX_NOTES = 100_000;

/** The entry type from `local+type@domain`, or the default. */
export const typeFromRecipient = (to: string): string => {
  const tag = /^[^+@]+\+([^@]+)@/.exec(to)?.[1]?.toLowerCase();
  return tag && entryType(tag) ? tag : DEFAULT_ENTRY_TYPE;
};

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** Plain text from an HTML email body: block elements become line breaks, tags are dropped. */
export const htmlToText = (html: string): string =>
  html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, code: string) => {
      if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#") && code !== "#39") return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \u00a0]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const handleEmail = async (message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> => {
  const sender = message.from.trim().toLowerCase();
  if (!(await isAllowedSender(env, sender))) {
    message.setReject(`${sender} isn't allowed to send to this address.`);
    return;
  }

  const parsed = await PostalMime.parse(await new Response(message.raw).arrayBuffer());
  const type = typeFromRecipient(message.to);
  const tz = timezone(env);
  const sentOn = parsed.date && !Number.isNaN(Date.parse(parsed.date)) ? today(tz, new Date(parsed.date)) : today(tz);
  const body = (parsed.text?.trim() || htmlToText(parsed.html ?? "")).slice(0, MAX_NOTES);
  const member = await userByEmail(env, sender);

  const entry = await createEntry(
    env,
    {
      type,
      title: (parsed.subject?.trim() || "(no subject)").slice(0, 300),
      occurred_on: sentOn,
      notes: body || null,
      fields: type === "receipt" ? { from: parsed.from?.address ?? sender } : {}
    },
    member?.id ?? null,
    "email"
  );

  for (const attachment of parsed.attachments) {
    // Images embedded in the HTML body (logos, tracking pixels) aren't documents.
    if (attachment.related) continue;
    const content = typeof attachment.content === "string" ? new TextEncoder().encode(attachment.content) : attachment.content;
    const { extract } = await storeFile(env, {
      entryId: entry.id,
      body: content,
      name: attachment.filename || "attachment",
      contentType: attachment.mimeType,
      kind: type === "receipt" ? "receipt" : "document",
      userId: member?.id ?? null
    });
    ctx.waitUntil(extract());
  }
};
