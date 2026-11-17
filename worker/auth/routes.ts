/**
 * Sign-in routes. All of them run before the session gate.
 *
 *   GET  /login                          sign-in page (?next=/path)
 *   POST /auth/code/send                 {email}: email a sign-in code
 *   POST /auth/code/verify               {email, code}: sign in with it
 *   POST /auth/passkey/login/options     start a passkey sign-in
 *   POST /auth/passkey/login/verify      {challengeId, response}: finish it
 *   POST /auth/logout                    end this session
 */
import { emailAddress } from "../../shared/schemas";
import { appName, type Env } from "../env";
import { fail, html, json, readJson, redirect, sameOrigin } from "../http";
import { canSendMail } from "../mail";
import { loginPage } from "../pages";
import { requestCode, verifyCode, type CodeResult } from "./codes";
import { loginOptions, loginVerify, relyingParty } from "./passkeys";
import { clearedSessionCookie, createSession, currentSession, endSession, readSessionToken, sessionCookie } from "./session";
import type { UserRow } from "./users";

/** A path on this site to return to after sign-in. Anything else becomes "/". */
export const safeNext = (value: string | null | undefined): string =>
  value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";

const signedIn = async (env: Env, request: Request, url: URL, result: CodeResult<UserRow>): Promise<Response> => {
  if (!result.ok) return fail(result.error, result.status);
  const token = await createSession(env, result.value.id, request);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(url, token) });
};

/** Handles an auth route, or returns undefined when the path isn't one. */
export const handleAuthRoute = async (request: Request, env: Env, url: URL): Promise<Response | undefined> => {
  const path = url.pathname;

  if (path === "/login") {
    if (request.method !== "GET") return fail("method not allowed", 405);
    const next = safeNext(url.searchParams.get("next"));
    if (await currentSession(request, env, url)) return redirect(next);
    return html(loginPage({ appName: appName(env), next, emailCodes: canSendMail(env) || env.DEV_LOG_CODES === "1" }));
  }

  if (path === "/auth/logout") {
    if (request.method !== "POST") return fail("method not allowed", 405);
    if (!sameOrigin(request, url)) return fail("forbidden", 403);
    const token = readSessionToken(request, url);
    if (token) await endSession(env, token);
    return redirect("/login", 303, { "set-cookie": clearedSessionCookie(url) });
  }

  if (!path.startsWith("/auth/")) return undefined;
  if (request.method !== "POST") return fail("method not allowed", 405);
  if (!sameOrigin(request, url)) return fail("forbidden", 403);
  const body = (await readJson(request)) ?? {};

  switch (path) {
    case "/auth/code/send": {
      const email = emailAddress.safeParse(body.email);
      if (!email.success) return fail("Enter a valid email address.");
      const result = await requestCode(env, email.data);
      return result.ok ? json({ ok: true }) : fail(result.error, result.status);
    }
    case "/auth/code/verify": {
      const email = emailAddress.safeParse(body.email);
      if (!email.success || typeof body.code !== "string") return fail("Enter the email address and the code.");
      return signedIn(env, request, url, await verifyCode(env, email.data, body.code));
    }
    case "/auth/passkey/login/options":
      return json(await loginOptions(env, relyingParty(url)));
    case "/auth/passkey/login/verify": {
      if (typeof body.challengeId !== "string" || typeof body.response !== "object" || body.response === null) return fail("bad request");
      return signedIn(env, request, url, await loginVerify(env, relyingParty(url), body.challengeId, body.response as never));
    }
  }
  return fail("not found", 404);
};
