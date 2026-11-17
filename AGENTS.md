# Home Inventory MCP: agent guide

A household inventory (items, warranties, receipts, manuals) served as a remote MCP server and a React
web app from one Cloudflare Worker. See README.md for what it does and how to deploy it.

## Code map

```
worker/index.ts        entry: OAuthProvider in front of fetch; email and scheduled handlers
worker/app.ts          non-OAuth routes: sign-in, /authorize, /api (session), the SPA (session)
worker/mcp.ts          MCP tools (stateless createMcpHandler, one server per request)
worker/oauth.ts        /authorize consent page for MCP clients
worker/upload-link.ts  /u/:token one-time upload page (no session; the token is the credential)
worker/auth/           email codes, passkeys, sessions, members (all in D1)
worker/catalog/        all SQL: items, warranties, entries, files, search index, email senders
worker/api/routes.ts   REST API for the web app
worker/ingest.ts       email() handler: allowlisted mail becomes an entry with attachments
worker/reminders.ts    daily cron: warranty reminder emails, auth cleanup
worker/pages.ts        server-rendered sign-in and consent pages
shared/                types, zod input schemas, entry types, date math (Worker and SPA)
src/                   React SPA, plain CSS in src/index.css
migrations/            D1 schema
scripts/setup.ts       creates resources and writes wrangler.jsonc (gitignored)
test/                  workerd tests; passkey-fake.ts is a software authenticator
```

## Rules

- The MCP tools and the REST API both call `worker/catalog/`. Put SQL there, not in routes or tools.
- Every catalog write calls the matching `index*` function in `worker/catalog/search.ts`. A write
  that skips it leaves search results stale.
- Input validation lives in `shared/schemas.ts`. The MCP tools reuse these schemas as their input
  schemas, so a field added there shows up in both interfaces.
- New record types go in `shared/entry-types.ts`. They need no migration.
- Tools return data, not prose. When a lookup matches several items, return all of them; the client
  model decides or asks the user.
- D1 caps bound parameters per query at 100. Pass ID lists as JSON with
  `IN (SELECT value FROM json_each(?))`.
- `compatibility_date` is pinned in both `scripts/setup.ts` and `vitest.config.ts`. Keep them equal,
  and no newer than the test runtime supports.

## Commands

```sh
npm run setup -- --local    # local wrangler.jsonc + migrated local D1
npm run dev                 # http://localhost:5173; sign-in codes print in this terminal
npm test
npm run typecheck
npm run deploy
```
