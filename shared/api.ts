/** Shapes returned by the REST API and the MCP tools. */
import type { FileKind, WarrantyKind } from "./entry-types";

export type FieldValues = Record<string, string | number | boolean | string[] | null>;

export type WarrantyState = "active" | "expiring" | "expired" | "lifetime" | "not_started";

export interface Warranty {
  readonly id: string;
  readonly item_id: string;
  readonly provider: string;
  readonly kind: WarrantyKind;
  readonly starts_on: string | null;
  readonly ends_on: string | null;
  readonly coverage: string | null;
  readonly contact: string | null;
  readonly policy_number: string | null;
  readonly notes: string | null;
  /** Computed from the current date in the deployment's time zone. */
  readonly status: WarrantyState;
  /** Days until `ends_on`; negative once it has passed. Null without an end date. */
  readonly days_left: number | null;
}

export interface FileInfo {
  readonly id: string;
  readonly item_id: string | null;
  readonly entry_id: string | null;
  readonly kind: FileKind;
  readonly name: string;
  readonly content_type: string | null;
  readonly size: number | null;
  /** True when the file is stored in R2. False for a plain link. */
  readonly stored: boolean;
  readonly url: string | null;
  readonly text_status: "none" | "pending" | "done" | "failed" | "unsupported";
  readonly created_at: string;
}

export interface ItemSummary {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly location: string | null;
  readonly brand: string | null;
  readonly model: string | null;
  readonly purchased_on: string | null;
  readonly archived: boolean;
  /** First photo, for thumbnails. */
  readonly photo_id: string | null;
  /** The warranty that ends last, if any. */
  readonly warranty: Pick<Warranty, "status" | "ends_on" | "days_left" | "provider"> | null;
}

export interface Item extends ItemSummary {
  readonly serial: string | null;
  readonly price: number | null;
  readonly retailer: string | null;
  readonly aliases: string[];
  readonly notes: string | null;
  readonly fields: FieldValues;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface EntrySummary {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly item_id: string | null;
  readonly item_name: string | null;
  readonly occurred_on: string | null;
  readonly fields: FieldValues;
  readonly file_count: number;
  readonly source: "manual" | "email" | "mcp";
  readonly created_at: string;
}

export interface Entry extends EntrySummary {
  readonly notes: string | null;
  readonly files: FileInfo[];
  readonly updated_at: string;
}

export interface ItemDetail extends Item {
  readonly warranties: Warranty[];
  readonly files: FileInfo[];
  readonly entries: EntrySummary[];
}

export interface SearchHit {
  readonly kind: "item" | "entry" | "file";
  readonly id: string;
  readonly title: string;
  /** Matching text with the matched terms wrapped in [ ]. */
  readonly snippet: string;
  /** For entries: the entry type. For files: the file kind. */
  readonly subtype: string | null;
  /** For files: the item or entry the file belongs to. */
  readonly parent_id: string | null;
  /** For files: that item's name or entry's title. */
  readonly parent_title: string | null;
}

export interface Member {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: "owner" | "member";
  readonly created_at: string;
  readonly last_sign_in_at: string | null;
}

export interface Me {
  readonly user: Member;
  readonly app_name: string;
  readonly currency: string;
  readonly timezone: string;
  readonly public_url: string;
  readonly ingest_address: string | null;
  readonly email_sending: boolean;
  readonly counts: { readonly items: number; readonly entries: Record<string, number> };
}

export interface PasskeyInfo {
  readonly id: string;
  readonly name: string | null;
  readonly created_at: string;
  readonly last_used_at: string | null;
}

export interface Connection {
  readonly id: string;
  readonly client_id: string;
  readonly client_name: string;
  readonly created_at: string;
}

export interface Facets {
  readonly categories: string[];
  readonly locations: string[];
}
