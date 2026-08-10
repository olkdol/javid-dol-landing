// Cloudflare Pages Function — serves /api/download
//
// The access-code gate was removed: downloads are now FREE and open. A plain
// GET streams the installer straight out of the private R2 bucket
// (DOWNLOADS_BUCKET), so the front-end is just an <a href> and the browser
// handles the transfer natively.
//
// The zips still live ONLY in R2, never in this repo's public folder — that
// keeps the 25 MB binaries out of git and means publishing a new release is
// just replacing the R2 object, with no redeploy.
//
// Every successful download is also logged as one row in D1 (BOARD_DB ->
// download_events), so counts can be checked later via
// GET /api/download-stats?key=<STATS_KEY>. Logging never blocks or breaks
// the actual download — it runs in the background via ctx.waitUntil and any
// failure is swallowed.
//
// Required bindings on the Cloudflare project (Settings → Bindings):
//   R2 bucket    -> variable name: DOWNLOADS_BUCKET
//   D1 database  -> variable name: BOARD_DB (already bound — shared with the
//                    community board / live status)
//
// (The DOWNLOAD_CODES KV namespace is no longer read by this endpoint. It can
// stay bound harmlessly, or be unbound once nothing else uses it.)

const SITE = "bn";

const FILES = {
  windows: "JaviD_Future_Bot_Windows.zip",
  mac: "JaviD_Future_Bot_macOS.zip",
};

function pickPlatform(value) {
  const v = String(value || "").toLowerCase();
  if (v === "mac" || v === "macos" || v === "osx" || v === "darwin") return "mac";
  return "windows";
}

// 값이 없으면 NULL, 있으면 64자로 잘라서 저장 (개인정보 아님 — IP/UA는 절대 저장하지 않는다).
function clip(value) {
  if (!value) return null;
  const s = String(value).slice(0, 64);
  return s.length ? s : null;
}

function logDownload(env, ctx, request, platform) {
  if (!env.BOARD_DB) return;
  const url = new URL(request.url);
  const referrerHost = clip(url.searchParams.get("r"));
  const utmSource = clip(url.searchParams.get("us"));
  const utmMedium = clip(url.searchParams.get("um"));
  const utmCampaign = clip(url.searchParams.get("uc"));
  const landingPath = clip(url.searchParams.get("lp"));
  const country = clip(request.cf && request.cf.country);
  const task = env.BOARD_DB
    .prepare(
      `INSERT INTO download_events
         (site, platform, downloaded_at, referrer_host, utm_source, utm_medium, utm_campaign, landing_path, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(SITE, platform, new Date().toISOString(), referrerHost, utmSource, utmMedium, utmCampaign, landingPath, country)
    .run()
    .catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(task);
  else return task;
}

async function serve(env, platform) {
  if (!env.DOWNLOADS_BUCKET) return json({ error: "not_configured" }, 500);

  const fileKey = FILES[platform];
  const object = await env.DOWNLOADS_BUCKET.get(fileKey);
  if (!object) return json({ error: "file_not_found", file: fileKey }, 404);

  const headers = new Headers();
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="${fileKey}"`);
  // Don't let an edge cache pin an old build after the R2 object is replaced.
  headers.set("Cache-Control", "no-store");
  headers.set("Accept-Ranges", "bytes");
  if (object.size != null) headers.set("Content-Length", String(object.size));
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body, { status: 200, headers });
}

// Primary path: <a href="/api/download?platform=windows">
export async function onRequestGet({ request, env, ctx }) {
  const url = new URL(request.url);
  const platform = pickPlatform(url.searchParams.get("platform"));
  logDownload(env, ctx, request, platform);
  return serve(env, platform);
}

// HEAD, so a browser can probe size before downloading. Not counted — it's
// only a probe, not an actual download.
export async function onRequestHead({ request, env }) {
  const url = new URL(request.url);
  const res = await serve(env, pickPlatform(url.searchParams.get("platform")));
  return new Response(null, { status: res.status, headers: res.headers });
}

// Kept so any older cached copy of the page (which POSTed a JSON body) still
// works instead of failing. The code field, if present, is ignored.
export async function onRequestPost({ request, env, ctx }) {
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  const platform = pickPlatform(body.platform);
  logDownload(env, ctx, request, platform);
  return serve(env, platform);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
