/**
 * An MCP client end to end: dynamic client registration, the authorize and
 * consent pages, the PKCE token exchange, then tool calls over /mcp with the
 * bearer token.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, cookiesFrom, jsonOf, signIn } from "./helpers";

const REDIRECT = "https://client.example/callback";
let session = "";
let token = "";

const b64u = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const rpc = async (method: string, params: unknown, id = 1) => {
  const res = await call("POST", "/mcp", {
    origin: null,
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", host: "home.example.com" },
    body: { jsonrpc: "2.0", id, method, params }
  });
  const text = await res.text();
  // The handler may answer as JSON or as one SSE event.
  const payload = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
  if (!payload) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(payload) as { result?: any; error?: { message: string } };
};

const tool = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await rpc("tools/call", { name, arguments: args });
  if (res.error) throw new Error(res.error.message);
  const text = res.result.content[0].text as string;
  return { isError: !!res.result.isError, text, data: res.result.isError ? undefined : JSON.parse(text) };
};

beforeAll(async () => {
  session = await signIn("owner@example.com");
});

describe("OAuth for MCP clients", () => {
  it("registers a client, gets consent and exchanges the code for a token", async () => {
    const reg = await call("POST", "/oauth/register", {
      origin: null,
      body: { client_name: "Test Assistant", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }
    });
    expect(reg.status).toBe(201);
    const { client_id } = await jsonOf<{ client_id: string }>(reg);

    const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const query = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: REDIRECT,
      state: "xyz",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: "https://home.example.com/mcp"
    });

    // Signed out: sent to sign in first, and back here afterwards.
    const signedOut = await call("GET", `/authorize?${query}`, { origin: null });
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("location")).toBe(`/login?next=${encodeURIComponent(`/authorize?${query}`)}`);

    const consent = await call("GET", `/authorize?${query}`, { origin: null, cookie: session });
    expect(consent.status).toBe(200);
    const page = await consent.text();
    expect(page).toContain("Connect Test Assistant?");
    expect(page).toContain("client.example");
    const handle = /name="handle" value="([^"]+)"/.exec(page)![1]!;

    const approve = await call("POST", "/authorize", {
      cookie: `${session}; ${cookiesFrom(consent)}`,
      raw: new URLSearchParams({ handle, decision: "approve" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(approve.status).toBe(302);
    const back = new URL(approve.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("xyz");

    const tokenRes = await call("POST", "/oauth/token", {
      origin: null,
      raw: new URLSearchParams({
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        redirect_uri: REDIRECT,
        client_id,
        code_verifier: verifier,
        resource: "https://home.example.com/mcp"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(tokenRes.status).toBe(200);
    token = (await jsonOf<{ access_token: string }>(tokenRes)).access_token;
    expect(token).toBeTruthy();

    const connections = await jsonOf<{ client_name: string }[]>(await call("GET", "/api/connections", { cookie: session }));
    expect(connections.map((c) => c.client_name)).toEqual(["Test Assistant"]);
  });
});

describe("tools", () => {
  it("lists the tools with read-only and destructive hints", async () => {
    const res = await rpc("tools/list", {});
    const tools = res.result.tools as { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[];
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual(
      ["add_link", "delete", "email_senders", "fetch", "list_entries", "list_items", "list_warranties", "overview", "read_file", "save_entry", "save_item", "save_warranty", "search"].sort()
    );
    expect(byName.get("search")!.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("delete")!.annotations?.destructiveHint).toBe(true);
  });

  it("creates an item with a warranty and finds it again", async () => {
    const stove = (await tool("save_item", { name: "Kitchen range", category: "range", location: "Kitchen", brand: "GE", model: "JGB735" })).data;
    expect(stove.id).toMatch(/^itm_/);
    expect(stove.url).toBe(`https://home.example.com/items/${stove.id}`);

    const w = await tool("save_warranty", { item_id: stove.id, provider: "GE", ends_on: "2099-01-01" });
    expect(w.data).toMatchObject({ status: "active", provider: "GE" });

    const found = (await tool("search", { query: "stove range" })).data.results;
    expect(found[0]).toMatchObject({ kind: "item", id: stove.id });

    const fetched = (await tool("fetch", { id: stove.id })).data;
    expect(fetched.record.warranties[0].provider).toBe("GE");

    const listed = (await tool("list_items", { location: "Kitchen" })).data;
    expect(listed.map((i: { name: string }) => i.name)).toEqual(["Kitchen range"]);
  });

  it("keeps a standalone receipt with a tracking number and deletes it", async () => {
    const receipt = (await tool("save_entry", { type: "receipt", title: "Shipped gift to Mom", fields: { tracking_numbers: ["9400111899223456789012"] } })).data;
    const hit = (await tool("search", { query: "9400111899223456789012" })).data.results[0];
    expect(hit).toMatchObject({ kind: "entry", id: receipt.id });

    expect((await tool("delete", { id: receipt.id })).data).toEqual({ deleted: receipt.id });
    expect((await tool("fetch", { id: receipt.id })).isError).toBe(true);
  });

  it("manages the email allowlist", async () => {
    const added = (await tool("email_senders", { action: "add", address: "Partner@Example.com" })).data;
    expect(added.senders).toContain("partner@example.com");
    const removed = (await tool("email_senders", { action: "remove", address: "partner@example.com" })).data;
    expect(removed.senders).not.toContain("partner@example.com");
  });

  it("reports bad input as a tool error", async () => {
    const res = await tool("save_item", { category: "tv" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("name is required");
  });

  it("rejects an invalid token", async () => {
    const res = await call("POST", "/mcp", {
      origin: null,
      headers: { authorization: "Bearer nope", accept: "application/json, text/event-stream" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }
    });
    expect(res.status).toBe(401);
  });
});
