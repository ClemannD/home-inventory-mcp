/**
 * REST API for the web UI. Every route needs a session (checked in
 * worker/app.ts). Writes also need a same-origin Origin header.
 */
import type { Connection, Me } from "../../shared/api";
import { today as todayIn } from "../../shared/dates";
import { ENTRY_TYPES, FILE_KINDS, type FileKind } from "../../shared/entry-types";
import {
  emailAddress,
  entryInput,
  entryPatch,
  filePatch,
  itemInput,
  itemPatch,
  linkInput,
  warrantyInput,
  warrantyPatch
} from "../../shared/schemas";
import type { z } from "zod";
import { deletePasskey, listPasskeys, registerOptions, registerVerify, relyingParty } from "../auth/passkeys";
import { addMember, listMembers, removeMember, renameMember, toMember, type UserRow } from "../auth/users";
import { createEntry, deleteEntry, entryCounts, getEntry, listEntries, updateEntry } from "../catalog/entries";
import { addLink, checkTarget, deleteFile, getFile, getFileRow, MAX_FILE_BYTES, storeFile, updateFile } from "../catalog/files";
import { createItem, deleteItem, facets, getItem, listItems, updateItem } from "../catalog/items";
import { search } from "../catalog/search";
import { addSender, listSenders, removeSender } from "../catalog/senders";
import { createWarranty, deleteWarranty, listWarranties, updateWarranty } from "../catalog/warranties";
import { first } from "../db";
import { appName, timezone, type Env } from "../env";
import { fail, json, readJson, sameOrigin } from "../http";
import { canSendMail } from "../mail";

export interface ApiContext {
  readonly request: Request;
  readonly env: Env;
  readonly ctx: ExecutionContext;
  readonly url: URL;
  readonly user: UserRow;
  readonly today: string;
}

type Handler = (c: ApiContext, params: Record<string, string>) => Promise<Response>;

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly keys: string[];
  readonly handler: Handler;
}

const routes: Route[] = [];

const route = (method: string, path: string, handler: Handler): void => {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key: string) => (keys.push(key), "([^/]+)"))}$`);
  routes.push({ method, pattern, keys, handler });
};

/** Parses the JSON body with `schema`. Returns the data, or a 400 response. */
const body = async <S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | Response> => {
  const parsed = schema.safeParse((await readJson(request)) ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  return fail(issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "invalid body");
};

const notFound = (what: string) => fail(`${what} not found`, 404);
const ownerOnly = (c: ApiContext) => (c.user.role === "owner" ? undefined : fail("only the owner can do that", 403));

// Account --------------------------------------------------------------------

route("GET", "/api/me", async ({ env, user }) => {
  const [items, entries] = await Promise.all([first<{ n: number }>(env.DB, "SELECT count(*) AS n FROM items WHERE archived = 0"), entryCounts(env)]);
  const me: Me = {
    user: toMember(user),
    app_name: appName(env),
    currency: env.CURRENCY || "USD",
    timezone: timezone(env),
    public_url: env.PUBLIC_URL || "",
    ingest_address: env.INGEST_ADDRESS || null,
    email_sending: canSendMail(env),
    counts: { items: items?.n ?? 0, entries }
  };
  return json(me);
});

route("GET", "/api/entry-types", async () => json(ENTRY_TYPES));

route("GET", "/api/search", async ({ env, url }) => json(await search(env.DB, url.searchParams.get("q") ?? "", { limit: 30 })));

// Items ----------------------------------------------------------------------

route("GET", "/api/facets", async ({ env }) => json(await facets(env)));

route("GET", "/api/items", async ({ env, url, today }) => {
  const p = url.searchParams;
  const warranty = p.get("warranty");
  return json(
    await listItems(
      env,
      {
        ...(p.get("q") ? { q: p.get("q")! } : {}),
        ...(p.get("category") ? { category: p.get("category")! } : {}),
        ...(p.get("location") ? { location: p.get("location")! } : {}),
        ...(warranty ? { warranty: warranty as never } : {}),
        archived: p.get("archived") === "1"
      },
      today
    )
  );
});

route("POST", "/api/items", async ({ env, request, user, today }) => {
  const input = await body(request, itemInput);
  if (input instanceof Response) return input;
  return json(await createItem(env, input, user.id, today), 201);
});

route("GET", "/api/items/:id", async ({ env, today }, { id }) => {
  const item = await getItem(env, id!, today);
  return item ? json(item) : notFound("item");
});

route("PATCH", "/api/items/:id", async ({ env, request, today }, { id }) => {
  const patch = await body(request, itemPatch);
  if (patch instanceof Response) return patch;
  const item = await updateItem(env, id!, patch, today);
  return item ? json(item) : notFound("item");
});

route("DELETE", "/api/items/:id", async ({ env }, { id }) => ((await deleteItem(env, id!)) ? json({ ok: true }) : notFound("item")));

// Warranties -----------------------------------------------------------------

route("GET", "/api/warranties", async ({ env, url, today }) => {
  const within = url.searchParams.get("within");
  return json(await listWarranties(env, today, within ? { endingWithinDays: Number(within) } : {}));
});

route("POST", "/api/items/:id/warranties", async ({ env, request, today }, { id }) => {
  const input = await body(request, warrantyInput);
  if (input instanceof Response) return input;
  const w = await createWarranty(env, id!, input, today);
  return w ? json(w, 201) : notFound("item");
});

route("PATCH", "/api/warranties/:id", async ({ env, request, today }, { id }) => {
  const patch = await body(request, warrantyPatch);
  if (patch instanceof Response) return patch;
  const w = await updateWarranty(env, id!, patch, today);
  return w ? json(w) : notFound("warranty");
});

route("DELETE", "/api/warranties/:id", async ({ env }, { id }) => ((await deleteWarranty(env, id!)) ? json({ ok: true }) : notFound("warranty")));

// Entries --------------------------------------------------------------------

route("GET", "/api/entries", async ({ env, url }) => {
  const p = url.searchParams;
  return json(
    await listEntries(env, {
      ...(p.get("type") ? { type: p.get("type")! } : {}),
      ...(p.get("item") ? { itemId: p.get("item")! } : {}),
      ...(p.get("q") ? { q: p.get("q")! } : {})
    })
  );
});

route("POST", "/api/entries", async ({ env, request, user }) => {
  const input = await body(request, entryInput);
  if (input instanceof Response) return input;
  const problem = await checkTarget(env, { itemId: input.item_id ?? null });
  if (problem) return fail(problem);
  return json(await createEntry(env, input, user.id, "manual"), 201);
});

route("GET", "/api/entries/:id", async ({ env }, { id }) => {
  const entry = await getEntry(env, id!);
  return entry ? json(entry) : notFound("entry");
});

route("PATCH", "/api/entries/:id", async ({ env, request }, { id }) => {
  const patch = await body(request, entryPatch);
  if (patch instanceof Response) return patch;
  if (patch.item_id) {
    const problem = await checkTarget(env, { itemId: patch.item_id });
    if (problem) return fail(problem);
  }
  const entry = await updateEntry(env, id!, patch);
  return entry ? json(entry) : notFound("entry");
});

route("DELETE", "/api/entries/:id", async ({ env }, { id }) => ((await deleteEntry(env, id!)) ? json({ ok: true }) : notFound("entry")));

// Files ----------------------------------------------------------------------

/** Upload: the request body is the file. `?kind&name` plus `item` or `entry`. */
route("POST", "/api/files", async ({ env, ctx, request, url, user }) => {
  const p = url.searchParams;
  const kind = (p.get("kind") ?? "document") as FileKind;
  if (!FILE_KINDS.includes(kind)) return fail(`kind must be one of ${FILE_KINDS.join(", ")}`);
  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!request.body || !Number.isFinite(length) || length <= 0) return fail("send the file as the request body with a Content-Length");
  if (length > MAX_FILE_BYTES) return fail("files are limited to 95 MB", 413);
  const target = { itemId: p.get("item"), entryId: p.get("entry") };
  const problem = await checkTarget(env, target);
  if (problem) return fail(problem);
  const { file, extract } = await storeFile(env, {
    ...target,
    body: request.body,
    name: p.get("name") ?? "upload",
    contentType: request.headers.get("content-type") ?? "",
    kind,
    userId: user.id
  });
  ctx.waitUntil(extract());
  return json(file, 201);
});

route("POST", "/api/files/link", async ({ env, ctx, request, user }) => {
  const input = await body(request, linkInput);
  if (input instanceof Response) return input;
  const problem = await checkTarget(env, { itemId: input.item_id ?? null, entryId: input.entry_id ?? null });
  if (problem) return fail(problem);
  try {
    const { file, extract } = await addLink(env, input, user.id);
    ctx.waitUntil(extract());
    return json(file, 201);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "couldn't save the link", 502);
  }
});

route("GET", "/api/files/:id", async ({ env }, { id }) => {
  const file = await getFile(env, id!);
  return file ? json(file) : notFound("file");
});

/** Types rendered in the browser. Everything else downloads. Never HTML or SVG. */
const INLINE = /^(image\/(jpeg|png|webp|gif|avif)|application\/pdf|text\/plain)$/;

route("GET", "/api/files/:id/content", async ({ env, url, request }, { id }) => {
  const row = await getFileRow(env, id!);
  if (!row) return notFound("file");
  if (!row.r2_key) return Response.redirect(row.url!, 302);
  const object = await env.FILES.get(row.r2_key, { onlyIf: request.headers });
  if (!object) return notFound("file");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  const type = row.content_type ?? "application/octet-stream";
  const inline = INLINE.test(type) && url.searchParams.get("download") !== "1";
  headers.set("content-type", type);
  headers.set(
    "content-disposition",
    `${inline ? "inline" : "attachment"}; filename="${row.name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(row.name)}`
  );
  if (type !== "application/pdf") headers.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
});

route("PATCH", "/api/files/:id", async ({ env, request }, { id }) => {
  const patch = await body(request, filePatch);
  if (patch instanceof Response) return patch;
  if (patch.item_id !== undefined || patch.entry_id !== undefined) {
    const problem = await checkTarget(env, { itemId: patch.item_id ?? null, entryId: patch.entry_id ?? null });
    if (problem) return fail(problem);
  }
  const file = await updateFile(env, id!, patch);
  return file ? json(file) : notFound("file");
});

route("DELETE", "/api/files/:id", async ({ env }, { id }) => ((await deleteFile(env, id!)) ? json({ ok: true }) : notFound("file")));

// Members --------------------------------------------------------------------

route("GET", "/api/members", async ({ env }) => json(await listMembers(env)));

route("POST", "/api/members", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const raw = (await readJson(c.request)) ?? {};
  const email = emailAddress.safeParse(raw.email);
  if (!email.success) return fail("enter a valid email address");
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : null;
  const member = await addMember(c.env, email.data, name);
  if (raw.allow_email_ingest === true) await addSender(c.env, email.data, c.user.id);
  return json(member, 201);
});

route("PATCH", "/api/members/:id", async (c, { id }) => {
  if (id !== c.user.id && c.user.role !== "owner") return fail("you can only rename yourself", 403);
  const raw = (await readJson(c.request)) ?? {};
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : null;
  await renameMember(c.env, id!, name);
  return json({ ok: true });
});

route("DELETE", "/api/members/:id", async (c, { id }) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  return (await removeMember(c.env, id!)) ? json({ ok: true }) : fail("that member doesn't exist or is the owner", 400);
});

// Passkeys (the signed-in member's own) ---------------------------------------

route("GET", "/api/passkeys", async ({ env, user }) => json(await listPasskeys(env, user.id)));

route("POST", "/api/passkeys/options", async ({ env, url, user }) => json(await registerOptions(env, relyingParty(url), user)));

route("POST", "/api/passkeys/verify", async ({ env, url, user, request }) => {
  const raw = (await readJson(request)) ?? {};
  if (typeof raw.challengeId !== "string" || typeof raw.response !== "object" || raw.response === null) return fail("bad request");
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 60) : null;
  const result = await registerVerify(env, relyingParty(url), user, raw.challengeId, raw.response as never, name);
  return result.ok ? json(result.value, 201) : fail(result.error, result.status);
});

route("DELETE", "/api/passkeys/:id", async ({ env, user }, { id }) =>
  (await deletePasskey(env, user.id, id!)) ? json({ ok: true }) : notFound("passkey")
);

// Email ingest allowlist ------------------------------------------------------

route("GET", "/api/senders", async ({ env }) => json(await listSenders(env)));

route("POST", "/api/senders", async ({ env, request, user }) => {
  const raw = (await readJson(request)) ?? {};
  const address = emailAddress.safeParse(raw.address);
  if (!address.success) return fail("enter a valid email address");
  await addSender(env, address.data, user.id);
  return json(await listSenders(env), 201);
});

route("DELETE", "/api/senders/:address", async ({ env }, { address }) => {
  await removeSender(env, address!.toLowerCase());
  return json(await listSenders(env));
});

// MCP connections (OAuth grants of the signed-in member) -----------------------

route("GET", "/api/connections", async ({ env, user }) => {
  const grants = await env.OAUTH_PROVIDER.listUserGrants(user.id);
  const out: Connection[] = [];
  for (const g of grants.items) {
    const client = await env.OAUTH_PROVIDER.lookupClient(g.clientId).catch(() => null);
    out.push({ id: g.id, client_id: g.clientId, client_name: client?.clientName || g.clientId, created_at: new Date(g.createdAt * 1000).toISOString() });
  }
  return json(out);
});

route("DELETE", "/api/connections/:id", async ({ env, user }, { id }) => {
  await env.OAUTH_PROVIDER.revokeGrant(id!, user.id);
  return json({ ok: true });
});

/** Routes an /api request. The caller has already checked the session. */
export const handleApi = async (request: Request, env: Env, ctx: ExecutionContext, url: URL, user: UserRow): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD" && !sameOrigin(request, url)) return fail("forbidden", 403);
  const c: ApiContext = { request, env, ctx, url, user, today: todayIn(timezone(env)) };
  for (const r of routes) {
    if (r.method !== request.method && !(r.method === "GET" && request.method === "HEAD")) continue;
    const match = r.pattern.exec(url.pathname);
    if (!match) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1]!)]));
    try {
      return await r.handler(c, params);
    } catch (e) {
      console.error(`${request.method} ${url.pathname} failed`, e);
      return fail(e instanceof Error ? e.message : "internal error", 500);
    }
  }
  return fail("not found", 404);
};
