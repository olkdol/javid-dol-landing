// Cloudflare Pages Function — serves /api/download
//
// Downloads are free and open, no access code. A GET request now serves the
// installer straight out of the R2 bucket (DOWNLOADS_BUCKET) first — so a new
// release can be published just by replacing the object in the Cloudflare
// dashboard (Storage & Databases -> R2 -> javid-downloads-okx), no git
// push / redeploy needed, same as the bn.javidtrading.com site.
//
// If the R2 object isn't found (e.g. bucket not filled in yet), it falls
// back to this project's own static assets (okx-site/downloads/*.zip,
// served via the ASSETS binding) so downloads never break during the
// R2 migration.
//
// Every successful download is also logged as one row in D1 (BOARD_DB ->
// download_events), so counts can be checked later via
// GET /api/download-stats?key=<STATS_KEY>. Logging never blocks or breaks
// the actual download — it runs in the background via ctx.waitUntil and any
// failure is swallowed.
//
// Required bindings on the Cloudflare project:
//   R2 bucket    -> variable name: DOWNLOADS_BUCKET (bucket_name: javid-downloads-okx)
//   Assets binding -> ASSETS  (wrangler.jsonc "assets") — fallback only
//   D1 database  -> BOARD_DB (javid-board-db-okx)
//
// To publish a new build: Cloudflare dashboard -> R2 -> javid-downloads-okx
// -> upload/overwrite an object with EXACTLY the key name below (case
// sensitive, no version number in the filename):
//   JaviD_Future_Bot_OKX_Windows.zip
//   JaviD_Future_Bot_OKX_macOS.zip
//
// (The DOWNLOAD_CODES KV namespace is no longer read by this endpoint. It can
// stay bound harmlessly, or be unbound once nothing else uses it.)

const SITE = "okx";

const FILES = {
  windows: {
    r2Key: "JaviD_Future_Bot_OKX_Windows.zip",
    assetPath: "downloads/JaviD_Future_Bot_OKX_Windows.zip",
  },
  mac: {
    r2Key: "JaviD_Future_Bot_OKX_macOS.zip",
    assetPath: "downloads/JaviD_Future_Bot_OKX_macOS.zip",
  },
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

// Try R2 first (new way to publish a release: just replace the object).
async function serveFromR2(env, platform) {
  if (!env.DOWNLOADS_BUCKET) return null;
  const fileKey = FILES[platform].r2Key;
  const object = await env.DOWNLOADS_BUCKET.get(fileKey);
  if (!object) return null;

  const headers = new Headers();
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="${fileKey}"`);
  // Don't let an edge cache pin an old build after the R2 object is replaced.
  headers.set("Cache-Control", "no-store");
  headers.set("Accept-Ranges", "bytes");
  if (object.size != null) headers.set("Content-Length", String(object.size));
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  // Debug aid: check this header (browser DevTools -> Network -> click the
  // download -> Response Headers) to see whether R2 or the fallback served
  // the file, and to see the exact byte size being sent.
  headers.set("X-Served-From", "r2");

  return new Response(object.body, { status: 200, headers });
}

// Fallback: serve straight from this project's own static assets, exactly
// like before the R2 migration. Keeps downloads working even if the R2
// bucket hasn't been filled in yet.
async function serveFromAssets(request, env, platform) {
  if (!env.ASSETS) return null;

  const relPath = FILES[platform].assetPath;
  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/" + relPath;
  assetUrl.search = "";

  const assetRes = await env.ASSETS.fetch(assetUrl.toString());
  if (!assetRes.ok) return null;

  const filename = relPath.split("/").pop();
  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Served-From", "assets");

  return new Response(assetRes.body, { status: 200, headers });
}

async function serve(request, env, platform) {
  const fromR2 = await serveFromR2(env, platform);
  if (fromR2) return fromR2;

  const fromAssets = await serveFromAssets(request, env, platform);
  if (fromAssets) return fromAssets;

  return json({ error: "file_not_found", file: FILES[platform].r2Key }, 404);
}

// Primary path: <a href="/api/download?platform=windows">
export async function onRequestGet({ request, env, ctx }) {
  const url = new URL(request.url);
  const platform = pickPlatform(url.searchParams.get("platform"));
  logDownload(env, ctx, request, platform);
  return serve(request, env, platform);
}

// HEAD, so a browser can probe size before downloading. Not counted — it's
// only a probe, not an actual download.
export async function onRequestHead({ request, env }) {
  const url = new URL(request.url);
  const res = await serve(request, env, pickPlatform(url.searchParams.get("platform")));
  return new Response(null, { status: res.status, headers: res.headers });
}

// Legacy compat: an older cached copy of the page may still POST a JSON body
// (used to be {code, platform}). The code field, if present, is ignored —
// downloads are free now.
export async function onRequestPost({ request, env, ctx }) {
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  const platform = pickPlatform(body.platform);
  logDownload(env, ctx, request, platform);
  return serve(request, env, platform);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
