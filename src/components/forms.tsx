/** Forms for warranties, entries, and free-form extra fields. */
import { useState } from "react";
import type { Entry, FieldValues, ItemSummary, Warranty } from "../../shared/api";
import { ENTRY_TYPES, entryType, WARRANTY_KINDS, type FieldDef, type WarrantyKind } from "../../shared/entry-types";
import { api, useApi } from "../api";
import { titleCase } from "../format";
import { PlusIcon, TrashIcon } from "./icons";
import { ErrorNotice, Field, orNull } from "./ui";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const WarrantyForm = ({
  itemId,
  warranty,
  onSaved,
  onCancel
}: {
  itemId: string;
  warranty?: Warranty;
  onSaved: () => void;
  onCancel: () => void;
}) => {
  const [d, setD] = useState({
    provider: warranty?.provider ?? "",
    kind: (warranty?.kind ?? "manufacturer") as WarrantyKind,
    starts_on: warranty?.starts_on ?? "",
    ends_on: warranty?.ends_on ?? "",
    coverage: warranty?.coverage ?? "",
    contact: warranty?.contact ?? "",
    policy_number: warranty?.policy_number ?? "",
    notes: warranty?.notes ?? ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: keyof typeof d) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [key]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(undefined);
    const body = {
      provider: d.provider.trim(),
      kind: d.kind,
      starts_on: orNull(d.starts_on),
      ends_on: orNull(d.ends_on),
      coverage: orNull(d.coverage),
      contact: orNull(d.contact),
      policy_number: orNull(d.policy_number),
      notes: orNull(d.notes)
    };
    try {
      await api(warranty ? `/api/warranties/${warranty.id}` : `/api/items/${itemId}/warranties`, { method: warranty ? "PATCH" : "POST", body });
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="form-grid">
        <Field label="Provider" hint="Who honors it: the brand, a store plan, a credit card">
          <input className="input" required autoFocus value={d.provider} onChange={set("provider")} />
        </Field>
        <Field label="Type">
          <select className="select" value={d.kind} onChange={set("kind")}>
            {WARRANTY_KINDS.map((k) => (
              <option key={k} value={k}>
                {titleCase(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starts">
          <input className="input" type="date" value={d.starts_on} onChange={set("starts_on")} />
        </Field>
        <Field label="Ends" hint="Leave empty for lifetime coverage">
          <input className="input" type="date" value={d.ends_on} onChange={set("ends_on")} />
        </Field>
        <Field label="Coverage" wide>
          <input className="input" placeholder="Parts and labor" value={d.coverage} onChange={set("coverage")} />
        </Field>
        <Field label="How to claim">
          <input className="input" placeholder="Phone, website or email" value={d.contact} onChange={set("contact")} />
        </Field>
        <Field label="Policy number">
          <input className="input" value={d.policy_number} onChange={set("policy_number")} />
        </Field>
        <Field label="Notes" wide>
          <textarea className="textarea" value={d.notes} onChange={set("notes")} />
        </Field>
      </div>
      <ErrorNotice error={error} />
      <div className="form-actions">
        <button className="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : warranty ? "Save" : "Add warranty"}
        </button>
      </div>
    </form>
  );
};

const fieldText = (def: FieldDef, value: FieldValues[string] | undefined): string => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(def.kind === "list" ? "\n" : ", ");
  return String(value);
};

/** One input for a typed entry field. */
const TypedField = ({ def, value, onChange }: { def: FieldDef; value: string; onChange: (v: string) => void }) => {
  const common = { value, onChange: (e: { target: { value: string } }) => onChange(e.target.value), placeholder: def.hint ?? "" };
  switch (def.kind) {
    case "longtext":
    case "list":
      return <textarea className="textarea" rows={def.kind === "list" ? 3 : 4} {...common} />;
    case "date":
      return <input className="input" type="date" {...common} />;
    case "money":
    case "number":
      return <input className="input" inputMode="decimal" {...common} />;
    case "url":
      return <input className="input" type="url" {...common} />;
    default:
      return <input className="input" {...common} />;
  }
};

export const EntryForm = ({
  entry,
  type: initialType,
  defaultType,
  itemId,
  onSaved,
  onCancel
}: {
  entry?: Entry;
  /** Fixes the type and hides the type picker. */
  type?: string;
  /** Preselects a type in the picker. */
  defaultType?: string;
  itemId?: string;
  onSaved: (entry: Entry) => void;
  onCancel: () => void;
}) => {
  const [type, setType] = useState(entry?.type ?? initialType ?? defaultType ?? ENTRY_TYPES[0]!.id);
  const [title, setTitle] = useState(entry?.title ?? "");
  const [occurred, setOccurred] = useState(entry?.occurred_on ?? (entry ? "" : new Date().toISOString().slice(0, 10)));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [item, setItem] = useState(entry?.item_id ?? itemId ?? "");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((entryType(entry?.type ?? type)?.fields ?? []).map((f) => [f.key, fieldText(f, entry?.fields[f.key])]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const items = useApi<ItemSummary[]>(itemId ? null : "/api/items");
  const def = entryType(type);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    const fields: FieldValues = {};
    for (const f of def?.fields ?? []) {
      const v = values[f.key]?.trim() ?? "";
      fields[f.key] = v === "" ? null : v;
    }
    const body = { type, title: title.trim(), occurred_on: orNull(occurred), notes: orNull(notes), item_id: item || null, fields };
    try {
      onSaved(await api<Entry>(entry ? `/api/entries/${entry.id}` : "/api/entries", { method: entry ? "PATCH" : "POST", body }));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="form-grid">
        {!entry && !initialType && (
          <Field label="Type">
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {ENTRY_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.singular}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Title" wide={!!entry || !!initialType}>
          <input className="input" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
        </Field>
        {!itemId && (
          <Field label="Item" hint="Optional">
            <select className="select" value={item} onChange={(e) => setItem(e.target.value)}>
              <option value="">Not linked</option>
              {items.data?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {def?.fields
          .filter((f) => f.key !== "from" || values.from)
          .map((f) => (
            <Field key={f.key} label={f.label} wide={f.kind === "list" || f.kind === "longtext"} {...(f.kind === "list" ? { hint: "One per line" } : {})}>
              <TypedField def={f} value={values[f.key] ?? ""} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} />
            </Field>
          ))}
        <Field label="Notes" wide>
          <textarea className="textarea" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <ErrorNotice error={error} />
      <div className="form-actions">
        <button className="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : entry ? "Save" : `Add ${(def?.singular ?? "entry").toLowerCase()}`}
        </button>
      </div>
    </form>
  );
};

/** Edits an item's extra fields as key/value rows. */
export const ExtraFields = ({ itemId, fields, onSaved }: { itemId: string; fields: FieldValues; onSaved: () => void }) => {
  const [rows, setRows] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(fields).map(([key, value]) => ({ key, value: Array.isArray(value) ? value.join(", ") : String(value ?? "") }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);

  const update = (i: number, change: Partial<{ key: string; value: string }>) => {
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...change } : r)));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    const next: FieldValues = {};
    for (const k of Object.keys(fields)) next[k] = null;
    for (const r of rows) {
      const key = r.key.trim().toLowerCase().replace(/\s+/g, "_");
      if (key && r.value.trim()) next[key] = r.value.trim();
    }
    try {
      await api(`/api/items/${itemId}`, { method: "PATCH", body: { fields: next } });
      setDirty(false);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {rows.length === 0 && <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Anything else: filter size, paint color, firmware version.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6 }}>
            <input className="input" style={{ flex: "0 0 40%" }} placeholder="Name" value={r.key} onChange={(e) => update(i, { key: e.target.value })} aria-label="Field name" />
            <input className="input" placeholder="Value" value={r.value} onChange={(e) => update(i, { value: e.target.value })} aria-label="Field value" />
            <button
              className="icon-button"
              type="button"
              aria-label="Remove field"
              onClick={() => {
                setRows((all) => all.filter((_, j) => j !== i));
                setDirty(true);
              }}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
      <ErrorNotice error={error} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn small" type="button" onClick={() => setRows((all) => [...all, { key: "", value: "" }])}>
          <PlusIcon />
          Add field
        </button>
        {dirty && (
          <button className="btn small primary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save fields"}
          </button>
        )}
      </div>
    </div>
  );
};
