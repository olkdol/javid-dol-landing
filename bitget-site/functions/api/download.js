// Cloudflare Pages Function — serves /api/download
//
// Downloads are free and open, no access code. A GET request proxies the
// installer straight out of this project's own static assets
// (bitget-site/downloads/*.zip, served via the ASSETS binding) so the
// browser gets a normal file download — while every successful download is
// logged as one row in D1 (BOARD_DB -> download_events), so counts can be
// checked later via GET /api/download-stats?key=<STATS_KEY>. Logging never
// blocks or breaks the actual download — it runs in the background via
// ctx.waitUntil and any failure is swallowed.
//
// The front-end previously linked straight to downloads/<file>.zip, which
// works but can't be counted (static assets never touch a Function). Routing
// through /api/download is what makes counting possible.
//
// Required bindings on the Cloudflare project (already configured):
//   Assets binding -> ASSETS  (wrangler.jsonc "assets")
//   D1 database    -> BOARD_DB (javid-board-db-bitget)
//
// (The DOWNLOAD_CODES KV namespace is no longer read by this endpoint. It can
// stay bound harmlessly, or be unbound once nothing else uses it.)

const SITE = "bg";

const FILES = {
  windows: "downloads/JaviD_Future_Bot_Bitget_Windows.zip",
  mac: "downloads/JaviD_Future_Bot_Bitget_macOS.zip",
};

function pickPlatform(value) {
  const v = String(value || "").toLowerCase();
  if (v === "mac" || v === "macos" || v === "osx" || v === "darwin") return "mac";
  return "windows";
}

function logDownload(env, ctx, platform) {
  if (!env.BOARD_DB) return;
  const task = env.BOARD_DB
    .prepare(`INSERT INTO download_events (site, platform, downloaded_at) VALUES (?, ?, ?)`)
    .bind(SITE, platform, new Date().toISOString())
    .run()
    .catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(task);
  else return task;
}

async function serve(request, env, platform) {
  if (!env.ASSETS) return json({ error: "not_configured" }, 500);

  const relPath = FILES[platform];
  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/" + relPath;
  assetUrl.search = "";

  const assetRes = await env.ASSETS.fetch(assetUrl.toString());
  if (!assetRes.ok) return json({ error: "file_not_found", file: relPath }, 404);

  const filename = relPath.split("/").pop();
  const headers = new Headers(assetRes.headers);
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  // Don't let an edge cache pin an old build after the asset is replaced.
  headers.set("Cache-Control", "no-store");

  return new Response(assetRes.body, { status: 200, headers });
}

// Primary path: <a href="/api/download?platform=windows">
export async function onRequestGet({ request, env, ctx }) {
  const url = new URL(request.url);
  const platform = pickPlatform(url.searchParams.get("platform"));
  logDownload(env, ctx, platform);
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
  logDownload(env, ctx, platform);
  return serve(request, env, platform);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
