import { useEffect, useState } from "react";
import type { Facets, ItemSummary } from "../../shared/api";
import { useApi } from "../api";
import { ItemForm } from "../components/ItemForm";
import { PlusIcon, SearchIcon } from "../components/icons";
import { Topbar, useMe } from "../components/Shell";
import { Dialog, Empty, ErrorNotice, Loading, Thumb, WarrantyPill } from "../components/ui";
import { date } from "../format";
import { navigate, setQuery, useLocation } from "../router";

const WARRANTY_FILTERS = [
  ["", "Any warranty"],
  ["active", "Covered"],
  ["expiring", "Ending soon"],
  ["expired", "Expired"],
  ["none", "No warranty"]
] as const;

export const ItemsPage = () => {
  const { query } = useLocation();
  const { refresh } = useMe();
  const q = query.get("q") ?? "";
  const [text, setText] = useState(q);
  const [adding, setAdding] = useState(query.get("new") === "1");
  const facets = useApi<Facets>("/api/facets");

  const params = new URLSearchParams();
  for (const key of ["q", "category", "location", "warranty", "archived"]) {
    const v = query.get(key);
    if (v) params.set(key, v);
  }
  const items = useApi<ItemSummary[]>(`/api/items?${params}`);

  // Debounce typing into the URL.
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => setQuery({ q: text.trim() || null }), 200);
    return () => clearTimeout(t);
  }, [text, q]);

  const filtered = params.toString() !== "";

  return (
    <>
      <Topbar
        crumbs={[{ label: "Items" }]}
        actions={
          <button className="btn primary small" type="button" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add item
          </button>
        }
      />
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">Items</h1>
            <p className="page-sub">Appliances, electronics, furniture, and anything else worth tracking.</p>
          </div>
        </div>

        <div className="toolbar">
          <label className="search">
            <SearchIcon />
            <input className="input" type="search" placeholder="Search name, model, serial, notes, manuals…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search items" />
          </label>
          <select className="select" value={query.get("location") ?? ""} onChange={(e) => setQuery({ location: e.target.value })} aria-label="Location">
            <option value="">All locations</option>
            {facets.data?.locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select className="select" value={query.get("category") ?? ""} onChange={(e) => setQuery({ category: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {facets.data?.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className="select" value={query.get("warranty") ?? ""} onChange={(e) => setQuery({ warranty: e.target.value })} aria-label="Warranty">
            {WARRANTY_FILTERS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <select className="select" value={query.get("archived") ?? ""} onChange={(e) => setQuery({ archived: e.target.value })} aria-label="Show">
            <option value="">Current items</option>
            <option value="1">Archived items</option>
          </select>
        </div>

        <ErrorNotice error={items.error} />
        {!items.data && items.loading ? (
          <Loading />
        ) : items.data && items.data.length === 0 ? (
          filtered ? (
            <Empty title="Nothing matches">Try other words or clear the filters.</Empty>
          ) : (
            <Empty title="No items yet">
              <p style={{ marginBottom: 16 }}>Add the things you'd want to look up later: appliances, electronics, tools.</p>
              <button className="btn primary" type="button" onClick={() => setAdding(true)}>
                <PlusIcon />
                Add your first item
              </button>
            </Empty>
          )
        ) : (
          <div className="rows" role="table" aria-label="Items">
            <div className="row head item-row" role="row">
              <span role="columnheader">Item</span>
              <span role="columnheader">Location</span>
              <span role="columnheader">Category</span>
              <span role="columnheader">Warranty</span>
              <span role="columnheader">Purchased</span>
            </div>
            {items.data?.map((item) => (
              <a key={item.id} className="row item-row" role="row" href={`/items/${item.id}`}>
                <span className="cell-main" role="cell">
                  <Thumb item={item} />
                  <span style={{ minWidth: 0 }}>
                    <span className="title" style={{ display: "block" }}>
                      {item.name}
                    </span>
                    <span className="sub" style={{ display: "block" }}>
                      {[item.brand, item.model].filter(Boolean).join(" ") || item.category || " "}
                    </span>
                  </span>
                </span>
                <span className="cell-text" role="cell">
                  {item.location}
                </span>
                <span className="cell-text" role="cell">
                  {item.category}
                </span>
                <span role="cell">
                  <WarrantyPill warranty={item.warranty} />
                </span>
                <span className="cell-text num" role="cell">
                  {date(item.purchased_on)}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      <Dialog title="Add an item" open={adding} onClose={() => (setAdding(false), setQuery({ new: null }))}>
        <ItemForm
          onCancel={() => (setAdding(false), setQuery({ new: null }))}
          onSaved={(item) => {
            setAdding(false);
            refresh();
            navigate(`/items/${item.id}`);
          }}
        />
      </Dialog>
    </>
  );
};
