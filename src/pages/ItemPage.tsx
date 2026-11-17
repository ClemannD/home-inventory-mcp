import { useState } from "react";
import type { ItemDetail, Warranty } from "../../shared/api";
import { entryType } from "../../shared/entry-types";
import { api, useApi } from "../api";
import { Attachments, Photos } from "../components/Attachments";
import { EntryForm, ExtraFields, WarrantyForm } from "../components/forms";
import { ArchiveIcon, EntryTypeIcon, PencilIcon, PlusIcon, ShieldIcon, TrashIcon } from "../components/icons";
import { ItemForm } from "../components/ItemForm";
import { Topbar, useMe } from "../components/Shell";
import { Dialog, ErrorNotice, Loading, WarrantyPill } from "../components/ui";
import { date, money, titleCase } from "../format";
import { navigate } from "../router";

export const ItemPage = ({ id }: { id: string }) => {
  const { me, refresh } = useMe();
  const item = useApi<ItemDetail>(`/api/items/${id}`);
  const [editing, setEditing] = useState(false);
  const [warranty, setWarranty] = useState<Warranty | "new" | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);
  const [error, setError] = useState<string>();

  if (!item.data) {
    return (
      <>
        <Topbar crumbs={[{ label: "Items", href: "/items" }, { label: item.error ? "Not found" : "…" }]} />
        <div className="page">{item.error ? <ErrorNotice error={item.error} /> : <Loading />}</div>
      </>
    );
  }
  const it = item.data;
  const photos = it.files.filter((f) => f.kind === "photo");
  const documents = it.files.filter((f) => f.kind !== "photo");

  const archive = async () => {
    try {
      await api(`/api/items/${id}`, { method: "PATCH", body: { archived: !it.archived } });
      item.reload();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${it.name}? Its warranties, photos and files are deleted too. Linked records are kept.`)) return;
    try {
      await api(`/api/items/${id}`, { method: "DELETE" });
      refresh();
      navigate("/items");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteWarranty = async (w: Warranty) => {
    if (!confirm(`Delete the ${w.provider} warranty?`)) return;
    await api(`/api/warranties/${w.id}`, { method: "DELETE" });
    item.reload();
  };

  const facts: [string, string | null][] = [
    ["Brand", it.brand],
    ["Model", it.model],
    ["Serial", it.serial],
    ["Category", it.category],
    ["Location", it.location],
    ["Purchased", date(it.purchased_on) || null],
    ["Price", it.price == null ? null : money(it.price, me.currency)],
    ["Bought from", it.retailer],
    ["Also called", it.aliases.join(", ") || null]
  ];

  return (
    <>
      <Topbar
        crumbs={[{ label: "Items", href: "/items" }, { label: it.name }]}
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
            <h1 className="page-title">{it.name}</h1>
            <p className="page-sub">
              {[it.brand, it.model].filter(Boolean).join(" ") || "No model recorded"}
              {it.location ? ` · ${it.location}` : ""}
              {it.archived ? " · Archived" : ""}
            </p>
          </div>
        </div>
        <ErrorNotice error={error} />

        <div className="detail">
          <div>
            <Photos itemId={id} photos={photos} onChange={item.reload} />

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Warranties</h2>
                <button className="btn small" type="button" onClick={() => setWarranty("new")}>
                  <PlusIcon />
                  Add warranty
                </button>
              </div>
              {it.warranties.length === 0 ? (
                <p className="list-empty">No warranties recorded.</p>
              ) : (
                <div className="list">
                  {it.warranties.map((w) => (
                    <div key={w.id} className="list-row">
                      <ShieldIcon />
                      <button className="grow" type="button" style={{ textAlign: "left" }} onClick={() => setWarranty(w)}>
                        <span className="title">
                          {w.provider} <span className="muted" style={{ fontWeight: 400 }}>· {titleCase(w.kind)}</span>
                        </span>
                        <span className="sub">{[w.coverage, w.contact, w.policy_number && `Policy ${w.policy_number}`].filter(Boolean).join(" · ") || "Click to add details"}</span>
                      </button>
                      <WarrantyPill warranty={w} />
                      <button className="icon-button" type="button" aria-label={`Delete ${w.provider} warranty`} onClick={() => void deleteWarranty(w)}>
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Attachments title="Manuals and documents" target={{ item: id }} files={documents} defaultKind="manual" onChange={item.reload} />

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">History</h2>
                <button className="btn small" type="button" onClick={() => setAddingEntry(true)}>
                  <PlusIcon />
                  Add record
                </button>
              </div>
              {it.entries.length === 0 ? (
                <p className="list-empty">Repairs, maintenance, receipts and notes linked to this item show up here.</p>
              ) : (
                <div className="list">
                  {it.entries.map((e) => (
                    <a key={e.id} className="list-row" href={`/entries/${e.id}`}>
                      <EntryTypeIcon type={e.type} />
                      <span className="grow">
                        <span className="title">{e.title}</span>
                        <span className="sub">
                          {entryType(e.type)?.singular ?? e.type}
                          {e.occurred_on ? ` · ${date(e.occurred_on)}` : ""}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside>
            <div className="panel">
              <dl className="facts">
                {facts
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} style={{ display: "contents" }}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
              {facts.every(([, v]) => !v) && <p className="muted">No details yet.</p>}
            </div>
            <div className="panel">
              <h2 className="section-title" style={{ marginBottom: 10 }}>
                Other details
              </h2>
              <ExtraFields key={it.updated_at} itemId={id} fields={it.fields} onSaved={item.reload} />
            </div>
            {it.notes && (
              <div className="panel">
                <h2 className="section-title" style={{ marginBottom: 8 }}>
                  Notes
                </h2>
                <p className="notes">{it.notes}</p>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn small" type="button" onClick={() => void archive()}>
                <ArchiveIcon />
                {it.archived ? "Restore" : "Archive"}
              </button>
              <button className="btn small danger" type="button" onClick={() => void remove()}>
                <TrashIcon />
                Delete
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Archive items you no longer have but want to remember. Delete removes everything.
            </p>
          </aside>
        </div>
      </div>

      <Dialog title="Edit item" open={editing} onClose={() => setEditing(false)}>
        <ItemForm
          item={it}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            item.setData(updated);
            refresh();
          }}
        />
      </Dialog>
      <Dialog title={warranty === "new" ? "Add a warranty" : "Edit warranty"} open={warranty !== null} onClose={() => setWarranty(null)}>
        {warranty !== null && (
          <WarrantyForm
            itemId={id}
            {...(warranty === "new" ? {} : { warranty })}
            onCancel={() => setWarranty(null)}
            onSaved={() => {
              setWarranty(null);
              item.reload();
            }}
          />
        )}
      </Dialog>
      <Dialog title="Add a record" open={addingEntry} onClose={() => setAddingEntry(false)}>
        <EntryForm
          itemId={id}
          defaultType="service"
          onCancel={() => setAddingEntry(false)}
          onSaved={() => {
            setAddingEntry(false);
            item.reload();
            refresh();
          }}
        />
      </Dialog>
    </>
  );
};
