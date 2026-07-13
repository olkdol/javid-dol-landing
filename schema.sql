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
