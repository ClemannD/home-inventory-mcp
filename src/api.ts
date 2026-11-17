/** Fetch wrapper for /api. A 401 means the session ended, so it goes to sign-in. */
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export const api = async <T>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> => {
  const headers: Record<string, string> = { ...init.headers };
  let body = init.raw;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(path, { method: init.method ?? "GET", headers, ...(body === undefined ? {} : { body }) });
  if (res.status === 401) {
    location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    throw new ApiError("signed out", 401);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
};

export interface Loaded<T> {
  readonly data: T | undefined;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly reload: () => void;
  readonly setData: (data: T) => void;
}

/** Loads `path` and reloads when it changes. Keeps the previous data while reloading. */
export const useApi = <T>(path: string | null): Loaded<T> => {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!path) return;
    const id = ++latest.current;
    setLoading(true);
    api<T>(path).then(
      (value) => {
        if (id !== latest.current) return;
        setData(value);
        setError(undefined);
        setLoading(false);
      },
      (e: unknown) => {
        if (id !== latest.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    );
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
};

/** Uploads a file to an item or entry. */
export const uploadFile = (file: Blob, opts: { name: string; kind: string; item?: string; entry?: string }) => {
  const q = new URLSearchParams({ name: opts.name, kind: opts.kind });
  if (opts.item) q.set("item", opts.item);
  if (opts.entry) q.set("entry", opts.entry);
  return api(`/api/files?${q}`, { method: "POST", raw: file, headers: { "content-type": file.type || "application/octet-stream" } });
};

export const fileUrl = (id: string, download = false) => `/api/files/${id}/content${download ? "?download=1" : ""}`;
