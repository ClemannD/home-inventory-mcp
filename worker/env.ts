import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  readonly ASSETS: Fetcher;
  readonly DB: D1Database;
  /** Uploaded files: photos, receipts, manuals. */
  readonly FILES: R2Bucket;
  /** Grants and tokens for MCP clients, managed by workers-oauth-provider. */
  readonly OAUTH_KV: KVNamespace;
  /** Set by workers-oauth-provider on every request it passes on. */
  readonly OAUTH_PROVIDER: OAuthHelpers;
  /** Sends sign-in codes and warranty reminders. Without it, codes are only logged. */
  readonly EMAIL?: SendEmail;
  /** Extracts text from PDFs and images for search. Optional. */
  readonly AI?: Ai;

  readonly APP_NAME?: string;
  /** Origin the app is served from, e.g. https://home.example.com. Used for OAuth metadata and links. */
  readonly PUBLIC_URL?: string;
  /** Created as the owner on first sign-in when there are no users yet. */
  readonly OWNER_EMAIL?: string;
  /** From address for outgoing mail, e.g. "Home Inventory <inventory@example.com>". */
  readonly EMAIL_FROM?: string;
  /** Address shown in the UI for forwarding receipts. Routing it here is set up in Cloudflare. */
  readonly INGEST_ADDRESS?: string;
  /** IANA time zone for "today" in warranty math and reminders. Defaults to UTC. */
  readonly TIMEZONE?: string;
  /** ISO 4217 code for displaying prices. Defaults to USD. */
  readonly CURRENCY?: string;
  /** "1" logs sign-in codes to the console. For local development and tests. */
  readonly DEV_LOG_CODES?: string;
}

export const appName = (env: Env): string => env.APP_NAME || "Home Inventory";
export const timezone = (env: Env): string => env.TIMEZONE || "UTC";
