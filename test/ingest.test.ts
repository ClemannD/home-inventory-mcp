/** Email ingest: allowlisted senders become entries with attachments; others are rejected. */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { EntrySummary } from "../shared/api";
import { handleEmail, htmlToText, typeFromRecipient } from "../worker/ingest";
import { listEntries, getEntry } from "../worker/catalog/entries";

const mime = (from: string, subject: string) =>
  [
    `From: Store <${from}>`,
    "To: inventory@example.com",
    `Subject: ${subject}`,
    "Date: Mon, 16 Nov 2026 15:04:05 -0500",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    'Content-Type: text/html; charset="utf-8"',
    "",
    "<html><head><style>p{color:red}</style></head><body><p>Thanks for your order&nbsp;#123.</p><p>Tracking: 1Z999AA10123456784</p></body></html>",
    "--b1",
    'Content-Type: application/pdf; name="label.pdf"',
    'Content-Disposition: attachment; filename="label.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    btoa("%PDF-1.4 fake"),
    "--b1--",
    ""
  ].join("\r\n");

const message = (from: string, to: string, raw: string) => {
  const rejected: string[] = [];
  const bytes = new TextEncoder().encode(raw);
  const msg = {
    from,
    to,
    headers: new Headers(),
    raw: new Response(bytes).body!,
    rawSize: bytes.length,
    setReject: (reason: string) => rejected.push(reason),
    forward: async () => ({ messageId: "" }),
    reply: async () => ({ messageId: "" })
  };
  return { msg: msg as unknown as ForwardableEmailMessage, rejected };
};

const ctx = (): ExecutionContext => ({ waitUntil: () => {}, passThroughOnException: () => {}, props: {} }) as unknown as ExecutionContext;

describe("email ingest", () => {
  it("rejects senders that aren't on the allowlist", async () => {
    const { msg, rejected } = message("stranger@example.com", "inventory@example.com", mime("stranger@example.com", "Hi"));
    await handleEmail(msg, env, ctx());
    expect(rejected).toHaveLength(1);
    expect(await listEntries(env, {})).toEqual([]);
  });

  it("turns an allowed message into a receipt with its attachment", async () => {
    await env.DB.prepare("INSERT INTO email_senders (address, created_at) VALUES ('me@example.com', 0)").run();
    const { msg, rejected } = message("Me@Example.com", "inventory@example.com", mime("orders@store.example", "Your order shipped"));
    await handleEmail(msg, env, ctx());
    expect(rejected).toEqual([]);

    const [summary] = (await listEntries(env, {})) as EntrySummary[];
    expect(summary).toMatchObject({ type: "receipt", title: "Your order shipped", occurred_on: "2026-11-16", source: "email", file_count: 1 });
    const entry = (await getEntry(env, summary!.id))!;
    expect(entry.notes).toBe("Thanks for your order #123.\nTracking: 1Z999AA10123456784");
    expect(entry.fields).toEqual({ from: "orders@store.example" });
    expect(entry.files[0]).toMatchObject({ name: "label.pdf", kind: "receipt", content_type: "application/pdf" });
  });

  it("picks the entry type from plus addressing", () => {
    expect(typeFromRecipient("inventory+note@example.com")).toBe("note");
    expect(typeFromRecipient("inventory+SERVICE@example.com")).toBe("service");
    expect(typeFromRecipient("inventory+bogus@example.com")).toBe("receipt");
    expect(typeFromRecipient("inventory@example.com")).toBe("receipt");
  });

  it("converts HTML bodies to text", () => {
    expect(htmlToText("<p>A&amp;B</p><table><tr><td>x</td><td>y</td></tr></table><br>&#8212;")).toBe("A&B\nx\ty\n\n—");
  });
});
