import { useEffect, useState } from "react";
import type { EntrySummary, FieldValues } from "../../shared/api";
import { entryType, ENTRY_TYPES, type EntryTypeDef } from "../../shared/entry-types";
import { useApi } from "../api";
import { EntryForm } from "../components/forms";
import { EntryTypeIcon, PlusIcon, SearchIcon } from "../components/icons";
import { Topbar, useMe } from "../components/Shell";
import { Dialog, Empty, ErrorNotice, Loading } from "../components/ui";
import { date, money } from "../format";
import { navigate, setQuery, useLocation } from "../router";

/** The type's list columns as short text, e.g. "Costco · $42.10 · 1Z99…". */
const summarize = (def: EntryTypeDef, fields: FieldValues, currency: string): string =>
  def.columns
    .map((key) => {
      const f = def.fields.find((x) => x.key === key);
      const v = fields[key];
      if (v == null || v === "") return null;
      if (f?.kind === "money" && typeof v === "number") return money(v, currency);
      if (f?.kind === "date" && typeof v === "string") return `${f.label} ${date(v)}`;
      return Array.isArray(v) ? v.join(", ") : String(v);
    })
    .filter(Boolean)
    .join(" · ");

export const EntriesPage = () => {
  const { query } = useLocation();
  const { me, refresh } = useMe();
  const def = entryType(query.get("type") ?? "") ?? ENTRY_TYPES[0]!;
  const q = query.get("q") ?? "";
  const [text, setText] = useState(q);
  const [adding, setAdding] = useState(false);
  const params = new URLSearchParams({ type: def.id, ...(q ? { q } : {}) });
  const entries = useApi<EntrySummary[]>(`/api/entries?${params}`);

  useEffect(() => setText(q), [def.id]);
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => setQuery({ q: text.trim() || null }), 200);
    return () => clearTimeout(t);
  }, [text, q]);

  return (
    <>
      <Topbar
        crumbs={[{ label: def.label }]}
        actions={
          <button className="btn primary small" type="button" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add {def.singular.toLowerCase()}
          </button>
        }
      />
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">{def.label}</h1>
            <p className="page-sub">{def.description}</p>
          </div>
        </div>
        {def.id === "receipt" && me.ingest_address && (
          <p className="notice" style={{ marginBottom: 16 }}>
            Forward receipts to <strong style={{ color: "var(--text)" }}>{me.ingest_address}</strong> and they show up here with their attachments.
          </p>
        )}
        <div className="toolbar">
          <label className="search">
            <SearchIcon />
            <input className="input" type="search" placeholder={`Search ${def.label.toLowerCase()}…`} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Search ${def.label}`} />
          </label>
        </div>
        <ErrorNotice error={entries.error} />
        {!entries.data && entries.loading ? (
          <Loading />
        ) : entries.data?.length === 0 ? (
          <Empty title={q ? "Nothing matches" : `No ${def.label.toLowerCase()} yet`}>{q ? "Try other words." : null}</Empty>
        ) : (
          <div className="rows" role="table" aria-label={def.label}>
            <div className="row head entry-row" role="row">
              <span role="columnheader">{def.singular}</span>
              <span role="columnheader">Details</span>
              <span role="columnheader">Item</span>
              <span role="columnheader">Date</span>
            </div>
            {entries.data?.map((e) => (
              <a key={e.id} className="row entry-row" role="row" href={`/entries/${e.id}`}>
                <span className="cell-main" role="cell">
                  <span className="thumb">
                    <EntryTypeIcon type={e.type} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="title" style={{ display: "block" }}>
                      {e.title}
                    </span>
                    <span className="sub" style={{ display: "block" }}>
                      {[e.file_count ? `${e.file_count} file${e.file_count === 1 ? "" : "s"}` : null, e.source === "email" ? "from email" : null].filter(Boolean).join(" · ") ||
                        " "}
                    </span>
                  </span>
                </span>
                <span className="cell-text" role="cell">
                  {summarize(def, e.fields, me.currency)}
                </span>
                <span className="cell-text" role="cell">
                  {e.item_name}
                </span>
                <span className="cell-text num" role="cell">
                  {date(e.occurred_on)}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
      <Dialog title={`Add a ${def.singular.toLowerCase()}`} open={adding} onClose={() => setAdding(false)}>
        <EntryForm
          key={def.id}
          type={def.id}
          onCancel={() => setAdding(false)}
          onSaved={(entry) => {
            setAdding(false);
            refresh();
            navigate(`/entries/${entry.id}`);
          }}
        />
      </Dialog>
    </>
  );
};
