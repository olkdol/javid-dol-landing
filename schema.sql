-- JaviD Future Bot community board — D1 schema
-- Run this once in the D1 database's Console tab (Cloudflare dashboard),
-- or via: wrangler d1 execute <DB_NAME> --file=schema.sql

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0,
  salt TEXT,
  password_hash TEXT,
  reply TEXT,
  replied_at TEXT,
  created_at TEXT NOT NULL
);

-- Single-row table holding the operator's live account snapshot, pushed
-- periodically by the local bot. Only one row (id = 1) ever exists — every
-- push overwrites it. Powers the "Live Proof" section on index.html.
CREATE TABLE IF NOT EXISTS live_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  balance REAL,
  cumulative_pnl REAL,
  cumulative_return_pct REAL,
  win_rate REAL,
  trade_count INTEGER,
  open_positions INTEGER,
  updated_at TEXT NOT NULL
);

-- One row per successful download. `site` distinguishes which landing page
-- it came from, since this database is shared by javid-dol.uk and
-- bn.javidtrading.com. Read via GET /api/download-stats?key=<STATS_KEY> on
-- the bn.javidtrading.com site.
CREATE TABLE IF NOT EXISTS download_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  platform TEXT NOT NULL,
  downloaded_at TEXT NOT NULL
);
