/**
 * Email ingest. Email Routing delivers mail for the ingest address to this
 * handler. Mail from senders not on the allowlist is rejected.
 *
 * The part after a plus in the address says where the message goes:
 *
 *   catalog@example.com            a new receipt
 *   catalog+note@example.com       a new entry of that type
 *   catalog+itm_xxx@example.com    a new receipt linked to that item
 *   catalog+ent_xxx@example.com    added to that entry: attachments become its
 *                                  files; a message without attachments is
 *                                  appended to its notes
 *
 * Unknown types fall back to a receipt. Unknown IDs are rejected.
 * Plus addresses need subaddressing turned on in Email Routing.
 */
import PostalMime from "postal-mime";
import { today } from "../shared/dates";
import { DEFAULT_ENTRY_TYPE, entryType } from "../shared/entry-types";
import { userByEmail } from "./auth/users";
import { createEntry, entryExists, getEntry, updateEntry } from "./catalog/entries";
import { itemExists } from "./catalog/items";
import { storeFile } from "./catalog/files";
import { isAllowedSender } from "./catalog/senders";
import { timezone, type Env } from "./env";

const MAX_NOTES = 100_000;

export type Destination = { kind: "new"; type: string; itemId?: string } | { kind: "entry"; id: string };

const RECORD_ID = /^(itm|ent)_[0-9a-z]{12}$/;

/** Where a message to `local+tag@domain` goes. See the comment at the top of this file. */
export const destinationFor = (to: string): Destination => {
  const tag = /^[^+@]+\+([^@]+)@/.exec(to)?.[1]?.toLowerCase();
  if (tag && RECORD_ID.test(tag)) return tag.startsWith("itm_") ? { kind: "new", type: "receipt", itemId: tag } : { kind: "entry", id: tag };
  return { kind: "new", type: tag && entryType(tag) ? tag : DEFAULT_ENTRY_TYPE };
};

/** The ingest address that files mail on record `id`, e.g. catalog+itm_xxx@example.com. */
export const ingestAddressFor = (ingest: string | undefined, id: string): string | null =>
  ingest && ingest.includes("@") ? ingest.replace("@", `+${id}@`) : null;

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
  const destination = destinationFor(message.to);
  if (destination.kind === "entry" && !(await entryExists(env, destination.id))) {
    message.setReject(`There's no entry ${destination.id}.`);
    return;
  }
  if (destination.kind === "new" && destination.itemId && !(await itemExists(env, destination.itemId))) {
    message.setReject(`There's no item ${destination.itemId}.`);
    return;
  }

  const parsed = await PostalMime.parse(await new Response(message.raw).arrayBuffer());
  const tz = timezone(env);
  const sentOn = parsed.date && !Number.isNaN(Date.parse(parsed.date)) ? today(tz, new Date(parsed.date)) : today(tz);
  const subject = (parsed.subject?.trim() || "(no subject)").slice(0, 300);
  const body = (parsed.text?.trim() || htmlToText(parsed.html ?? "")).slice(0, MAX_NOTES);
  const member = await userByEmail(env, sender);
  // Images embedded in the HTML body (logos, tracking pixels) aren't documents.
  const attachments = parsed.attachments.filter((a) => !a.related);

  let entryId: string;
  let kind: "receipt" | "document";
  if (destination.kind === "entry") {
    entryId = destination.id;
    const entry = (await getEntry(env, entryId))!;
    kind = entry.type === "receipt" ? "receipt" : "document";
    if (!attachments.length && body) {
      const note = `Email “${subject}” (${sentOn}):\n${body}`;
      await updateEntry(env, entryId, { notes: (entry.notes ? `${entry.notes}\n\n${note}` : note).slice(0, MAX_NOTES) });
    }
  } else {
    const entry = await createEntry(
      env,
      {
        type: destination.type,
        title: subject,
        item_id: destination.itemId ?? null,
        occurred_on: sentOn,
        notes: body || null,
        fields: destination.type === "receipt" ? { from: parsed.from?.address ?? sender } : {}
      },
      member?.id ?? null,
      "email"
    );
    entryId = entry.id;
    kind = destination.type === "receipt" ? "receipt" : "document";
  }

  for (const attachment of attachments) {
    const content = typeof attachment.content === "string" ? new TextEncoder().encode(attachment.content) : attachment.content;
    const { extract } = await storeFile(env, {
      entryId,
      body: content,
      name: attachment.filename || "attachment",
      contentType: attachment.mimeType,
      kind,
      userId: member?.id ?? null
    });
    ctx.waitUntil(extract());
  }
};
