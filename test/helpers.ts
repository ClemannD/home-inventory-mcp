import { exports } from "cloudflare:workers";
import { vi } from "vitest";

export const ORIGIN = "https://home.example.com";

export interface CallOptions {
  readonly body?: unknown;
  readonly raw?: BodyInit;
  readonly headers?: Record<string, string>;
  readonly cookie?: string;
  /** null sends no Origin header. */
  readonly origin?: string | null;
}

export const call = (method: string, path: string, opts: CallOptions = {}): Promise<Response> => {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: BodyInit | undefined = opts.raw;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { method, headers, redirect: "manual", ...(body === undefined ? {} : { body }) }));
};

export const jsonOf = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** `name=value` pairs from a response's Set-Cookie headers, ready for a Cookie header. */
export const cookiesFrom = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");

/** Requests a sign-in code and reads it from the DEV_LOG_CODES console line. */
export const requestCode = async (email: string): Promise<{ res: Response; code: string | undefined }> => {
  const log = vi.spyOn(console, "log");
  try {
    const res = await call("POST", "/auth/code/send", { body: { email } });
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith(`[sign-in code] ${email}:`));
    return { res, code: line?.split(": ")[1] };
  } finally {
    log.mockRestore();
  }
};

/** Signs in with an email code and returns the session cookie. */
export const signIn = async (email: string): Promise<string> => {
  const { code } = await requestCode(email);
  if (!code) throw new Error(`no code sent to ${email}`);
  const res = await call("POST", "/auth/code/verify", { body: { email, code } });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return cookiesFrom(res);
};
