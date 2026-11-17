/**
 * Sign-in end to end: the session gate, email codes and their limits,
 * passkeys (a software authenticator drives real WebAuthn verification),
 * members, and logout. Tests run in order and share the database.
 */
import { describe, expect, it } from "vitest";
import { createFakePasskey } from "./passkey-fake";
import { call, cookiesFrom, jsonOf, ORIGIN, requestCode, signIn } from "./helpers";
import type { Me, Member } from "../shared/api";

const OWNER = "owner@example.com";
let owner = "";

describe("session gate", () => {
  it("redirects pages to /login and rejects /api without a session", async () => {
    const page = await call("GET", "/items?warranty=expiring");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login?next=%2Fitems%3Fwarranty%3Dexpiring");
    expect((await call("GET", "/api/me")).status).toBe(401);
  });

  it("serves the sign-in page and install metadata without a session", async () => {
    const login = await call("GET", "/login");
    expect(login.status).toBe(200);
    expect(await login.text()).toContain("Sign in with a passkey");
    expect((await call("GET", "/manifest.webmanifest")).status).toBe(200);
  });

  it("publishes OAuth metadata for MCP clients", async () => {
    const res = await call("GET", "/.well-known/oauth-protected-resource/mcp", { origin: null });
    expect(res.status).toBe(200);
    const meta = await jsonOf<{ resource: string; authorization_servers: string[] }>(res);
    expect(meta.resource).toBe(`${ORIGIN}/mcp`);
    expect((await call("POST", "/mcp", { origin: null, body: {} })).status).toBe(401);
  });
});

describe("email codes", () => {
  it("creates the owner from OWNER_EMAIL and signs them in", async () => {
    const { res, code } = await requestCode(OWNER);
    expect(res.status).toBe(200);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await call("POST", "/auth/code/verify", { body: { email: OWNER, code: code === "000000" ? "111111" : "000000" } });
    expect(wrong.status).toBe(401);

    const ok = await call("POST", "/auth/code/verify", { body: { email: OWNER, code } });
    expect(ok.status).toBe(200);
    owner = cookiesFrom(ok);
    expect(owner).toMatch(/^__Host-session=/);

    const me = await jsonOf<Me>(await call("GET", "/api/me", { cookie: owner }));
    expect(me.user).toMatchObject({ email: OWNER, role: "owner" });

    // A used code can't be used again.
    expect((await call("POST", "/auth/code/verify", { body: { email: OWNER, code } })).status).toBe(400);
  });

  it("answers the same for non-members and sends them nothing", async () => {
    const { res, code } = await requestCode("stranger@example.com");
    expect(res.status).toBe(200);
    expect(code).toBeUndefined();
  });

  it("limits resends to one per 30 seconds", async () => {
    const again = await requestCode(OWNER);
    expect(again.res.status).toBe(429);
  });

  it("locks a code after five wrong guesses", async () => {
    const add = await call("POST", "/api/members", { cookie: owner, body: { email: "guesser@example.com" } });
    expect(add.status).toBe(201);
    const { code } = await requestCode("guesser@example.com");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await call("POST", "/auth/code/verify", { body: { email: "guesser@example.com", code: wrong } })).status).toBe(401);
    }
    const locked = await call("POST", "/auth/code/verify", { body: { email: "guesser@example.com", code } });
    expect(locked.status).toBe(429);
  });
});

describe("members", () => {
  it("lets the owner add a member who can then sign in, but not manage members", async () => {
    const add = await call("POST", "/api/members", { cookie: owner, body: { email: "Partner@Example.com", name: "Sam", allow_email_ingest: true } });
    expect(add.status).toBe(201);
    expect(await jsonOf<Member>(add)).toMatchObject({ email: "partner@example.com", role: "member" });

    const partner = await signIn("partner@example.com");
    const me = await jsonOf<Me>(await call("GET", "/api/me", { cookie: partner }));
    expect(me.user.role).toBe("member");
    expect((await call("POST", "/api/members", { cookie: partner, body: { email: "x@example.com" } })).status).toBe(403);

    const senders = await jsonOf<{ address: string }[]>(await call("GET", "/api/senders", { cookie: partner }));
    expect(senders.map((s) => s.address)).toEqual(expect.arrayContaining([OWNER, "partner@example.com"]));
  });

  it("rejects writes from another origin", async () => {
    expect((await call("POST", "/api/members", { cookie: owner, origin: "https://evil.example", body: { email: "a@b.co" } })).status).toBe(403);
  });
});

describe("passkeys", () => {
  it("adds a passkey for a signed-in member and signs in with it", async () => {
    const pk = await createFakePasskey();
    const opts = await jsonOf<{ challengeId: string; options: never }>(await call("POST", "/api/passkeys/options", { cookie: owner }));
    const response = await pk.register(opts.options, ORIGIN);
    const added = await call("POST", "/api/passkeys/verify", { cookie: owner, body: { challengeId: opts.challengeId, response, name: "Laptop" } });
    expect(added.status).toBe(201);

    const list = await jsonOf<{ name: string }[]>(await call("GET", "/api/passkeys", { cookie: owner }));
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("Laptop");

    const login = await jsonOf<{ challengeId: string; options: never }>(await call("POST", "/auth/passkey/login/options", { body: {} }));
    const assertion = await pk.assert(login.options, ORIGIN);
    const signedIn = await call("POST", "/auth/passkey/login/verify", { body: { challengeId: login.challengeId, response: assertion } });
    expect(signedIn.status).toBe(200);
    const me = await jsonOf<Me>(await call("GET", "/api/me", { cookie: cookiesFrom(signedIn) }));
    expect(me.user.email).toBe(OWNER);
  });

  it("rejects an unknown passkey", async () => {
    const stranger = await createFakePasskey();
    const login = await jsonOf<{ challengeId: string; options: never }>(await call("POST", "/auth/passkey/login/options", { body: {} }));
    const assertion = await stranger.assert(login.options, ORIGIN);
    expect((await call("POST", "/auth/passkey/login/verify", { body: { challengeId: login.challengeId, response: assertion } })).status).toBe(401);
  });
});

describe("logout", () => {
  it("ends the session", async () => {
    const out = await call("POST", "/auth/logout", { cookie: owner });
    expect(out.status).toBe(303);
    expect((await call("GET", "/api/me", { cookie: owner })).status).toBe(401);
  });
});
