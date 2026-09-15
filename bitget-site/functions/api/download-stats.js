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

// "사람 확정" = 우리 랜딩 JS 를 거쳐 온 요청(landing_path 있음)이면서 봇·스크립트로 분류되지 않은 것.
// 2026-09-15 이전 행은 ua_class 가 없어 landing_path 만으로 판정한다.
// 원시 합계(total/today/last_7_days)는 **상한**, human_* 는 **하한** — 둘을 같이 보고한다
// (다운로드는 실사용자만 센다는 원칙. 원시 합계의 대부분은 크롤러 패턴이었다, 2026-09-12 분석).
// 'other' 는 사람으로 둔다 — 안드로이드 인앱 브라우저가 다운로드를 시스템 다운로드 관리자
// (UA "Dalvik/…")로 넘기면 사람이 버튼을 눌렀어도 브라우저 UA 가 아니다.
const HUMAN = "landing_path IS NOT NULL AND COALESCE(ua_class, 'browser') NOT IN ('bot', 'script')";

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

  const [byPlatform, totalRow, todayRow, last7Row, bySource, byReferrer, byCampaign, byCountry,
         humanTotalRow, humanTodayRow, human7Row, humanBySource, byClient, byFetchSite] =
    await Promise.all([
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
      // 아래 4개는 최근 30일 기준 분해 — utm_source/referrer_host/utm_campaign/country
      // 컬럼이 없는 과거 행(NULL)은 각각 direct/(none)/제외/unknown 으로 처리한다.
      env.BOARD_DB.prepare(
        `SELECT COALESCE(utm_source, 'direct') AS k, COUNT(*) AS count
           FROM download_events
          WHERE site = ? AND downloaded_at >= datetime('now', '-30 days')
          GROUP BY k`
      )
        .bind(SITE)
        .all(),
      env.BOARD_DB.prepare(
        `SELECT COALESCE(referrer_host, '(none)') AS k, COUNT(*) AS count
           FROM download_events
          WHERE site = ? AND downloaded_at >= datetime('now', '-30 days')
          GROUP BY k`
      )
        .bind(SITE)
        .all(),
      env.BOARD_DB.prepare(
        `SELECT utm_campaign AS k, COUNT(*) AS count
           FROM download_events
          WHERE site = ? AND downloaded_at >= datetime('now', '-30 days')
            AND utm_campaign IS NOT NULL
          GROUP BY k`
      )
        .bind(SITE)
        .all(),
      env.BOARD_DB.prepare(
        `SELECT COALESCE(country, 'unknown') AS k, COUNT(*) AS count
           FROM download_events
          WHERE site = ? AND downloaded_at >= datetime('now', '-30 days')
          GROUP BY k`
      )
        .bind(SITE)
        .all(),
      // ── 사람 확정(하한) ──
      env.BOARD_DB.prepare(`SELECT COUNT(*) AS count FROM download_events WHERE site = ? AND ${HUMAN}`)
        .bind(SITE)
        .first(),
      env.BOARD_DB.prepare(
        `SELECT COUNT(*) AS count FROM download_events
          WHERE site = ? AND ${HUMAN} AND downloaded_at >= date('now')`
      )
        .bind(SITE)
        .first(),
      env.BOARD_DB.prepare(
        `SELECT COUNT(*) AS count FROM download_events
          WHERE site = ? AND ${HUMAN} AND downloaded_at >= datetime('now', '-7 days')`
      )
        .bind(SITE)
        .first(),
      // UTM 이 없으면 참조 호스트(예: chatgpt.com), 그것도 없으면 direct.
      env.BOARD_DB.prepare(
        `SELECT COALESCE(utm_source, referrer_host, 'direct') AS k, COUNT(*) AS count
           FROM download_events
          WHERE site = ? AND ${HUMAN} AND downloaded_at >= datetime('now', '-30 days')
          GROUP BY k`
      )
        .bind(SITE)
        .all(),
      // ── 요청 성격(최근 30일, 원시 전체) ──
      env.BOARD_DB.prepare(
        `SELECT COALESCE(ua_class, '(unrecorded)') AS k, COUNT(*) AS count
           FROM download_events
          WHERE site = ? AND downloaded_at >= datetime('now', '-30 days')
          GROUP BY k`
      )
        .bind(SITE)
        .all(),
      env.BOARD_DB.prepare(
        `SELECT COALESCE(fetch_site, '(none)') AS k, COUNT(*) AS count
           FROM download_events
          WHERE site = ? AND downloaded_at >= datetime('now', '-30 days')
          GROUP BY k`
      )
        .bind(SITE)
        .all(),
    ]);

  const platforms = { windows: 0, mac: 0, android: 0 };
  for (const row of byPlatform.results || []) {
    platforms[row.platform] = row.count;
  }

  function toObject(result) {
    const out = {};
    for (const row of result.results || []) out[row.k] = row.count;
    return out;
  }

  return json({
    site: SITE,
    total: totalRow ? totalRow.count : 0,
    today: todayRow ? todayRow.count : 0,
    last_7_days: last7Row ? last7Row.count : 0,
    by_platform: platforms,
    by_source: toObject(bySource),
    by_referrer: toObject(byReferrer),
    by_campaign: toObject(byCampaign),
    by_country: toObject(byCountry),
    human_total: humanTotalRow ? humanTotalRow.count : 0,
    human_today: humanTodayRow ? humanTodayRow.count : 0,
    human_last_7_days: human7Row ? human7Row.count : 0,
    human_by_source: toObject(humanBySource),
    by_client: toObject(byClient),
    by_fetch_site: toObject(byFetchSite),
  });
}
