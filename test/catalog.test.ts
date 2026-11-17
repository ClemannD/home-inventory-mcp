/**
 * The REST API over real D1 and R2: items, warranties, entries, files and
 * search. Tests run in order and share one owner session.
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { Entry, EntrySummary, FileInfo, ItemDetail, ItemSummary, SearchHit, Warranty } from "../shared/api";
import { addDays, today } from "../shared/dates";
import { call, jsonOf, signIn } from "./helpers";

let cookie = "";
let tv: ItemDetail;
const day = today("America/New_York");

beforeAll(async () => {
  cookie = await signIn("owner@example.com");
});

const api = <T>(method: string, path: string, body?: unknown) =>
  call(method, path, { cookie, ...(body === undefined ? {} : { body }) }).then(async (res) => {
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return jsonOf<T>(res);
  });

describe("items", () => {
  it("creates an item and validates input", async () => {
    tv = await api<ItemDetail>("POST", "/api/items", {
      name: "Living room TV",
      category: "tv",
      location: "Living room",
      brand: "LG",
      model: "OLED65C3PUA",
      purchased_on: "2024-11-29",
      price: 1599.99,
      aliases: ["big tv"],
      fields: { panel: "OLED" }
    });
    expect(tv).toMatchObject({ name: "Living room TV", price: 1599.99, aliases: ["big tv"], fields: { panel: "OLED" }, warranties: [] });
    expect(tv.id).toMatch(/^itm_/);

    const bad = await call("POST", "/api/items", { cookie, body: { name: "", purchased_on: "2024-13-40" } });
    expect(bad.status).toBe(400);
  });

  it("merges fields on update and removes keys set to null", async () => {
    const updated = await api<ItemDetail>("PATCH", `/api/items/${tv.id}`, { fields: { panel: null, size: "65 in" }, serial: "311MAKR4F182" });
    expect(updated.fields).toEqual({ size: "65 in" });
    expect(updated.serial).toBe("311MAKR4F182");
  });

  it("computes warranty status from today's date", async () => {
    const expired = await api<Warranty>("POST", `/api/items/${tv.id}/warranties`, { provider: "LG", ends_on: addDays(day, -1) });
    expect(expired).toMatchObject({ status: "expired", days_left: -1, kind: "manufacturer" });
    const card = await api<Warranty>("POST", `/api/items/${tv.id}/warranties`, { provider: "Card", kind: "credit_card", ends_on: addDays(day, 13) });
    expect(card).toMatchObject({ status: "expiring", days_left: 13 });

    const item = await api<ItemDetail>("GET", `/api/items/${tv.id}`);
    expect(item.warranties.map((w) => w.provider)).toEqual(["Card", "LG"]);
    expect(item.warranty).toMatchObject({ provider: "Card", status: "expiring" });
  });

  it("filters the list by warranty status, location and text", async () => {
    await api("POST", "/api/items", { name: "Kitchen range", category: "range", location: "Kitchen", brand: "GE", model: "JGB735" });
    expect((await api<ItemSummary[]>("GET", "/api/items?warranty=expiring")).map((i) => i.name)).toEqual(["Living room TV"]);
    expect((await api<ItemSummary[]>("GET", "/api/items?warranty=none")).map((i) => i.name)).toEqual(["Kitchen range"]);
    expect((await api<ItemSummary[]>("GET", "/api/items?location=kitchen")).map((i) => i.name)).toEqual(["Kitchen range"]);
    expect((await api<ItemSummary[]>("GET", "/api/items?q=big")).map((i) => i.name)).toEqual(["Living room TV"]);
    expect((await api<ItemSummary[]>("GET", "/api/items?q=JGB")).map((i) => i.name)).toEqual(["Kitchen range"]);
  });

  it("lists warranties ending soon", async () => {
    const soon = await api<Array<Warranty & { item_name: string }>>("GET", "/api/warranties?within=30");
    expect(soon.map((w) => [w.item_name, w.provider])).toEqual([["Living room TV", "Card"]]);
  });
});

describe("files", () => {
  let photo: FileInfo;

  it("uploads a file to an item and serves it back", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const res = await call("POST", `/api/files?kind=photo&item=${tv.id}&name=front.jpg`, {
      cookie,
      raw: bytes,
      headers: { "content-type": "image/jpeg", "content-length": String(bytes.length) }
    });
    expect(res.status).toBe(201);
    photo = await jsonOf<FileInfo>(res);
    expect(photo).toMatchObject({ kind: "photo", name: "front.jpg", size: 8, stored: true, item_id: tv.id });

    const content = await call("GET", `/api/files/${photo.id}/content`, { cookie });
    expect(content.headers.get("content-type")).toBe("image/jpeg");
    expect(content.headers.get("content-disposition")).toMatch(/^inline/);
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes);

    const list = await api<ItemSummary[]>("GET", "/api/items?q=living");
    expect(list[0]!.photo_id).toBe(photo.id);
  });

  it("indexes the text of plain-text files", async () => {
    const text = new TextEncoder().encode("To reset the oven, hold Bake and Broil for 3 seconds.");
    const res = await call("POST", `/api/files?kind=manual&item=${tv.id}&name=manual.txt`, {
      cookie,
      raw: text,
      headers: { "content-type": "text/plain", "content-length": String(text.length) }
    });
    const file = await jsonOf<FileInfo>(res);
    // Extraction runs in waitUntil; wait for it.
    for (let i = 0; i < 50 && (await api<FileInfo>("GET", `/api/files/${file.id}`)).text_status === "pending"; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const hits = await api<SearchHit[]>("GET", "/api/search?q=reset%20oven");
    expect(hits[0]).toMatchObject({ kind: "file", id: file.id, parent_id: tv.id });
    expect(hits[0]!.snippet).toContain("[reset]");
  });

  it("refuses an upload to an item that doesn't exist", async () => {
    const res = await call("POST", "/api/files?kind=photo&item=itm_nope&name=a.jpg", {
      cookie,
      raw: new Uint8Array([1]),
      headers: { "content-type": "image/jpeg", "content-length": "1" }
    });
    expect(res.status).toBe(400);
  });
});

describe("entries", () => {
  let receipt: Entry;

  it("creates a standalone receipt and normalizes its fields", async () => {
    receipt = await api<Entry>("POST", "/api/entries", {
      type: "receipt",
      title: "UPS Store shipment",
      occurred_on: day,
      fields: { merchant: "UPS Store", total: "$18.40", tracking_numbers: "1Z999AA10123456784\n1Z999AA10123456785" }
    });
    expect(receipt.fields).toEqual({ merchant: "UPS Store", total: 18.4, tracking_numbers: ["1Z999AA10123456784", "1Z999AA10123456785"] });
    expect(receipt.item_id).toBeNull();
  });

  it("finds a receipt by tracking number", async () => {
    const hits = await api<SearchHit[]>("GET", "/api/search?q=1Z999AA10123456785");
    expect(hits[0]).toMatchObject({ kind: "entry", id: receipt.id, subtype: "receipt" });
    const list = await api<EntrySummary[]>("GET", "/api/entries?type=receipt&q=ups");
    expect(list.map((e) => e.id)).toEqual([receipt.id]);
  });

  it("links an entry to an item and shows it on the item", async () => {
    const service = await api<Entry>("POST", "/api/entries", { type: "service", title: "Replaced HDMI cable", item_id: tv.id, fields: { cost: 12 } });
    const item = await api<ItemDetail>("GET", `/api/items/${tv.id}`);
    expect(item.entries.map((e) => e.id)).toContain(service.id);
  });

  it("deletes an entry with its files", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const file = await jsonOf<FileInfo>(
      await call("POST", `/api/files?kind=receipt&entry=${receipt.id}&name=label.pdf`, {
        cookie,
        raw: pdf,
        headers: { "content-type": "application/pdf", "content-length": "4" }
      })
    );
    const key = `files/${file.id}/label.pdf`;
    expect(await env.FILES.head(key)).not.toBeNull();

    await api("DELETE", `/api/entries/${receipt.id}`);
    expect((await call("GET", `/api/entries/${receipt.id}`, { cookie })).status).toBe(404);
    expect(await env.FILES.head(key)).toBeNull();
    expect(await api<SearchHit[]>("GET", "/api/search?q=1Z999AA10123456785")).toEqual([]);
  });
});

describe("deleting an item", () => {
  it("removes its files from R2 and keeps linked entries", async () => {
    const before = await api<ItemDetail>("GET", `/api/items/${tv.id}`);
    const keys = before.files.filter((f) => f.stored).map((f) => `files/${f.id}/${f.name}`);
    expect(keys.length).toBeGreaterThan(0);

    await api("DELETE", `/api/items/${tv.id}`);
    for (const key of keys) expect(await env.FILES.head(key)).toBeNull();
    const services = await api<EntrySummary[]>("GET", "/api/entries?type=service");
    expect(services[0]).toMatchObject({ title: "Replaced HDMI cable", item_id: null });
  });
});
