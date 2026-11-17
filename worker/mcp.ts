/**
 * The MCP server. workers-oauth-provider checks the bearer token before a
 * request reaches here and passes the grant's props (`{ userId }`) on.
 *
 * Tools return data, not prose: the client model decides what the user
 * meant, and asks when more than one record could match.
 */
import { env, waitUntil } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { today as todayIn } from "../shared/dates";
import { ENTRY_TYPES } from "../shared/entry-types";
import { emailAddress, entryPatch, fileKind, itemPatch, linkInput, warrantyInput, warrantyPatch } from "../shared/schemas";
import { userById } from "./auth/users";
import { createEntry, deleteEntry, entryCounts, getEntry, listEntries, updateEntry } from "./catalog/entries";
import { addLink, checkSignature, checkTarget, deleteFile, readText, SNIFFABLE_TYPES, storeFile } from "./catalog/files";
import { createUploadLink } from "./catalog/uploads";
import { ingestAddressFor } from "./ingest";
import { createItem, deleteItem, facets, getItem, listItems, updateItem } from "./catalog/items";
import { search } from "./catalog/search";
import { addSender, listSenders, removeSender } from "./catalog/senders";
import { createWarranty, deleteWarranty, listWarranties, updateWarranty } from "./catalog/warranties";
import { first } from "./db";
import { appName, timezone, type Env } from "./env";

const VERSION = "1.0.0";
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const error = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

const base = (e: Env): string => (e.PUBLIC_URL || "").replace(/\/$/, "");
/** Server icons for MCP clients. Icon URLs must be absolute, so there are none without PUBLIC_URL. */
const icons = (e: Env) =>
  base(e)
    ? [
        { src: `${base(e)}/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] },
        { src: `${base(e)}/icon-192.png`, mimeType: "image/png", sizes: ["192x192"] },
        { src: `${base(e)}/favicon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }
      ]
    : undefined;

const urlFor = (e: Env, id: string): string => {
  if (id.startsWith("itm_")) return `${base(e)}/items/${id}`;
  if (id.startsWith("ent_")) return `${base(e)}/entries/${id}`;
  if (id.startsWith("fil_")) return `${base(e)}/api/files/${id}/content`;
  return base(e);
};

const listItemsInput = z.object({
  category: z.string().max(80).optional(),
  location: z.string().max(120).optional(),
  warranty: z.enum(["active", "expiring", "expired", "lifetime", "not_started", "none"]).optional(),
  include_archived: z.boolean().default(false)
});

/** Largest file accepted by upload_file, in bytes. Larger files go through an upload link. */
const MAX_INLINE_FILE_BYTES = 10 * 1024 * 1024;

const target = {
  item_id: z.string().max(40).optional().describe("Attach to this item"),
  entry_id: z.string().max(40).optional().describe("Or attach to this entry (receipt, note, …)")
};

const uploadLinkInput = z.object({
  ...target,
  kind: fileKind.default("document").describe("What the files are: photo, manual, receipt, warranty or document")
});

const uploadFileInput = z.object({
  ...target,
  name: z.string().trim().min(1).max(200).describe("File name, e.g. 'invoice.pdf'"),
  content_type: z.enum(SNIFFABLE_TYPES as [string, ...string[]]),
  data_base64: z
    .string()
    .min(4)
    .max(Math.ceil(MAX_INLINE_FILE_BYTES / 3) * 4 + 1024)
    .describe("The file's exact bytes, base64-encoded"),
  kind: fileKind.default("document")
});

const decodeBase64 = (data: string): Uint8Array | undefined => {
  try {
    const bin = atob(data.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
};

const entryTypesText = ENTRY_TYPES.map(
  (t) => `- ${t.id}: ${t.description}${t.fields.length ? ` Fields: ${t.fields.map((f) => `${f.key} (${f.kind})`).join(", ")}.` : ""}`
).join("\n");

/** Builds a server for one request. Called by the stateless handler for every MCP POST. */
const buildServer = async (): Promise<McpServer> => {
  const e = env as unknown as Env;
  const props = getMcpAuthContext()?.props as { userId?: string } | undefined;
  const user = props?.userId ? await userById(e, props.userId) : null;
  const today = todayIn(timezone(e));
  const server = new McpServer({ name: appName(e), version: VERSION, icons: icons(e) });

  /** Every tool runs as the member who connected. A removed member's grant stops working. */
  const tool = <T>(fn: (args: T) => Promise<ToolResult>) => async (args: T): Promise<ToolResult> => {
    if (!user) return error("This connection's member was removed from the household. Reconnect as a current member.");
    try {
      return await fn(args);
    } catch (err) {
      console.error("tool failed", err);
      return error(err instanceof Error ? err.message : "The tool failed.");
    }
  };

  server.registerTool(
    "overview",
    {
      title: "Catalog overview",
      description:
        "Returns what the household inventory holds: item counts, categories and locations in use, the entry types and their fields, today's date, and the web app URL. Call it once at the start of a conversation about the user's home, appliances, warranties, receipts or manuals.",
      inputSchema: z.object({}),
      annotations: READ
    },
    tool(async () => {
      const [f, counts, items] = await Promise.all([
        facets(e),
        entryCounts(e),
        first<{ n: number }>(e.DB, "SELECT count(*) AS n FROM items WHERE archived = 0")
      ]);
      return ok({
        app: appName(e),
        today,
        timezone: timezone(e),
        currency: e.CURRENCY || "USD",
        web_app: base(e),
        items: items?.n ?? 0,
        categories: f.categories,
        locations: f.locations,
        entries: counts,
        entry_types: ENTRY_TYPES.map((t) => ({ id: t.id, description: t.description, fields: t.fields.map((x) => ({ key: x.key, kind: x.kind })) })),
        email_ingest_address: e.INGEST_ADDRESS || null,
        notes: [
          "Items are physical things in the home. Entries are other records (receipts, service history, notes) and can link to an item.",
          "To attach a file the user has (a receipt or manual they shared with you), call create_upload_link and give them the link. Use upload_file only when you have the file's original bytes.",
          "Each item and entry has an email_to address. Forwarding an email there (for example an invoice from the user's mailbox) files it on that record with its attachments. The sending address must be on the email_senders allowlist.",
          "When more than one item could match what the user said, ask which one they mean."
        ]
      });
    })
  );

  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Full-text search across items, entries, and the text of stored files such as manuals and scanned receipts. Returns all matches with a snippet (matched words in [brackets]). Use it to find a tracking number, a reset procedure in a manual, or an item by nickname. Then call fetch for the full record.",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(15)
      }),
      annotations: READ
    },
    tool(async ({ query, limit }: { query: string; limit: number }) =>
      ok({ results: (await search(e.DB, query, { limit })).map((h) => ({ ...h, url: urlFor(e, h.id) })) })
    )
  );

  server.registerTool(
    "fetch",
    {
      title: "Get a record",
      description:
        "Returns one record by ID. For an item (itm_…): its details, warranties with computed status and days_left, files, and linked entries. For an entry (ent_…): its fields, notes and files. For a file (fil_…): its details and the first 20,000 characters of extracted text; use read_file for more.",
      inputSchema: z.object({ id: z.string().min(4).max(40) }),
      annotations: READ
    },
    tool(async ({ id }: { id: string }) => {
      if (id.startsWith("itm_")) {
        const item = await getItem(e, id, today);
        return item
          ? ok({ id, title: item.name, url: urlFor(e, id), email_to: ingestAddressFor(e.INGEST_ADDRESS, id), text: JSON.stringify(item), record: item })
          : error(`No item ${id}.`);
      }
      if (id.startsWith("ent_")) {
        const entry = await getEntry(e, id);
        return entry
          ? ok({ id, title: entry.title, url: urlFor(e, id), email_to: ingestAddressFor(e.INGEST_ADDRESS, id), text: JSON.stringify(entry), record: entry })
          : error(`No entry ${id}.`);
      }
      if (id.startsWith("fil_")) {
        const slice = await readText(e, id, 0, 20_000);
        if (!slice) return error(`No file ${id}.`);
        return ok({ id, title: slice.file.name, url: urlFor(e, id), text: slice.text, record: slice.file, text_length: slice.total, more_text: slice.more });
      }
      return error("IDs start with itm_, ent_ or fil_.");
    })
  );

  server.registerTool(
    "list_items",
    {
      title: "List items",
      description:
        "Lists items, optionally filtered by category, location or warranty status. Each row has the item's best warranty (status: active, expiring, expired, lifetime, not_started). Use it to resolve phrases like 'the living room TV' when search isn't enough.",
      inputSchema: listItemsInput,
      annotations: READ
    },
    tool(async (a: z.infer<typeof listItemsInput>) =>
      ok(
        (
          await listItems(
            e,
            {
              ...(a.category ? { category: a.category } : {}),
              ...(a.location ? { location: a.location } : {}),
              ...(a.warranty ? { warranty: a.warranty } : {}),
              archived: a.include_archived
            },
            today
          )
        ).map((i) => ({ ...i, url: urlFor(e, i.id) }))
      )
    )
  );

  server.registerTool(
    "list_entries",
    {
      title: "List entries",
      description: `Lists entries newest first, optionally filtered by type, linked item, or a text query. Types:\n${entryTypesText}`,
      inputSchema: z.object({
        type: z.string().max(40).optional(),
        item_id: z.string().max(40).optional(),
        query: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(200).default(50)
      }),
      annotations: READ
    },
    tool(async (a: { type?: string; item_id?: string; query?: string; limit: number }) =>
      ok(
        (
          await listEntries(e, {
            ...(a.type ? { type: a.type } : {}),
            ...(a.item_id ? { itemId: a.item_id } : {}),
            ...(a.query ? { q: a.query } : {}),
            limit: a.limit
          })
        ).map((x) => ({ ...x, url: urlFor(e, x.id) }))
      )
    )
  );

  server.registerTool(
    "list_warranties",
    {
      title: "List warranties",
      description:
        "Lists warranties on current items, soonest end date first, with status and days_left computed for today. By default excludes expired ones. With ending_within_days, returns only those ending between today and that many days from now.",
      inputSchema: z.object({
        ending_within_days: z.number().int().min(0).max(3650).optional(),
        include_expired: z.boolean().default(false)
      }),
      annotations: READ
    },
    tool(async (a: { ending_within_days?: number; include_expired: boolean }) =>
      ok(
        await listWarranties(e, today, {
          ...(a.ending_within_days !== undefined ? { endingWithinDays: a.ending_within_days } : {}),
          includeExpired: a.include_expired
        })
      )
    )
  );

  server.registerTool(
    "save_item",
    {
      title: "Create or update an item",
      description:
        "Creates an item when id is omitted (name is then required), or updates the item with that id. Only the fields you pass change. `fields` holds extra attributes and is merged key by key; set a key to null to remove it. To mark an item as gone, set archived: true rather than deleting it.",
      inputSchema: itemPatch.extend({ id: z.string().max(40).optional().describe("Omit to create a new item") }),
      annotations: WRITE
    },
    tool(async ({ id, ...input }: z.infer<typeof itemPatch> & { id?: string }) => {
      if (id) {
        const item = await updateItem(e, id, input, today);
        return item ? ok({ ...item, url: urlFor(e, item.id) }) : error(`No item ${id}.`);
      }
      if (!input.name) return error("name is required to create an item.");
      const item = await createItem(e, { ...input, name: input.name }, user!.id, today);
      return ok({ ...item, url: urlFor(e, item.id) });
    })
  );

  server.registerTool(
    "save_warranty",
    {
      title: "Create or update a warranty",
      description:
        "Adds a warranty to an item (pass item_id and provider) or updates one (pass id). An item can have several, e.g. the manufacturer's plus a credit card extension. Leave ends_on empty for lifetime coverage.",
      inputSchema: warrantyPatch.extend({
        id: z.string().max(40).optional().describe("Omit to create"),
        item_id: z.string().max(40).optional().describe("Required when creating")
      }),
      annotations: WRITE
    },
    tool(async ({ id, item_id, ...input }: z.infer<typeof warrantyPatch> & { id?: string; item_id?: string }) => {
      if (id) {
        const w = await updateWarranty(e, id, input, today);
        return w ? ok(w) : error(`No warranty ${id}.`);
      }
      if (!item_id) return error("item_id is required to create a warranty.");
      const parsed = warrantyInput.safeParse(input);
      if (!parsed.success) return error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      const w = await createWarranty(e, item_id, parsed.data, today);
      return w ? ok(w) : error(`No item ${item_id}.`);
    })
  );

  server.registerTool(
    "save_entry",
    {
      title: "Create or update an entry",
      description: `Creates an entry when id is omitted (type and title are then required), or updates the entry with that id. Link it to an item with item_id, or set item_id to null to unlink. \`fields\` is merged key by key. Types:\n${entryTypesText}`,
      inputSchema: entryPatch.extend({ id: z.string().max(40).optional().describe("Omit to create") }),
      annotations: WRITE
    },
    tool(async ({ id, ...input }: z.infer<typeof entryPatch> & { id?: string }) => {
      if (input.item_id) {
        const problem = await checkTarget(e, { itemId: input.item_id });
        if (problem) return error(problem);
      }
      if (id) {
        const entry = await updateEntry(e, id, input);
        return entry ? ok({ ...entry, url: urlFor(e, entry.id) }) : error(`No entry ${id}.`);
      }
      if (!input.type || !input.title) return error("type and title are required to create an entry.");
      const entry = await createEntry(e, { ...input, type: input.type, title: input.title }, user!.id, "mcp");
      return ok({ ...entry, url: urlFor(e, entry.id) });
    })
  );

  server.registerTool(
    "add_link",
    {
      title: "Attach a link",
      description:
        "Attaches a URL to an item or entry, such as the manufacturer's manual page. With store_copy: true, the file at the URL (a PDF or image, not a web page) is downloaded and kept, and its text becomes searchable a little later. Prefer store_copy for manual PDFs, since manufacturer links often stop working.",
      inputSchema: linkInput,
      annotations: { ...WRITE, openWorldHint: true }
    },
    tool(async (input: z.infer<typeof linkInput>) => {
      const problem = await checkTarget(e, { itemId: input.item_id ?? null, entryId: input.entry_id ?? null });
      if (problem) return error(problem);
      const { file, extract } = await addLink(e, input, user!.id);
      waitUntil(extract());
      return ok({ ...file, url: file.url, open_url: urlFor(e, file.id) });
    })
  );

  /** Exactly one of item_id and entry_id, and it must exist. */
  const oneTarget = async (a: { item_id?: string | undefined; entry_id?: string | undefined }): Promise<string | undefined> => {
    if (!a.item_id === !a.entry_id) return "Pass exactly one of item_id or entry_id. To file a new receipt, create it with save_entry first.";
    return checkTarget(e, { itemId: a.item_id ?? null, entryId: a.entry_id ?? null });
  };

  server.registerTool(
    "create_upload_link",
    {
      title: "Create an upload link",
      description:
        "Returns a one-time link where the user can upload files (PDFs, photos, scans) to an item or entry from any device, without signing in. Use it whenever the user wants to attach a file they have, such as a receipt or manual they shared in this conversation, because you can't pass their attachment to a tool. Give the user the link. It accepts one upload of one or more files and expires after an hour. If you have the file in a sandbox that can reach this server, you can upload it yourself with the returned script_upload command, which answers in JSON. If the file came by email, forwarding that email to the returned email_to address files it on the same record. To file a receipt that isn't in the inventory yet, create it with save_entry first and pass its id.",
      inputSchema: uploadLinkInput,
      annotations: WRITE
    },
    tool(async (a: z.infer<typeof uploadLinkInput>) => {
      const problem = await oneTarget(a);
      if (problem) return error(problem);
      const { token, expiresAt } = await createUploadLink(e, { itemId: a.item_id ?? null, entryId: a.entry_id ?? null }, a.kind, user!.id);
      const id = a.item_id ?? a.entry_id!;
      return ok({
        upload_url: `${base(e)}/u/${token}`,
        expires_at: new Date(expiresAt).toISOString(),
        uses: 1,
        script_upload: `curl -F file=@<path> ${base(e)}/u/${token}`,
        email_to: ingestAddressFor(e.INGEST_ADDRESS, id)
      });
    })
  );

  server.registerTool(
    "upload_file",
    {
      title: "Upload a file from its bytes",
      description: `Stores a file on an item or entry from its exact bytes, base64-encoded. Only use it when you have the file's original bytes, for example a file read from disk. Never rebuild a file from text or page images you were shown: the server rejects data that doesn't start with the declared type's signature. Up to ${MAX_INLINE_FILE_BYTES / 1024 / 1024} MB. If you don't have the bytes, use create_upload_link instead.`,
      inputSchema: uploadFileInput,
      annotations: WRITE
    },
    tool(async (a: z.infer<typeof uploadFileInput>) => {
      const problem = await oneTarget(a);
      if (problem) return error(problem);
      const bytes = decodeBase64(a.data_base64);
      if (!bytes?.length) return error("data_base64 isn't valid base64.");
      if (bytes.length > MAX_INLINE_FILE_BYTES) return error(`The file is over ${MAX_INLINE_FILE_BYTES / 1024 / 1024} MB. Use create_upload_link instead.`);
      const bad = checkSignature(a.content_type, bytes);
      if (bad) return error(`Not saved: ${bad}. If you don't have the original file, use create_upload_link.`);
      const { file, extract } = await storeFile(e, {
        itemId: a.item_id ?? null,
        entryId: a.entry_id ?? null,
        body: bytes,
        name: a.name,
        contentType: a.content_type,
        kind: a.kind,
        userId: user!.id
      });
      waitUntil(extract());
      return ok({ ...file, open_url: urlFor(e, file.id) });
    })
  );

  server.registerTool(
    "read_file",
    {
      title: "Read a file's text",
      description:
        "Returns extracted text from a stored file (a manual, a scanned receipt), starting at offset. Use it to page through a long manual after search found the right file. text_status 'pending' means extraction hasn't finished yet.",
      inputSchema: z.object({
        id: z.string().max(40),
        offset: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(500).max(50_000).default(20_000)
      }),
      annotations: READ
    },
    tool(async ({ id, offset, max_chars }: { id: string; offset: number; max_chars: number }) => {
      const slice = await readText(e, id, offset, max_chars);
      if (!slice) return error(`No file ${id}.`);
      return ok({ ...slice, file: { ...slice.file, open_url: urlFor(e, id) } });
    })
  );

  server.registerTool(
    "delete",
    {
      title: "Delete a record",
      description:
        "Permanently deletes an item (with its warranties and files), an entry (with its files), a warranty, or a file, by ID. It can't be undone. Confirm with the user first. For an item that's gone but worth remembering, use save_item with archived: true instead.",
      inputSchema: z.object({ id: z.string().max(40) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    tool(async ({ id }: { id: string }) => {
      const deleted = id.startsWith("itm_")
        ? await deleteItem(e, id)
        : id.startsWith("ent_")
          ? await deleteEntry(e, id)
          : id.startsWith("wty_")
            ? await deleteWarranty(e, id)
            : id.startsWith("fil_")
              ? await deleteFile(e, id)
              : undefined;
      if (deleted === undefined) return error("IDs start with itm_, ent_, wty_ or fil_.");
      return deleted ? ok({ deleted: id }) : error(`Nothing found with id ${id}.`);
    })
  );

  server.registerTool(
    "email_senders",
    {
      title: "Manage email ingest senders",
      description:
        "Lists, adds or removes addresses allowed to email receipts and documents to the inventory's ingest address. Mail from any other sender is rejected.",
      inputSchema: z.object({ action: z.enum(["list", "add", "remove"]), address: z.string().max(254).optional() }),
      annotations: { ...WRITE, idempotentHint: true }
    },
    tool(async ({ action, address }: { action: "list" | "add" | "remove"; address?: string }) => {
      if (action !== "list") {
        const parsed = emailAddress.safeParse(address);
        if (!parsed.success) return error("address must be a valid email address.");
        if (action === "add") await addSender(e, parsed.data, user!.id);
        else await removeSender(e, parsed.data);
      }
      return ok({ ingest_address: e.INGEST_ADDRESS || null, senders: (await listSenders(e)).map((s) => s.address) });
    })
  );

  return server;
};

/** Serves /mcp. Built lazily so the allowed hostname comes from PUBLIC_URL. */
let handler: ReturnType<typeof createMcpHandler> | undefined;
export const mcpHandler = (e: Env): ReturnType<typeof createMcpHandler> => {
  if (!handler) {
    const host = e.PUBLIC_URL ? new URL(e.PUBLIC_URL).hostname : undefined;
    handler = createMcpHandler(buildServer, { route: "/mcp", ...(host ? { allowedHostnames: [host, "localhost", "127.0.0.1"] } : {}) });
  }
  return handler;
};
