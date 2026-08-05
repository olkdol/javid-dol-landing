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

const SITE = "bn";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  // "시크릿 미설정"과 "키 불일치"를 구분한다. 둘 다 403 이면 원인을 알 수 없어
  // 디버깅이 불가능하다. 키 값 자체는 어떤 경우에도 응답에 넣지 않는다.
  if (!env.STATS_KEY) {
    return json({ error: "stats_key_not_configured",
                  hint: "Set STATS_KEY on this Worker: Settings -> Variables and Secrets" }, 503);
  }
  if (!key || key !== env.STATS_KEY) {
    return json({ error: "forbidden", hint: "key mismatch" }, 403);
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
