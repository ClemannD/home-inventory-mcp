/**
 * Input schemas for writes. The REST API and the MCP tools both validate
 * against these, so a field added here is accepted by both.
 */
import { z } from "zod";
import { ENTRY_TYPES, FILE_KINDS, WARRANTY_KINDS } from "./entry-types";

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "not a real date");

const text = (max: number) => z.string().trim().max(max).nullish();

export const fieldValue = z.union([z.string().max(10_000), z.number(), z.boolean(), z.array(z.string().max(500)).max(100), z.null()]);
export const fieldsSchema = z.record(z.string().min(1).max(60), fieldValue);

export const itemInput = z.object({
  name: z.string().trim().min(1).max(200).describe("What the user calls it, e.g. 'Living room TV'"),
  category: text(80).describe("e.g. tv, range, washer, hvac, furniture, tool"),
  location: text(120).describe("Room or place, e.g. 'Kitchen', 'Garage'"),
  brand: text(120),
  model: text(120).describe("Model number"),
  serial: text(120).describe("Serial number"),
  purchased_on: isoDate.nullish().describe("YYYY-MM-DD"),
  price: z.number().min(0).max(1e9).nullish().describe("Purchase price in major currency units, e.g. 1599.99"),
  retailer: text(120),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20).optional().describe("Other names people use, e.g. ['big tv']"),
  notes: z.string().max(20_000).nullish(),
  fields: fieldsSchema.optional().describe("Extra attributes as key/value pairs, e.g. {\"filter_size\": \"16x25x1\"}"),
  archived: z.boolean().optional().describe("True when the item is gone (sold, thrown out) but its history should stay")
});
export const itemPatch = itemInput.partial();
export type ItemInput = z.infer<typeof itemInput>;
export type ItemPatch = z.infer<typeof itemPatch>;

export const warrantyInput = z.object({
  provider: z.string().trim().min(1).max(120).describe("Who honors it, e.g. 'LG' or 'Chase Sapphire'"),
  kind: z.enum(WARRANTY_KINDS).default("manufacturer"),
  starts_on: isoDate.nullish(),
  ends_on: isoDate.nullish().describe("YYYY-MM-DD. Omit for lifetime warranties"),
  coverage: text(500).describe("What's covered, e.g. 'parts and labor'"),
  contact: text(300).describe("How to file a claim: phone, URL or email"),
  policy_number: text(120),
  notes: z.string().max(5_000).nullish()
});
export const warrantyPatch = warrantyInput.partial();
export type WarrantyInput = z.infer<typeof warrantyInput>;
export type WarrantyPatch = z.infer<typeof warrantyPatch>;

export const entryTypeId = z.enum(ENTRY_TYPES.map((t) => t.id) as [string, ...string[]]);

export const entryInput = z.object({
  type: entryTypeId,
  title: z.string().trim().min(1).max(300),
  item_id: z.string().max(40).nullish().describe("Link to an item, or null"),
  occurred_on: isoDate.nullish().describe("YYYY-MM-DD: purchase date, service date, and so on"),
  notes: z.string().max(100_000).nullish(),
  fields: fieldsSchema.optional()
});
export const entryPatch = entryInput.partial();
export type EntryInput = z.infer<typeof entryInput>;
export type EntryPatch = z.infer<typeof entryPatch>;

export const fileKind = z.enum(FILE_KINDS);

export const filePatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  kind: fileKind.optional(),
  item_id: z.string().max(40).nullish(),
  entry_id: z.string().max(40).nullish()
});
export type FilePatch = z.infer<typeof filePatch>;

export const linkInput = z.object({
  url: z.url({ protocol: /^https?$/ }),
  name: z.string().trim().min(1).max(200).optional(),
  kind: fileKind.default("manual"),
  item_id: z.string().max(40).nullish(),
  entry_id: z.string().max(40).nullish(),
  store_copy: z.boolean().default(false).describe("Download the file and keep a copy, in case the link stops working")
});
export type LinkInput = z.infer<typeof linkInput>;

export const emailAddress = z.email().max(254).transform((s) => s.trim().toLowerCase());
