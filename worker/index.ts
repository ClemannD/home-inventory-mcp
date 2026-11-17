/**
 * Worker entry point.
 *
 *   fetch      workers-oauth-provider in front of everything: it serves the
 *              OAuth endpoints, checks bearer tokens on /mcp, and passes the
 *              rest to the app (worker/app.ts)
 *   email      email ingest (worker/ingest.ts)
 *   scheduled  daily warranty reminders and cleanup (worker/reminders.ts)
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { app } from "./app";
import { appName, type Env } from "./env";
import { handleEmail } from "./ingest";
import { mcpHandler } from "./mcp";
import { runDaily } from "./reminders";

const DAY_SECONDS = 86_400;

let provider: { resource: string; instance: OAuthProvider<Env> } | undefined;

/** One provider per isolate. The resource URL comes from PUBLIC_URL, or the request's origin when unset. */
const oauth = (env: Env, origin: string): OAuthProvider<Env> => {
  const resource = `${(env.PUBLIC_URL || origin).replace(/\/$/, "")}/mcp`;
  if (provider?.resource === resource) return provider.instance;
  const instance = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: { fetch: (request, env, ctx) => mcpHandler(env)(request, env, ctx) },
    defaultHandler: app,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: ["catalog"],
    resourceMetadata: { resource, resource_name: appName(env) },
    // A connection lasts as long as the client uses it at least every 60 days.
    refreshTokenTTL: 60 * DAY_SECONDS,
    refreshTokenIdleTTL: 60 * DAY_SECONDS
  });
  provider = { resource, instance };
  return instance;
};

export default {
  fetch: (request, env, ctx) => oauth(env, new URL(request.url).origin).fetch(request, env, ctx),
  email: handleEmail,
  scheduled: async (_controller, env, ctx) => {
    ctx.waitUntil(runDaily(env));
    if (env.PUBLIC_URL) ctx.waitUntil(oauth(env, env.PUBLIC_URL).purgeExpiredData(env));
  }
} satisfies ExportedHandler<Env>;
