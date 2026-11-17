/** Create or edit an item's details. */
import { useState } from "react";
import type { Facets, Item, ItemDetail } from "../../shared/api";
import { api, useApi } from "../api";
import { ErrorNotice, Field, orNull } from "./ui";

interface Draft {
  name: string;
  category: string;
  location: string;
  brand: string;
  model: string;
  serial: string;
  purchased_on: string;
  price: string;
  retailer: string;
  aliases: string;
  notes: string;
}

const draftOf = (item?: Item): Draft => ({
  name: item?.name ?? "",
  category: item?.category ?? "",
  location: item?.location ?? "",
  brand: item?.brand ?? "",
  model: item?.model ?? "",
  serial: item?.serial ?? "",
  purchased_on: item?.purchased_on ?? "",
  price: item?.price == null ? "" : String(item.price),
  retailer: item?.retailer ?? "",
  aliases: item?.aliases.join(", ") ?? "",
  notes: item?.notes ?? ""
});

export const ItemForm = ({ item, onSaved, onCancel }: { item?: Item; onSaved: (item: ItemDetail) => void; onCancel: () => void }) => {
  const [d, setD] = useState<Draft>(() => draftOf(item));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const facets = useApi<Facets>("/api/facets");
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [key]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(undefined);
    const price = d.price.trim() ? Number(d.price.replace(/[^0-9.]/g, "")) : null;
    const body = {
      name: d.name.trim(),
      category: orNull(d.category),
      location: orNull(d.location),
      brand: orNull(d.brand),
      model: orNull(d.model),
      serial: orNull(d.serial),
      purchased_on: orNull(d.purchased_on),
      price: price != null && Number.isFinite(price) ? price : null,
      retailer: orNull(d.retailer),
      aliases: d.aliases
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      notes: orNull(d.notes)
    };
    try {
      onSaved(await api<ItemDetail>(item ? `/api/items/${item.id}` : "/api/items", { method: item ? "PATCH" : "POST", body }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      <datalist id="categories">{facets.data?.categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="locations">{facets.data?.locations.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="form-grid">
        <Field label="Name" wide hint="What you call it, like “Living room TV”">
          <input className="input" required autoFocus value={d.name} onChange={set("name")} />
        </Field>
        <Field label="Category">
          <input className="input" list="categories" placeholder="tv, washer, furniture…" value={d.category} onChange={set("category")} />
        </Field>
        <Field label="Location">
          <input className="input" list="locations" placeholder="Kitchen" value={d.location} onChange={set("location")} />
        </Field>
        <Field label="Brand">
          <input className="input" value={d.brand} onChange={set("brand")} />
        </Field>
        <Field label="Model number">
          <input className="input" value={d.model} onChange={set("model")} />
        </Field>
        <Field label="Serial number">
          <input className="input" value={d.serial} onChange={set("serial")} />
        </Field>
        <Field label="Purchased">
          <input className="input" type="date" value={d.purchased_on} onChange={set("purchased_on")} />
        </Field>
        <Field label="Price">
          <input className="input" inputMode="decimal" placeholder="0.00" value={d.price} onChange={set("price")} />
        </Field>
        <Field label="Bought from">
          <input className="input" value={d.retailer} onChange={set("retailer")} />
        </Field>
        <Field label="Other names" wide hint="Comma separated. Helps search and assistants find it, e.g. “big tv”.">
          <input className="input" value={d.aliases} onChange={set("aliases")} />
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
          {busy ? "Saving…" : item ? "Save" : "Add item"}
        </button>
      </div>
    </form>
  );
};
