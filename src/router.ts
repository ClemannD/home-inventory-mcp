/** A small history-API router: the current path and query, and navigation that doesn't reload. */
import { useEffect, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

addEventListener("popstate", notify);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => location.pathname + location.search;

export interface Location {
  readonly path: string;
  readonly query: URLSearchParams;
}

export const useLocation = (): Location => {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, location.origin);
  return { path: url.pathname, query: url.searchParams };
};

export const navigate = (to: string, options: { replace?: boolean } = {}): void => {
  if (to === snapshot()) return;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  if (!options.replace) scrollTo(0, 0);
  notify();
};

/** Updates query parameters in place. Empty values are removed. */
export const setQuery = (changes: Record<string, string | null | undefined>): void => {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(changes)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  navigate(url.pathname + url.search, { replace: true });
};

/** Intercepts clicks on same-origin <a> elements so they navigate without a reload. */
export const useLinkInterception = (): void => {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest("a");
      if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin || a.pathname.startsWith("/api/")) return;
      e.preventDefault();
      navigate(a.pathname + a.search);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
};
