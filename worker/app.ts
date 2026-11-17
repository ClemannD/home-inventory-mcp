/**
 * Everything except /mcp and the OAuth protocol endpoints, which
 * workers-oauth-provider serves itself (worker/index.ts).
 *
 *   /login, /auth/*     sign-in (worker/auth/routes.ts), no session needed
 *   /authorize          MCP client consent (worker/oauth.ts)
 *   install metadata    manifest and icons, public
 *   /api/*              REST API for the UI, needs a session (401 without)
 *   everything else     the SPA, needs a session (redirect to /login without)
 */
import { handleApi } from "./api/routes";
import { handleAuthRoute } from "./auth/routes";
import { currentSession, sessionCookie } from "./auth/session";
import type { Env } from "./env";
import { fail, harden, redirect } from "./http";
import { handleAuthorize } from "./oauth";

const PUBLIC_ASSETS = new Set(["/favicon.svg", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"]);

export const app: ExportedHandler<Env> = {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    const auth = await handleAuthRoute(request, env, url);
    if (auth) return auth;

    if (url.pathname === "/authorize") return handleAuthorize(request, env, url);

    if ((request.method === "GET" || request.method === "HEAD") && PUBLIC_ASSETS.has(url.pathname)) {
      return harden(await env.ASSETS.fetch(request));
    }

    const session = await currentSession(request, env, url);
    if (!session) {
      if (url.pathname.startsWith("/api/")) return fail("unauthenticated", 401);
      return redirect(`/login${url.pathname === "/" ? "" : `?next=${encodeURIComponent(url.pathname + url.search)}`}`);
    }
    const response = url.pathname.startsWith("/api/")
      ? await handleApi(request, env, ctx, url, session.user)
      : await env.ASSETS.fetch(request);
    return harden(response, session.renewed ? sessionCookie(url, session.token) : undefined);
  }
};
