/**
 * The app frame: the sidebar (dylan.clemann.com style), the mobile header that
 * opens it as a drawer, and the canvas with its top bar.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Me } from "../../shared/api";
import { ENTRY_TYPES } from "../../shared/entry-types";
import { navigate, useLocation } from "../router";
import { useTheme, type ThemeChoice } from "../theme";
import { BoxIcon, EntryTypeIcon, KeyIcon, MailIcon, Mark, MonitorIcon, MoonIcon, PlugIcon, SearchIcon, SidebarIcon, SunIcon, UsersIcon } from "./icons";

export interface MeState {
  readonly me: Me;
  /** Reloads counts and settings after a change. */
  readonly refresh: () => void;
}

export const MeContext = createContext<MeState | null>(null);

export const useMe = (): MeState => {
  const value = useContext(MeContext);
  if (!value) throw new Error("useMe outside MeContext");
  return value;
};

const THEMES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light theme", icon: <SunIcon /> },
  { value: "dark", label: "Dark theme", icon: <MoonIcon /> },
  { value: "system", label: "System theme", icon: <MonitorIcon /> }
];

const NavLink = ({ href, icon, label, count, current }: { href: string; icon: ReactNode; label: string; count?: number; current: boolean }) => (
  <a className="nav-link" href={href} {...(current ? { "aria-current": "page" as const } : {})}>
    {icon}
    <span>{label}</span>
    {count !== undefined && <span className="nav-count">{count}</span>}
  </a>
);

const Sidebar = ({ me }: { me: Me }) => {
  const { path, query } = useLocation();
  const { choice, choose } = useTheme();
  const [q, setQ] = useState(path === "/search" ? (query.get("q") ?? "") : "");
  const entryTab = path === "/entries" ? (query.get("type") ?? "receipt") : null;

  return (
    <aside className="sidebar" id="sidebar" aria-label="Navigation">
      <div className="sidebar-header">
        <a className="brand" href="/items">
          <Mark className="brand-mark" style={{ color: "var(--text)" }} />
          <span>{me.app_name}</span>
        </a>
        <button className="icon-button" type="button" onClick={toggleCollapsed} aria-label="Collapse sidebar" title="Toggle sidebar (⌘\)">
          <SidebarIcon />
        </button>
      </div>
      <div className="sidebar-content">
        <form
          className="sidebar-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
        >
          <SearchIcon />
          <input id="global-search" type="search" placeholder="Search everything" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search everything" />
        </form>
        <nav aria-label="Catalog">
          <div className="nav-group">
            <NavLink href="/items" icon={<BoxIcon />} label="Items" count={me.counts.items} current={path === "/" || path.startsWith("/items")} />
            {ENTRY_TYPES.map((t) => (
              <NavLink
                key={t.id}
                href={`/entries?type=${t.id}`}
                icon={<EntryTypeIcon type={t.id} />}
                label={t.label}
                count={me.counts.entries[t.id] ?? 0}
                current={entryTab === t.id}
              />
            ))}
          </div>
          <div className="nav-group">
            <p className="nav-label">Settings</p>
            <NavLink href="/settings/household" icon={<UsersIcon />} label="Household" current={path === "/settings/household"} />
            <NavLink href="/settings/security" icon={<KeyIcon />} label="Passkeys" current={path === "/settings/security"} />
            <NavLink href="/settings/email" icon={<MailIcon />} label="Email inbox" current={path === "/settings/email"} />
            <NavLink href="/settings/connect" icon={<PlugIcon />} label="Connect an assistant" current={path === "/settings/connect"} />
          </div>
        </nav>
      </div>
      <footer className="sidebar-footer">
        <div className="sidebar-user">
          <span title={me.user.email}>{me.user.name || me.user.email}</span>
          <form method="post" action="/auth/logout">
            <button type="submit">Sign out</button>
          </form>
        </div>
        <div className="theme-switch" role="group" aria-label="Color theme">
          {THEMES.map((t) => (
            <button key={t.value} type="button" aria-label={t.label} title={t.label} aria-pressed={choice === t.value} onClick={() => choose(t.value)}>
              {t.icon}
            </button>
          ))}
        </div>
      </footer>
    </aside>
  );
};

const toggleCollapsed = () => {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  try {
    localStorage.setItem("sidebar", collapsed ? "collapsed" : "open");
  } catch {
    // Not remembered in private mode.
  }
};

export const Shell = ({ me, children }: { me: Me; children: ReactNode }) => {
  const { path, query } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("sidebar") === "collapsed") document.body.classList.add("sidebar-collapsed");
    } catch {
      // Ignore.
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleCollapsed();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.body.classList.remove("sidebar-collapsed");
        document.getElementById("global-search")?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // Close the drawer on navigation.
  useEffect(() => setMenuOpen(false), [path, query.toString()]);
  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
  }, [menuOpen]);

  return (
    <>
      <header className="mobile-header">
        <a className="brand" href="/items">
          <Mark className="brand-mark" style={{ color: "var(--text)" }} />
          <span>{me.app_name}</span>
        </a>
        <button
          className="icon-button menu-toggle"
          type="button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls="sidebar"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span />
          <span />
        </button>
      </header>
      <Sidebar me={me} />
      <main className="main" id="main">
        {children}
      </main>
    </>
  );
};

export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

export const Topbar = ({ crumbs, actions }: { crumbs: Crumb[]; actions?: ReactNode }) => (
  <div className="topbar">
    <div className="breadcrumb">
      <button className="icon-button expand-toggle" type="button" onClick={toggleCollapsed} aria-label="Expand sidebar">
        <SidebarIcon />
      </button>
      {crumbs.map((c, i) => (
        <span key={i} className="breadcrumb" style={{ minWidth: 0 }}>
          {i > 0 && <span aria-hidden="true">/</span>}
          {c.href ? <a href={c.href}>{c.label}</a> : <span className="current">{c.label}</span>}
        </span>
      ))}
    </div>
    {actions && <div className="topbar-actions">{actions}</div>}
  </div>
);
