-- JaviD Future Bot (Bitget edition) community board + live status — D1 schema
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
-- periodically by the local bot. Only one row (id = 1) ever exists.
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
