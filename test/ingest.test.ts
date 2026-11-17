/** Email ingest: allowlisted senders become entries with attachments; others are rejected. */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { EntrySummary } from "../shared/api";
import { destinationFor, handleEmail, htmlToText, ingestAddressFor } from "../worker/ingest";
import { createEntry, getEntry, listEntries } from "../worker/catalog/entries";
import { createItem } from "../worker/catalog/items";

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

  it("reads the destination from plus addressing", () => {
    expect(destinationFor("inventory+note@example.com")).toEqual({ kind: "new", type: "note" });
    expect(destinationFor("inventory+SERVICE@example.com")).toEqual({ kind: "new", type: "service" });
    expect(destinationFor("inventory+bogus@example.com")).toEqual({ kind: "new", type: "receipt" });
    expect(destinationFor("inventory@example.com")).toEqual({ kind: "new", type: "receipt" });
    expect(destinationFor("inventory+itm_4f9k2m7q8x1z@example.com")).toEqual({ kind: "new", type: "receipt", itemId: "itm_4f9k2m7q8x1z" });
    expect(destinationFor("inventory+ENT_4F9K2M7Q8X1Z@example.com")).toEqual({ kind: "entry", id: "ent_4f9k2m7q8x1z" });
    expect(ingestAddressFor("inventory@example.com", "itm_4f9k2m7q8x1z")).toBe("inventory+itm_4f9k2m7q8x1z@example.com");
    expect(ingestAddressFor(undefined, "itm_4f9k2m7q8x1z")).toBeNull();
  });

  it("files a message sent to +itm_… as a receipt linked to that item", async () => {
    const item = await createItem(env, { name: "Tobenone dock" }, null, "2026-11-17");
    const { msg, rejected } = message("me@example.com", `inventory+${item.id}@example.com`, mime("auto-confirm@amazon.example", "Your Amazon invoice"));
    await handleEmail(msg, env, ctx());
    expect(rejected).toEqual([]);
    const linked = await listEntries(env, { itemId: item.id });
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ type: "receipt", title: "Your Amazon invoice", item_id: item.id, file_count: 1 });
  });

  it("adds attachments to an existing entry sent to +ent_…, and appends bodies without attachments", async () => {
    const entry = await createEntry(env, { type: "receipt", title: "Dock receipt", notes: "Bought in store." }, null, "manual");
    const first = message("me@example.com", `inventory+${entry.id}@example.com`, mime("orders@store.example", "Invoice PDF"));
    await handleEmail(first.msg, env, ctx());
    expect(first.rejected).toEqual([]);
    let updated = (await getEntry(env, entry.id))!;
    expect(updated.files.map((f) => f.name)).toEqual(["label.pdf"]);
    expect(updated.notes).toBe("Bought in store.");

    const plain = ["From: me@example.com", "To: x", "Subject: Return window", "Date: Mon, 16 Nov 2026 15:04:05 -0500", "", "Returnable until Dec 31."].join("\r\n");
    const second = message("me@example.com", `inventory+${entry.id}@example.com`, plain);
    await handleEmail(second.msg, env, ctx());
    updated = (await getEntry(env, entry.id))!;
    expect(updated.notes).toBe("Bought in store.\n\nEmail “Return window” (2026-11-16):\nReturnable until Dec 31.");
    expect(updated.files).toHaveLength(1);
  });

  it("rejects mail for a record that doesn't exist", async () => {
    const { msg, rejected } = message("me@example.com", "inventory+ent_000000000000@example.com", mime("x@store.example", "Hi"));
    await handleEmail(msg, env, ctx());
    expect(rejected).toEqual(["There's no entry ent_000000000000."]);
  });

  it("converts HTML bodies to text", () => {
    expect(htmlToText("<p>A&amp;B</p><table><tr><td>x</td><td>y</td></tr></table><br>&#8212;")).toBe("A&B\nx\ty\n\n—");
  });
});
