/**
 * Entry types: the kinds of records that aren't items. Each one gets a tab in
 * the UI, a value for `entries.type`, and a field list that the UI renders as
 * a form and the MCP tools describe to the model.
 *
 * To add a use case, add a type here. Fields are stored as JSON, so no
 * migration is needed. Values for keys not listed here are kept as-is.
 */

export type FieldKind = "text" | "longtext" | "money" | "number" | "date" | "url" | "list";

export interface FieldDef {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  /** Shown to the model in tool descriptions and as placeholder text in the UI. */
  readonly hint?: string;
}

export interface EntryTypeDef {
  readonly id: string;
  /** Plural, for the tab. */
  readonly label: string;
  readonly singular: string;
  readonly description: string;
  readonly fields: readonly FieldDef[];
  /** Field keys shown as columns in the list view. */
  readonly columns: readonly string[];
}

export const ENTRY_TYPES: readonly EntryTypeDef[] = [
  {
    id: "receipt",
    label: "Receipts",
    singular: "Receipt",
    description:
      "Purchase and shipping receipts. Can be linked to an item or stand alone, for example a receipt kept only for its tracking number. Delete them when they're no longer needed.",
    fields: [
      { key: "merchant", label: "Merchant", kind: "text", hint: "Costco" },
      { key: "total", label: "Total", kind: "money" },
      { key: "order_number", label: "Order number", kind: "text" },
      { key: "tracking_numbers", label: "Tracking numbers", kind: "list", hint: "One per line" },
      { key: "return_by", label: "Return by", kind: "date" },
      { key: "from", label: "Emailed from", kind: "text" }
    ],
    columns: ["merchant", "total", "tracking_numbers"]
  },
  {
    id: "service",
    label: "Service log",
    singular: "Service record",
    description: "Repairs, maintenance and problems, usually linked to an item. For example a filter change or a technician visit.",
    fields: [
      { key: "provider", label: "Done by", kind: "text", hint: "Company or person" },
      { key: "cost", label: "Cost", kind: "money" },
      { key: "next_due", label: "Next due", kind: "date" }
    ],
    columns: ["provider", "cost", "next_due"]
  },
  {
    id: "note",
    label: "Notes",
    singular: "Note",
    description: "Anything else worth keeping: a paint color, a Wi-Fi password location, a contractor's phone number.",
    fields: [],
    columns: []
  }
];

export const DEFAULT_ENTRY_TYPE = "receipt";

export const entryType = (id: string): EntryTypeDef | undefined => ENTRY_TYPES.find((t) => t.id === id);

export const FILE_KINDS = ["photo", "manual", "receipt", "warranty", "document"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const WARRANTY_KINDS = ["manufacturer", "extended", "credit_card", "retailer", "other"] as const;
export type WarrantyKind = (typeof WARRANTY_KINDS)[number];
