/** One-time upload links: the public page, a multipart upload, and single use and expiry. */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { ItemDetail } from "../shared/api";
import { createUploadLink } from "../worker/catalog/uploads";
import { checkSignature } from "../worker/catalog/files";
import { call, jsonOf, signIn } from "./helpers";

let cookie = "";
let item: ItemDetail;

beforeAll(async () => {
  cookie = await signIn("owner@example.com");
  item = await jsonOf<ItemDetail>(await call("POST", "/api/items", { cookie, body: { name: "Furnace" } }));
});

const form = (...files: File[]) => {
  const data = new FormData();
  for (const f of files) data.append("file", f);
  return data;
};

const BROWSER = "text/html,application/xhtml+xml,*/*;q=0.8";

/** Posts the form without a session cookie, as a browser by default or as a script (curl's Accept). */
const submit = async (token: string, data: FormData, accept = BROWSER) => {
  const req = new Request(`https://home.example.com/u/${token}`, { method: "POST", body: data });
  const body = await req.arrayBuffer();
  return call("POST", `/u/${token}`, {
    raw: body,
    headers: { "content-type": req.headers.get("content-type")!, "content-length": String(body.byteLength), accept }
  });
};

describe("upload links", () => {
  it("shows the form without a session and saves every file in one submission", async () => {
    const { token } = await createUploadLink(env, { itemId: item.id }, "manual", null);
    const page = await call("GET", `/u/${token}`, { headers: { accept: BROWSER } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Furnace");

    const res = await submit(
      token,
      form(new File(["%PDF-1.4 manual"], "manual.pdf", { type: "application/pdf" }), new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "label.jpg", { type: "image/jpeg" }))
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Saved 2 files");

    const detail = await jsonOf<ItemDetail>(await call("GET", `/api/items/${item.id}`, { cookie }));
    expect(detail.files.map((f) => [f.name, f.kind])).toEqual([
      ["manual.pdf", "manual"],
      ["label.jpg", "manual"]
    ]);
  });

  it("answers scripts with JSON", async () => {
    const { token } = await createUploadLink(env, { itemId: item.id }, "receipt", null);
    const res = await submit(token, form(new File(["%PDF-1.4 invoice"], "invoice.pdf", { type: "application/pdf" })), "*/*");
    expect(res.status).toBe(201);
    const body = await jsonOf<{ saved: { name: string; kind: string }[]; target: { id: string } }>(res);
    expect(body.saved.map((f) => [f.name, f.kind])).toEqual([["invoice.pdf", "receipt"]]);
    expect(body.target.id).toBe(item.id);

    const again = await submit(token, form(new File(["x"], "x.txt", { type: "text/plain" })), "*/*");
    expect(again.status).toBe(410);
    expect((await jsonOf<{ error: string }>(again)).error).toContain("already used");
  });

  it("refuses a second submission", async () => {
    const { token } = await createUploadLink(env, { itemId: item.id }, "photo", null);
    expect((await submit(token, form(new File(["x"], "a.txt", { type: "text/plain" })))).status).toBe(200);
    expect((await submit(token, form(new File(["y"], "b.txt", { type: "text/plain" })))).status).toBe(410);
    expect((await call("GET", `/u/${token}`)).status).toBe(410);
  });

  it("keeps the link usable when the submission had no files", async () => {
    const { token } = await createUploadLink(env, { itemId: item.id }, "photo", null);
    expect((await submit(token, new FormData())).status).toBe(400);
    expect((await call("GET", `/u/${token}`)).status).toBe(200);
  });

  it("refuses expired and unknown links", async () => {
    const { token } = await createUploadLink(env, { itemId: item.id }, "photo", null);
    await env.DB.prepare("UPDATE upload_links SET expires_at = 0").run();
    expect((await call("GET", `/u/${token}`)).status).toBe(410);
    expect((await call("GET", "/u/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
  });
});

describe("file signatures", () => {
  it("accepts real headers and rejects mismatches", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(checkSignature("application/pdf", enc("%PDF-1.7\n"))).toBeUndefined();
    expect(checkSignature("application/pdf", enc("JVBERi0xLjQK"))).toContain("first bytes");
    expect(checkSignature("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBeUndefined();
    expect(checkSignature("image/jpeg", enc("not a jpeg"))).toContain("first bytes");
    expect(checkSignature("text/plain", new Uint8Array([104, 0, 105]))).toContain("first bytes");
    expect(checkSignature("application/zip", enc("PK"))).toContain("isn't accepted");
  });
});
