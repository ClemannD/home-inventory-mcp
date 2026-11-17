import { startRegistration } from "@simplewebauthn/browser";
import { useState, type ReactNode } from "react";
import type { Connection, Member, PasskeyInfo } from "../../shared/api";
import { api, useApi } from "../api";
import { CopyIcon, KeyIcon, MailIcon, PlugIcon, PlusIcon, TrashIcon, UsersIcon } from "../components/icons";
import { Topbar, useMe } from "../components/Shell";
import { Empty, ErrorNotice, Field, Loading } from "../components/ui";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "never");

const Page = ({ title, sub, children }: { title: string; sub: string; children: ReactNode }) => (
  <>
    <Topbar crumbs={[{ label: "Settings" }, { label: title }]} />
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{sub}</p>
        </div>
      </div>
      <div className="stack">{children}</div>
    </div>
  </>
);

const CopyField = ({ value, label }: { value: string; label: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <input className="input" readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
      <button
        className="btn"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // The field selects on focus, so it can be copied by hand.
          }
        }}
      >
        <CopyIcon />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
};

// Household ------------------------------------------------------------------

export const HouseholdPage = () => {
  const { me, refresh } = useMe();
  const members = useApi<Member[]>("/api/members");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [ingest, setIngest] = useState(true);
  const [myName, setMyName] = useState(me.user.name ?? "");
  const [error, setError] = useState<string>();
  const owner = me.user.role === "owner";

  const add = async () => {
    setError(undefined);
    try {
      await api("/api/members", { method: "POST", body: { email, name, allow_email_ingest: ingest } });
      setEmail("");
      setName("");
      members.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.email}? Their passkeys and sessions stop working.`)) return;
    try {
      await api(`/api/members/${m.id}`, { method: "DELETE" });
      members.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const rename = async () => {
    await api(`/api/members/${me.user.id}`, { method: "PATCH", body: { name: myName } });
    refresh();
    members.reload();
  };

  return (
    <Page title="Household" sub="Everyone here sees and edits the same inventory. Members sign in with an email code or a passkey.">
      <ErrorNotice error={error} />
      {!members.data ? (
        <Loading />
      ) : (
        <div className="list">
          {members.data.map((m) => (
            <div key={m.id} className="list-row">
              <UsersIcon />
              <span className="grow">
                <span className="title">
                  {m.name || m.email}
                  {m.id === me.user.id ? " (you)" : ""}
                </span>
                <span className="sub">
                  {m.name ? `${m.email} · ` : ""}
                  {m.role === "owner" ? "Owner" : "Member"} · last signed in {when(m.last_sign_in_at)}
                </span>
              </span>
              {owner && m.role !== "owner" && (
                <button className="icon-button" type="button" aria-label={`Remove ${m.email}`} onClick={() => void remove(m)}>
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <h2 className="section-title" style={{ marginBottom: 12 }}>
          Your name
        </h2>
        <form
          className="copy-field"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <input className="input" value={myName} placeholder="Shown instead of your email" onChange={(e) => setMyName(e.target.value)} aria-label="Your name" />
          <button className="btn" type="submit">
            Save
          </button>
        </form>
      </div>

      {owner && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            Add a member
          </h2>
          <div className="form-grid">
            <Field label="Email">
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <label className="wide" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={ingest} onChange={(e) => setIngest(e.target.checked)} />
              Let them email receipts to the inventory
            </label>
          </div>
          <div className="form-actions">
            <button className="btn primary" type="submit">
              <PlusIcon />
              Add member
            </button>
          </div>
        </form>
      )}
    </Page>
  );
};

// Passkeys -------------------------------------------------------------------

const deviceName = (): string => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Passkey";
};

export const SecurityPage = () => {
  const passkeys = useApi<PasskeyInfo[]>("/api/passkeys");
  const [name, setName] = useState(deviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const add = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { challengeId, options } = await api<{ challengeId: string; options: never }>("/api/passkeys/options", { method: "POST" });
      const response = await startRegistration({ optionsJSON: options });
      await api("/api/passkeys/verify", { method: "POST", body: { challengeId, response, name } });
      passkeys.reload();
    } catch (e) {
      const err = e as Error;
      setError(
        err.name === "NotAllowedError"
          ? "Passkey setup was cancelled."
          : err.name === "InvalidStateError"
            ? "This device already has a passkey for your account."
            : errorText(e)
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: PasskeyInfo) => {
    if (!confirm(`Remove the passkey “${p.name ?? "Passkey"}”?`)) return;
    await api(`/api/passkeys/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    passkeys.reload();
  };

  return (
    <Page title="Passkeys" sub="Sign in with Face ID, Touch ID, Windows Hello or a security key instead of waiting for an email code.">
      <ErrorNotice error={error} />
      {!passkeys.data ? (
        <Loading />
      ) : passkeys.data.length === 0 ? (
        <Empty title="No passkeys yet">Add one for each device you use.</Empty>
      ) : (
        <div className="list">
          {passkeys.data.map((p) => (
            <div key={p.id} className="list-row">
              <KeyIcon />
              <span className="grow">
                <span className="title">{p.name ?? "Passkey"}</span>
                <span className="sub">
                  Added {when(p.created_at)} · last used {when(p.last_used_at)}
                </span>
              </span>
              <button className="icon-button" type="button" aria-label={`Remove ${p.name ?? "passkey"}`} onClick={() => void remove(p)}>
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <h2 className="section-title" style={{ marginBottom: 12 }}>
          Add a passkey on this device
        </h2>
        <div className="copy-field">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Passkey name" />
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Waiting…" : "Add passkey"}
          </button>
        </div>
      </form>
    </Page>
  );
};

// Email inbox ----------------------------------------------------------------

export const EmailPage = () => {
  const { me } = useMe();
  const senders = useApi<{ address: string; created_at: string }[]>("/api/senders");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string>();

  const add = async () => {
    setError(undefined);
    try {
      senders.setData(await api("/api/senders", { method: "POST", body: { address } }));
      setAddress("");
    } catch (e) {
      setError(errorText(e));
    }
  };

  const remove = async (a: string) => {
    senders.setData(await api(`/api/senders/${encodeURIComponent(a)}`, { method: "DELETE" }));
  };

  const [local, domain] = (me.ingest_address ?? "inventory@example.com").split("@");

  return (
    <Page title="Email inbox" sub="Forward receipts, order confirmations and manuals by email. Each message becomes a record, and its attachments are saved with it.">
      {me.ingest_address ? (
        <div className="panel">
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            Send to
          </h2>
          <CopyField value={me.ingest_address} label="Ingest address" />
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Messages become receipts. To file one as something else, add the type after a plus: {local}+note@{domain} or {local}+service@{domain}. To
            add to a record you already have, use the address shown on its page, like {local}+itm_…@{domain}.
          </p>
        </div>
      ) : (
        <p className="notice">No ingest address is configured. Set INGEST_ADDRESS and route it to this Worker with Cloudflare Email Routing (see the README).</p>
      )}
      <div>
        <h2 className="section-title" style={{ marginBottom: 4 }}>
          Allowed senders
        </h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Only mail from these addresses is accepted. Everything else is rejected.
        </p>
        <ErrorNotice error={error} />
        {!senders.data ? (
          <Loading />
        ) : senders.data.length === 0 ? (
          <p className="list-empty">No senders allowed yet, so all mail is rejected.</p>
        ) : (
          <div className="list">
            {senders.data.map((s) => (
              <div key={s.address} className="list-row">
                <MailIcon />
                <span className="grow">
                  <span className="title">{s.address}</span>
                </span>
                <button className="icon-button" type="button" aria-label={`Remove ${s.address}`} onClick={() => void remove(s.address)}>
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <form
        className="copy-field"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input" type="email" required placeholder="you@example.com" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Address to allow" />
        <button className="btn" type="submit">
          <PlusIcon />
          Allow
        </button>
      </form>
    </Page>
  );
};

// Connect an assistant -------------------------------------------------------

export const ConnectPage = () => {
  const { me } = useMe();
  const connections = useApi<Connection[]>("/api/connections");
  const url = `${(me.public_url || location.origin).replace(/\/$/, "")}/mcp`;

  const revoke = async (c: Connection) => {
    if (!confirm(`Disconnect ${c.client_name}? It loses access until you connect it again.`)) return;
    await api(`/api/connections/${encodeURIComponent(c.id)}`, { method: "DELETE" });
    connections.reload();
  };

  return (
    <Page title="Connect an assistant" sub="Use your inventory from ChatGPT, Claude, or any app that supports MCP servers. You sign in and approve the connection once.">
      <div className="panel">
        <h2 className="section-title" style={{ marginBottom: 12 }}>
          Server URL
        </h2>
        <CopyField value={url} label="MCP server URL" />
      </div>
      <div className="prose">
        <p>
          <strong>Claude:</strong> Settings → Connectors → Add custom connector. Paste the URL and connect.
        </p>
        <p>
          <strong>ChatGPT:</strong> turn on developer mode in settings, then add a custom app (connector) with this URL and OAuth sign-in. The menu names, and which
          plans allow custom apps, change over time.
        </p>
        <p>Then ask things like “what's the warranty on the living room TV?” or “find the tracking number for the package I shipped last week”.</p>
      </div>
      <div>
        <h2 className="section-title" style={{ marginBottom: 12 }}>
          Your connections
        </h2>
        {!connections.data ? (
          <Loading />
        ) : connections.data.length === 0 ? (
          <p className="list-empty">Nothing connected yet. A new connection can take up to a minute to show up here.</p>
        ) : (
          <div className="list">
            {connections.data.map((c) => (
              <div key={c.id} className="list-row">
                <PlugIcon />
                <span className="grow">
                  <span className="title">{c.client_name}</span>
                  <span className="sub">Connected {when(c.created_at)}</span>
                </span>
                <button className="btn small" type="button" onClick={() => void revoke(c)}>
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
};
