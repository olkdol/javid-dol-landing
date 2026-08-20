-- Migration for the bg (OKX) DB: javid-board-db-okx
-- (database_id: 984b1bcb-c257-496e-b5c4-6c73a1c1b994)
--
-- Adds the download-source-attribution columns to the existing
-- download_events table. Existing rows get NULL in these columns —
-- backward compatible, nothing else changes.
--
-- Run once from inside okx-site/ (wrangler.jsonc lives in this folder):
--   cd okx-site
--   npx wrangler d1 execute javid-board-db-okx --remote --file=./migration_download_source.sql
--
-- (Local/dev DB: drop --remote to apply to the local shadow DB instead.)

ALTER TABLE download_events ADD COLUMN referrer_host TEXT;   -- e.g. youtube.com, google.com, t.co
ALTER TABLE download_events ADD COLUMN utm_source   TEXT;    -- e.g. youtube, blog, telegram
ALTER TABLE download_events ADD COLUMN utm_medium   TEXT;    -- e.g. shorts, organic, social
ALTER TABLE download_events ADD COLUMN utm_campaign TEXT;    -- e.g. winrate-100, ai-agents
ALTER TABLE download_events ADD COLUMN landing_path TEXT;    -- first-touch entry path, e.g. /, /ko
ALTER TABLE download_events ADD COLUMN country      TEXT;    -- request.cf.country
