/**
 * The OAuth authorize endpoint for MCP clients (ChatGPT, Claude, …). The
 * member signs in as usual, then approves the client on a consent page. The
 * grant carries `{ userId }`, which the MCP tools act as.
 *
 *   GET  /authorize   sign in if needed, then show the consent page
 *   POST /authorize   handle=…&decision=approve|deny
 */
import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { currentSession } from "./auth/session";
import { appName, type Env } from "./env";
import { html, redirect } from "./http";
import { consentPage, messagePage } from "./pages";

const errorPage = (env: Env, e: unknown): Response => {
  if (e instanceof AuthorizationError) {
    if (e.redirectTo) return redirect(e.redirectTo);
    return html(messagePage(appName(env), "Can't connect", e.description), 400);
  }
  console.error("authorize failed", e);
  return html(messagePage(appName(env), "Can't connect", "Something went wrong. Start the connection again from the app."), 500);
};

/**
 * The redirect URI's origin, for the consent page's CSP form-action. The
 * library has already checked the URI against the client's registration.
 * Private-use schemes (com.example.app:/cb) are listed by scheme.
 */
const redirectOrigins = (redirectUri: string): string[] => {
  try {
    const url = new URL(redirectUri);
    return [url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol];
  } catch {
    return [];
  }
};

const withHeaders = (response: Response, headers: Headers): Response => {
  headers.forEach((value, key) => response.headers.append(key, value));
  return response;
};

export const handleAuthorize = async (request: Request, env: Env, url: URL): Promise<Response> => {
  const session = await currentSession(request, env, url);

  if (request.method === "GET") {
    if (!session) return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    try {
      const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const consent = await env.OAUTH_PROVIDER.describeConsent(authRequest);
      const tx = await env.OAUTH_PROVIDER.beginConsent(authRequest);
      return html(
        consentPage({
          appName: appName(env),
          handle: tx.handle,
          clientName: consent.clientName,
          ...(consent.clientDomain ? { clientDomain: consent.clientDomain } : {}),
          redirectHost: consent.redirectHost,
          redirectIsLoopback: consent.redirectIsLoopback,
          userEmail: session.user.email
        }),
        200,
        tx.headers,
        redirectOrigins(consent.redirectUri)
      );
    } catch (e) {
      return errorPage(env, e);
    }
  }

  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return html(messagePage(appName(env), "Can't connect", "That request came from another site."), 403);
    if (!session) return html(messagePage(appName(env), "Signed out", "Sign in and start the connection again."), 401);
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    try {
      if (form.get("decision") !== "approve") {
        const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
        return withHeaders(redirect(denied.redirectTo), denied.headers);
      }
      const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle);
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: approved.request,
        userId: session.user.id,
        metadata: { email: session.user.email },
        scope: approved.request.scope,
        props: { userId: session.user.id }
      });
      return withHeaders(redirect(redirectTo), approved.headers);
    } catch (e) {
      return errorPage(env, e);
    }
  }

  return new Response("method not allowed", { status: 405 });
};
