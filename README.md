# Home Inventory MCP

Home Inventory keeps track of the things in your house: what you own, model and serial numbers,
warranties, receipts, and manuals. You mostly use it by asking an AI assistant like ChatGPT or
Claude, which reads and updates the inventory through MCP. There's also a web app for browsing,
uploading files, and scanning paper documents with your phone.

It runs on your own Cloudflare account. One deployment holds one household's inventory, and everyone
you add as a member sees the same data.

## What it's for

Once your things are in it, you can ask your assistant questions like:

- "What's the warranty on the living room TV?"
- "My stove is acting up. How do I reset it?"
- "Which warranties run out before spring?"
- "What's the tracking number for the package I shipped to Mom?"
- "I just bought a Bosch dishwasher at Lowe's for $1,049. Add it."

The assistant does the understanding. The inventory returns facts: the model number, the warranty
end date and days left, the text of the manual you saved. When more than one item could match, the
assistant asks which one you meant.

## What it stores

- **Items**: the things themselves, with brand, model, serial, location, purchase details, photos,
  and any extra fields you want (filter size, paint color).
- **Warranties** on items. An item can have several, for example the manufacturer's plus a credit
  card extension. Status and days left are computed from today's date in your time zone.
- **Entries**: records that aren't items. Out of the box these are receipts, service records, and
  notes. An entry can link to an item or stand alone, so a receipt kept only for its tracking
  number works fine. Delete it when you're done with it.
- **Files**: PDFs, photos, and links. Text is pulled out of PDFs and images, so a search for "reset"
  finds the page in your stove's manual.

## How it works

Everything runs in one Cloudflare Worker:

- `/mcp` is a remote MCP server. MCP clients connect with OAuth: you sign in, approve the app once,
  and it acts as you.
- The web app is a React SPA served from the same Worker, behind sign-in.
- Data lives in D1 (SQLite) with a full-text index. Files live in a private R2 bucket. OAuth tokens
  live in KV.
- Sign-in is by email code or passkey. Codes are sent with Cloudflare Email Service.
- Mail forwarded to your ingest address arrives through Cloudflare Email Routing and becomes an
  entry with its attachments.
- Workers AI converts PDFs and images to text for search. It's optional.
- A daily cron emails members about warranties ending in 30 and 7 days.

## Requirements

- A Cloudflare account with a domain on it. The app is served on a host in that zone, like
  `home.example.com`.
- Email Sending enabled for a domain in the account, for sign-in codes and reminders. Without it you
  can only sign in with a passkey, and you need email to sign in the first time.
- Email Routing on the domain, if you want to forward receipts.
- Node.js 22 or newer. Developed on Node 24 with Wrangler 4.

## Setup

1. Fork and clone the repo, then install:

   ```sh
   npm install
   npx wrangler login
   ```

2. Run setup. It creates the D1 database, R2 bucket and KV namespace (or reuses them if they exist),
   writes `wrangler.jsonc`, and applies the database migrations:

   ```sh
   npm run setup -- --domain home.example.com --owner you@example.com
   ```

   It asks for the sender and ingest addresses. All options are listed at the top of
   `scripts/setup.ts`. `wrangler.jsonc` is gitignored because it holds your account's resource IDs.

3. Enable Email Sending for the domain you send from. Use the dashboard (Email Service) or:

   ```sh
   npx wrangler email sending enable example.com
   ```

4. Deploy:

   ```sh
   npm run deploy
   ```

5. To forward receipts, add an Email Routing rule that sends your ingest address (for example
   `inventory@example.com`) to the Worker, and turn on subaddressing under Email Routing →
   Settings so plus addresses like `inventory+note@example.com` reach it too.

6. Open the site and sign in with the owner address. You'll get a code by email. Then:
   - add a passkey under **Passkeys**, so you don't need codes;
   - add household members under **Household**;
   - connect your assistant under **Connect an assistant**.

The owner is created from `OWNER_EMAIL` the first time someone asks for a sign-in code while there
are no users. After that, only the owner can add or remove members.

## Connecting an assistant

The server URL is `https://<your domain>/mcp`. The app shows it under **Connect an assistant**.

- **Claude**: Settings → Connectors → Add custom connector, then paste the URL.
- **ChatGPT**: turn on developer mode and add a custom app (connector) with the URL and OAuth
  sign-in. Menu names, and which plans can add custom apps, change over time.
- **Other MCP clients**: anything that supports remote MCP servers with OAuth and dynamic client
  registration.

When the client connects, you sign in and approve it. Each member connects as themselves. Members can
see and disconnect their connections in the same settings page. Removing a member stops their
connections working.

The tools cover searching, reading full records and file text, creating and updating items,
warranties and entries, attaching links (optionally downloading a copy), uploading files, deleting
records, and managing the email allowlist. Read tools are marked read-only, so clients can skip
asking you before they run. `delete` is marked destructive.

### Files

Assistants can't pass a file you attach in chat to an MCP tool, so there are two ways in:

- `create_upload_link` returns a link for one item or entry. You open it on any device and pick
  files or take a photo, without signing in. It accepts one upload (several files are fine) and
  expires after an hour. An agent that has the file and network access to your domain can post it
  itself (`curl -F file=@invoice.pdf <link>`); scripts get JSON back.
- `upload_file` takes a file's bytes as base64, up to 10 MB. It's for clients that have the
  original file, such as an agent reading from disk. The server checks the first bytes against the
  declared type, so a file the model tried to rebuild from what it saw is rejected rather than
  saved broken.

## Email inbox

Forward a receipt or order confirmation to your ingest address and it becomes a receipt entry. The
email body is saved as the entry's text, and attachments are saved as its files.

- Only senders on the allowlist are accepted. Everything else is rejected. The check uses the
  envelope sender, so forward from the address you allowed. Manage the list in **Email inbox** or
  ask your assistant.
- The part after a plus says where the message goes:
  - `inventory+note@example.com`, `inventory+service@example.com`: a new entry of that type.
    Unknown types become receipts.
  - `inventory+itm_…@example.com`: a new receipt linked to that item.
  - `inventory+ent_…@example.com`: added to that entry. Attachments become its files; a message
    without attachments is appended to its notes.

  Each item and entry page shows its address, and the MCP tools return it as `email_to`, so an
  assistant with access to your mail can forward an invoice straight to the right record. Plus
  addresses only reach the Worker with subaddressing turned on: Email Routing → Settings, or
  `support_subaddress` in the Email Routing API.

## Adding a record type

Entry types are defined in `shared/entry-types.ts`. Each type gets a tab in the web app, a form, and
a description the MCP tools pass to the assistant. Fields are stored as JSON, so adding a type
doesn't need a migration:

```ts
{
  id: "subscription",
  label: "Subscriptions",
  singular: "Subscription",
  description: "Recurring services: streaming, software, memberships. Track the renewal date and price.",
  fields: [
    { key: "price", label: "Price", kind: "money" },
    { key: "renews_on", label: "Renews", kind: "date" },
    { key: "account", label: "Account email", kind: "text" }
  ],
  columns: ["price", "renews_on"]
}
```

Don't rename a type's `id` once you have entries of that type. Existing rows keep the old value.

## Configuration

`npm run setup` writes these to `vars` in `wrangler.jsonc`. Edit and redeploy to change them.

- `PUBLIC_URL`: the site's origin. Used for OAuth metadata and links in tool results and emails.
- `OWNER_EMAIL`: the first member, created when there are no users.
- `EMAIL_FROM`: sender for codes and reminders, like `Home Inventory <inventory@example.com>`. Its
  domain must have Email Sending enabled.
- `INGEST_ADDRESS`: shown in the app as the address to forward to. The routing rule is what
  actually delivers mail.
- `TIMEZONE`: IANA zone for "today" in warranty math and reminder timing. Defaults to UTC.
- `CURRENCY`: ISO 4217 code for displaying prices. Defaults to USD.
- `APP_NAME`: shown in the app, emails, and the consent page.

Remove the `ai` binding to turn off text extraction. Uploads still work, but PDFs and images
aren't searchable by their contents.

## Local development

```sh
npm run setup -- --local --owner you@example.com
npm run dev
```

Open http://localhost:5173 and sign in with the owner address. With `--local`, no email is sent: the
code is printed in the terminal running `npm run dev`. Passkeys work on localhost.

```sh
npm test            # Worker tests in workerd: auth, catalog, OAuth + MCP, email ingest
npm run typecheck
```

Local dev has no Workers AI binding, so files other than plain text aren't converted.

## Costs

Usage for one household is small. Check Cloudflare's current pricing for Workers, D1, R2, KV, Email
Service and Workers AI before you deploy. Text extraction from images runs a Workers AI model, so
it counts toward Workers AI usage.

## License

MIT. See [LICENSE](./LICENSE).
