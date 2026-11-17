import { useState } from "react";
import type { Entry } from "../../shared/api";
import { entryType } from "../../shared/entry-types";
import { api, useApi } from "../api";
import { Attachments } from "../components/Attachments";
import { EntryForm } from "../components/forms";
import { PencilIcon, TrashIcon } from "../components/icons";
import { Topbar, useMe } from "../components/Shell";
import { Dialog, EmailTo, ErrorNotice, Loading } from "../components/ui";
import { date, money } from "../format";
import { navigate } from "../router";

export const EntryPage = ({ id }: { id: string }) => {
  const { me, refresh } = useMe();
  const entry = useApi<Entry>(`/api/entries/${id}`);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();

  if (!entry.data) {
    return (
      <>
        <Topbar crumbs={[{ label: entry.error ? "Not found" : "…" }]} />
        <div className="page">{entry.error ? <ErrorNotice error={entry.error} /> : <Loading />}</div>
      </>
    );
  }
  const e = entry.data;
  const def = entryType(e.type);
  const listHref = `/entries?type=${e.type}`;

  const remove = async () => {
    if (!confirm(`Delete “${e.title}” and its files?`)) return;
    try {
      await api(`/api/entries/${id}`, { method: "DELETE" });
      refresh();
      navigate(listHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Declared fields first, in order, then anything else stored on the entry.
  const known = new Set(def?.fields.map((f) => f.key));
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (e.occurred_on) rows.push({ label: "Date", value: date(e.occurred_on) });
  if (e.item_id) rows.push({ label: "Item", value: <a href={`/items/${e.item_id}`} style={{ color: "var(--blue)" }}>{e.item_name}</a> });
  for (const f of def?.fields ?? []) {
    const v = e.fields[f.key];
    if (v == null || v === "") continue;
    rows.push({
      label: f.label,
      value:
        f.kind === "money" && typeof v === "number" ? (
          money(v, me.currency)
        ) : f.kind === "date" && typeof v === "string" ? (
          date(v)
        ) : Array.isArray(v) ? (
          <span className="chips">
            {v.map((x) => (
              <span key={x} className="chip">
                {x}
              </span>
            ))}
          </span>
        ) : (
          String(v)
        )
    });
  }
  for (const [k, v] of Object.entries(e.fields)) {
    if (!known.has(k) && v != null) rows.push({ label: k.replaceAll("_", " "), value: Array.isArray(v) ? v.join(", ") : String(v) });
  }

  return (
    <>
      <Topbar
        crumbs={[{ label: def?.label ?? e.type, href: listHref }, { label: e.title }]}
        actions={
          <button className="btn small" type="button" onClick={() => setEditing(true)}>
            <PencilIcon />
            Edit
          </button>
        }
      />
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">{e.title}</h1>
            <p className="page-sub">
              {def?.singular ?? e.type}
              {e.source === "email" ? " · from email" : e.source === "mcp" ? " · added by an assistant" : ""}
            </p>
          </div>
        </div>
        <ErrorNotice error={error} />
        <div className="detail">
          <div>
            {rows.length > 0 && (
              <section className="section">
                <dl className="facts">
                  {rows.map((r) => (
                    <div key={r.label} style={{ display: "contents" }}>
                      <dt>{r.label}</dt>
                      <dd>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            <Attachments title="Files" target={{ entry: id }} files={e.files} defaultKind={e.type === "receipt" ? "receipt" : "document"} onChange={entry.reload} />
            {e.notes && (
              <section className="section">
                <h2 className="section-title" style={{ marginBottom: 12 }}>
                  {e.source === "email" ? "Email" : "Notes"}
                </h2>
                <div className="panel">
                  <p className="notes">{e.notes}</p>
                </div>
              </section>
            )}
          </div>
          <aside>
            <button className="btn small danger" type="button" onClick={() => void remove()}>
              <TrashIcon />
              Delete {def?.singular.toLowerCase() ?? "entry"}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Deletes this record and its files. Delete receipts once you no longer need them.
            </p>
            <EmailTo ingest={me.ingest_address} id={id} />
          </aside>
        </div>
      </div>
      <Dialog title={`Edit ${def?.singular.toLowerCase() ?? "entry"}`} open={editing} onClose={() => setEditing(false)}>
        <EntryForm
          entry={e}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            entry.setData(updated);
            refresh();
          }}
        />
      </Dialog>
    </>
  );
};
