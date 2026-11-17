-- One-time links for uploading files to an item or entry without signing in.
-- The token is stored as a SHA-256 hash. A link works for one submission
-- (which can hold several files) and expires after an hour.
CREATE TABLE upload_links (
  hash TEXT PRIMARY KEY,
  item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  CHECK ((item_id IS NULL) <> (entry_id IS NULL))
);
