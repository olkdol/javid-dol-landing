// GET /api/download-stats?key=<STATS_KEY>
//
// Read-only download counters, backed by the download_events rows that
// /api/download logs on every successful download. Protected by a shared
// secret so it isn't public — the repo is public, so this key must be set
// directly in the Cloudflare dashboard (Settings -> Variables and Secrets),
// never committed to wrangler.jsonc.
//
// Required binding: D1 database -> BOARD_DB (already bound)
// Required var/secret: STATS_KEY (set once in the dashboard, any string you pick)

const SITE = "bg";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  if (!env.STATS_KEY || !key || key !== env.STATS_KEY) {
    return json({ error: "forbidden" }, 403);
  }
  if (!env.BOARD_DB) return json({ error: "not_configured" }, 500);

  const [byPlatform, totalRow, todayRow, last7Row] = await Promise.all([
    env.BOARD_DB.prepare(
      `SELECT platform, COUNT(*) AS count FROM download_events WHERE site = ? GROUP BY platform`
    )
      .bind(SITE)
      .all(),
    env.BOARD_DB.prepare(`SELECT COUNT(*) AS count FROM download_events WHERE site = ?`)
      .bind(SITE)
      .first(),
    env.BOARD_DB.prepare(
      `SELECT COUNT(*) AS count FROM download_events WHERE site = ? AND downloaded_at >= date('now')`
    )
      .bind(SITE)
      .first(),
    env.BOARD_DB.prepare(
      `SELECT COUNT(*) AS count FROM download_events WHERE site = ? AND downloaded_at >= datetime('now', '-7 days')`
    )
      .bind(SITE)
      .first(),
  ]);

  const platforms = { windows: 0, mac: 0 };
  for (const row of byPlatform.results || []) {
    platforms[row.platform] = row.count;
  }

  return json({
    site: SITE,
    total: totalRow ? totalRow.count : 0,
    today: todayRow ? todayRow.count : 0,
    last_7_days: last7Row ? last7Row.count : 0,
    by_platform: platforms,
  });
}
