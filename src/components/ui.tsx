/** Small shared pieces: dialog, status pill, thumbnail, form field. */
import { useEffect, useRef, type ReactNode } from "react";
import type { ItemSummary, Warranty } from "../../shared/api";
import { fileUrl } from "../api";
import { warrantyLabel } from "../format";
import { XIcon } from "./icons";

/** A modal <dialog>. Closing (Escape, the X, a backdrop click) calls onClose. */
export const Dialog = ({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="dialog-head">
            <h2>{title}</h2>
            <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
              <XIcon />
            </button>
          </div>
          <div className="dialog-body">{children}</div>
        </>
      )}
    </dialog>
  );
};

export const WarrantyPill = ({ warranty }: { warranty: Pick<Warranty, "status" | "days_left" | "ends_on"> | null }) =>
  warranty ? <span className={`pill ${warranty.status}`}>{warrantyLabel(warranty)}</span> : <span className="muted">No warranty</span>;

export const Thumb = ({ item }: { item: Pick<ItemSummary, "name" | "photo_id"> }) => (
  <span className="thumb">{item.photo_id ? <img src={fileUrl(item.photo_id)} alt="" loading="lazy" /> : item.name.charAt(0).toUpperCase()}</span>
);

export const Field = ({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) => (
  <label className={`field${wide ? " wide" : ""}`}>
    <span>{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
);

export const ErrorNotice = ({ error }: { error: string | undefined }) => (error ? <p className="notice error">{error}</p> : null);

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="empty">
    <strong>{title}</strong>
    {children}
  </div>
);

export const Loading = () => (
  <div className="rows" aria-busy="true" aria-label="Loading">
    {[0, 1, 2].map((i) => (
      <div key={i} className="skeleton" />
    ))}
  </div>
);

/** "" → null, for optional text inputs. */
export const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);
