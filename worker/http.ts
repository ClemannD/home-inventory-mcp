/** Response helpers shared by the auth routes, the REST API and the HTML pages. */

export const json = (value: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers }
  });

export const fail = (message: string, status = 400): Response => json({ error: message }, status);

export const redirect = (location: string, status = 302, headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers: { location, "cache-control": "no-store", ...headers } });

/** A server-rendered page. Its scripts and styles are inline, so the CSP allows only those. */
export const html = (body: string, status = 200, extra?: Headers): Response => {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  });
  extra?.forEach((value, key) => headers.append(key, value));
  return new Response(body, { status, headers });
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Parses a JSON object body. Returns undefined for anything else. */
export const readJson = async (request: Request): Promise<Record<string, unknown> | undefined> => {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

/** Cookies are SameSite=Lax; endpoints that write also require a same-origin Origin header. */
export const sameOrigin = (request: Request, url: URL): boolean => request.headers.get("origin") === url.origin;

/** Security headers for responses served behind the session gate. */
export const harden = (response: Response, setCookie?: string): Response => {
  const out = new Response(response.body, response);
  out.headers.set("x-frame-options", "DENY");
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "no-referrer");
  out.headers.set("x-robots-tag", "noindex");
  if (setCookie) out.headers.append("set-cookie", setCookie);
  return out;
};
