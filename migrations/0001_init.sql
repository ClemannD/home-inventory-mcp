-- One deployment is one household. Every signed-in user sees the same catalog.

-- Auth ----------------------------------------------------------------------

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at INTEGER NOT NULL,
  last_sign_in_at INTEGER
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,                -- WebAuthn credential ID, base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,           -- base64url
  counter INTEGER NOT NULL,
  transports TEXT,                    -- JSON array
  name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_user ON passkeys(user_id);

-- Session tokens are stored as SHA-256 hashes.
CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Pending WebAuthn ceremonies. Single use.
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'register')),
  challenge TEXT NOT NULL,
  user_id TEXT,
  expires_at INTEGER NOT NULL
);

-- At most one live sign-in code per address.
CREATE TABLE sign_in_codes (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL,
  window_start INTEGER NOT NULL,      -- start of the hourly send limit window
  window_sends INTEGER NOT NULL
);

-- Catalog -------------------------------------------------------------------

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  location TEXT,
  brand TEXT,
  model TEXT,
  serial TEXT,
  purchased_on TEXT,                  -- YYYY-MM-DD
  price_cents INTEGER,
  retailer TEXT,
  aliases TEXT NOT NULL DEFAULT '[]', -- JSON array of other names
  notes TEXT,
  fields TEXT NOT NULL DEFAULT '{}',  -- JSON object of extra attributes
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX items_name ON items(name);

CREATE TABLE warranties (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manufacturer',
  starts_on TEXT,
  ends_on TEXT,
  coverage TEXT,
  contact TEXT,
  policy_number TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX warranties_item ON warranties(item_id);
CREATE INDEX warranties_ends ON warranties(ends_on);

-- Records that aren't items: receipts, service history, notes. `type` is one
-- of the entry types in shared/entry-types.ts; `fields` holds that type's
-- attributes.
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  occurred_on TEXT,                   -- YYYY-MM-DD
  notes TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'email', 'mcp')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX entries_type ON entries(type, occurred_on);
CREATE INDEX entries_item ON entries(item_id);

-- A file in R2, or a link to one elsewhere. Belongs to at most one item or
-- entry; neither means it's unfiled.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- photo | manual | receipt | warranty | document
  name TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  r2_key TEXT,
  url TEXT,                           -- original location, for links and fetched copies
  text TEXT,                          -- extracted text, for search and read_file
  text_status TEXT NOT NULL DEFAULT 'none' CHECK (text_status IN ('none', 'pending', 'done', 'failed', 'unsupported')),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  CHECK (r2_key IS NOT NULL OR url IS NOT NULL)
);
CREATE INDEX files_item ON files(item_id);
CREATE INDEX files_entry ON files(entry_id);

-- Envelope senders allowed to email the ingest address.
CREATE TABLE email_senders (
  address TEXT PRIMARY KEY COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  created_by TEXT
);

-- Full-text index over items, entries and files. Maintained by
-- worker/catalog/search.ts, not by triggers, because a row's text comes from
-- more than one table.
CREATE VIRTUAL TABLE search_index USING fts5(
  ref UNINDEXED,
  kind UNINDEXED,
  title,
  body,
  tokenize = 'porter unicode61'
);
