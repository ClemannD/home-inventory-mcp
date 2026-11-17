import { useEffect } from "react";
import type { Me } from "../shared/api";
import { useApi } from "./api";
import { MeContext, Shell } from "./components/Shell";
import { ErrorNotice } from "./components/ui";
import { EntriesPage } from "./pages/EntriesPage";
import { EntryPage } from "./pages/EntryPage";
import { ItemPage } from "./pages/ItemPage";
import { ItemsPage } from "./pages/ItemsPage";
import { SearchPage } from "./pages/SearchPage";
import { ConnectPage, EmailPage, HouseholdPage, SecurityPage } from "./pages/SettingsPages";
import { useLinkInterception, useLocation } from "./router";

const Route = () => {
  const { path } = useLocation();
  let m: RegExpExecArray | null;
  if (path === "/" || path === "/items") return <ItemsPage />;
  if ((m = /^\/items\/([^/]+)$/.exec(path))) return <ItemPage key={m[1]} id={m[1]!} />;
  if (path === "/entries") return <EntriesPage />;
  if ((m = /^\/entries\/([^/]+)$/.exec(path))) return <EntryPage key={m[1]} id={m[1]!} />;
  if (path === "/search") return <SearchPage />;
  if (path === "/settings/household") return <HouseholdPage />;
  if (path === "/settings/security") return <SecurityPage />;
  if (path === "/settings/email") return <EmailPage />;
  if (path === "/settings/connect") return <ConnectPage />;
  return (
    <div className="page">
      <h1 className="page-title">Not found</h1>
      <p className="page-sub">
        <a href="/items" style={{ color: "var(--blue)" }}>
          Go to items
        </a>
      </p>
    </div>
  );
};

export const App = () => {
  useLinkInterception();
  const me = useApi<Me>("/api/me");

  useEffect(() => {
    if (me.data) document.title = me.data.app_name;
  }, [me.data]);

  if (!me.data) return me.error ? <div className="page"><ErrorNotice error={me.error} /></div> : null;
  return (
    <MeContext.Provider value={{ me: me.data, refresh: me.reload }}>
      <Shell me={me.data}>
        <Route />
      </Shell>
    </MeContext.Provider>
  );
};
