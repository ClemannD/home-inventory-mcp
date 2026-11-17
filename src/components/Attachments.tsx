/**
 * Files on an item or entry: upload, scan with the camera into a PDF, add a
 * link, open and delete. Photos of items get their own grid.
 */
import { useRef, useState, type DragEvent } from "react";
import type { FileInfo } from "../../shared/api";
import { FILE_KINDS, type FileKind } from "../../shared/entry-types";
import { api, fileUrl, uploadFile } from "../api";
import { bytes, titleCase } from "../format";
import { imagesToPdf } from "../pdf";
import { CameraIcon, FileIcon, LinkIcon, PlusIcon, TrashIcon, UploadIcon } from "./icons";
import { Dialog, ErrorNotice, Field } from "./ui";

export interface Target {
  readonly item?: string;
  readonly entry?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const describe = (f: FileInfo): string => {
  const parts: string[] = [titleCase(f.kind)];
  if (f.stored) parts.push(bytes(f.size));
  else parts.push(f.url ? new URL(f.url).hostname : "link");
  if (f.text_status === "pending") parts.push("reading text…");
  if (f.text_status === "done") parts.push("searchable");
  return parts.join(" · ");
};

const remove = async (f: FileInfo, onChange: () => void) => {
  if (!confirm(`Delete ${f.name}?`)) return;
  await api(`/api/files/${f.id}`, { method: "DELETE" });
  onChange();
};

/** Takes photos with the camera and saves them as one PDF. */
const Scanner = ({ target, defaultKind, open, onClose, onSaved }: { target: Target; defaultKind: FileKind; open: boolean; onClose: () => void; onSaved: () => void }) => {
  const input = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<{ blob: Blob; url: string }[]>([]);
  const [name, setName] = useState(`Scan ${today()}`);
  const [kind, setKind] = useState<FileKind>(defaultKind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const reset = () => {
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
    setError(undefined);
    setName(`Scan ${today()}`);
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const pdf = await imagesToPdf(pages.map((p) => p.blob));
      const file = name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
      await uploadFile(pdf, { name: file, kind, ...target });
      reset();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Scan a document" open={open} onClose={() => (reset(), onClose())}>
      <p className="muted">Take a photo of each page. They're saved together as one PDF.</p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          setPages((all) => [...all, ...files.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))]);
          e.target.value = "";
        }}
      />
      {pages.length > 0 && (
        <div className="scan-pages">
          {pages.map((p, i) => (
            <div key={p.url} className="scan-page">
              <img src={p.url} alt={`Page ${i + 1}`} />
              <span>{i + 1}</span>
            </div>
          ))}
        </div>
      )}
      <button className="btn" type="button" style={{ marginTop: 12 }} onClick={() => input.current?.click()}>
        <CameraIcon />
        {pages.length ? "Add a page" : "Take a photo"}
      </button>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kind">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
            {FILE_KINDS.map((k) => (
              <option key={k} value={k}>
                {titleCase(k)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNotice error={error} />
      <div className="form-actions">
        <button className="btn ghost" type="button" onClick={() => (reset(), onClose())}>
          Cancel
        </button>
        <button className="btn primary" type="button" disabled={!pages.length || busy} onClick={save}>
          {busy ? "Saving…" : `Save ${pages.length || ""} page${pages.length === 1 ? "" : "s"} as PDF`}
        </button>
      </div>
    </Dialog>
  );
};

const LinkDialog = ({ target, defaultKind, open, onClose, onSaved }: { target: Target; defaultKind: FileKind; open: boolean; onClose: () => void; onSaved: () => void }) => {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FileKind>(defaultKind);
  const [store, setStore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/files/link", {
        method: "POST",
        body: { url, kind, store_copy: store, ...(name.trim() ? { name: name.trim() } : {}), ...(target.item ? { item_id: target.item } : { entry_id: target.entry }) }
      });
      setUrl("");
      setName("");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add a link" open={open} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <Field label="URL" wide>
            <input className="input" type="url" required placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="Name" hint="Defaults to the file name in the URL">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Kind">
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
              {FILE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {titleCase(k)}
                </option>
              ))}
            </select>
          </Field>
          <label className="wide" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
            <input type="checkbox" checked={store} onChange={(e) => setStore(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              Keep a copy
              <span className="muted" style={{ display: "block", fontSize: 12 }}>
                Downloads the file (a PDF or image, not a web page) so it stays available and searchable if the link breaks.
              </span>
            </span>
          </label>
        </div>
        <ErrorNotice error={error} />
        <div className="form-actions">
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Add link"}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

/** Uploads every file in `files` in turn. Returns the first error message, if any. */
const uploadAll = async (files: File[], target: Target, kind: FileKind): Promise<string | undefined> => {
  for (const f of files) {
    try {
      await uploadFile(f, { name: f.name, kind: f.type.startsWith("image/") && kind === "document" ? "photo" : kind, ...target });
    } catch (e) {
      return `${f.name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return undefined;
};

export const Attachments = ({
  title,
  target,
  files,
  defaultKind,
  onChange
}: {
  title: string;
  target: Target;
  files: FileInfo[];
  defaultKind: FileKind;
  onChange: () => void;
}) => {
  const input = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState(false);
  const [link, setLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string>();

  const add = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    setError(await uploadAll(list, target, defaultKind));
    setBusy(false);
    onChange();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void add([...e.dataTransfer.files]);
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <div className="section-actions">
          <button className="btn small" type="button" disabled={busy} onClick={() => input.current?.click()}>
            <UploadIcon />
            {busy ? "Uploading…" : "Upload"}
          </button>
          <button className="btn small" type="button" onClick={() => setScan(true)}>
            <CameraIcon />
            Scan
          </button>
          <button className="btn small" type="button" onClick={() => setLink(true)}>
            <LinkIcon />
            Link
          </button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept="application/pdf,image/*,text/plain,.doc,.docx"
        onChange={(e) => {
          void add([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <ErrorNotice error={error} />
      <div
        className={`dropzone${over ? " over" : ""}`}
        style={files.length ? { padding: 0, border: 0 } : undefined}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {files.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Drop PDFs or photos here, scan a paper copy, or add a link to the manufacturer's page.
          </p>
        ) : (
          <div className="list">
            {files.map((f) => (
              <div key={f.id} className="list-row">
                <FileIcon />
                <a className="grow" href={f.stored ? fileUrl(f.id) : (f.url ?? "#")} target="_blank" rel="noopener noreferrer">
                  <span className="title">{f.name}</span>
                  <span className="sub">{describe(f)}</span>
                </a>
                {f.stored && (
                  <a className="btn small ghost" href={fileUrl(f.id, true)} download={f.name}>
                    Download
                  </a>
                )}
                <button className="icon-button" type="button" aria-label={`Delete ${f.name}`} onClick={() => void remove(f, onChange)}>
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Scanner target={target} defaultKind={defaultKind === "photo" ? "document" : defaultKind} open={scan} onClose={() => setScan(false)} onSaved={onChange} />
      <LinkDialog target={target} defaultKind={defaultKind} open={link} onClose={() => setLink(false)} onSaved={onChange} />
    </section>
  );
};

export const Photos = ({ itemId, photos, onChange }: { itemId: string; photos: FileInfo[]; onChange: () => void }) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Photos</h2>
        <button className="btn small" type="button" disabled={busy} onClick={() => input.current?.click()}>
          <PlusIcon />
          {busy ? "Uploading…" : "Add photos"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          setBusy(true);
          setError(await uploadAll(files, { item: itemId }, "photo"));
          setBusy(false);
          onChange();
        }}
      />
      <ErrorNotice error={error} />
      {photos.length === 0 ? (
        <p className="list-empty">No photos yet. A photo of the model and serial label is the most useful one.</p>
      ) : (
        <div className="photos">
          {photos.map((p) => (
            <div key={p.id} className="photo">
              <a href={fileUrl(p.id)} target="_blank" rel="noopener noreferrer">
                <img src={fileUrl(p.id)} alt={p.name} loading="lazy" />
              </a>
              <button className="icon-button remove" type="button" aria-label={`Delete ${p.name}`} onClick={() => void remove(p, onChange)}>
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
