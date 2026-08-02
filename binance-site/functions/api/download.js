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
// Required binding on the Cloudflare project (Settings → Bindings):
//   R2 bucket -> variable name: DOWNLOADS_BUCKET
//
// (The DOWNLOAD_CODES KV namespace is no longer read by this endpoint. It can
// stay bound harmlessly, or be unbound once nothing else uses it.)

const FILES = {
  windows: "JaviD_Future_Bot_Windows.zip",
  mac: "JaviD_Future_Bot_macOS.zip",
};

function pickPlatform(value) {
  const v = String(value || "").toLowerCase();
  if (v === "mac" || v === "macos" || v === "osx" || v === "darwin") return "mac";
  return "windows";
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
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  return serve(env, pickPlatform(url.searchParams.get("platform")));
}

// HEAD, so a browser can probe size before downloading.
export async function onRequestHead({ request, env }) {
  const res = await onRequestGet({ request, env });
  return new Response(null, { status: res.status, headers: res.headers });
}

// Kept so any older cached copy of the page (which POSTed a JSON body) still
// works instead of failing. The code field, if present, is ignored.
export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  return serve(env, pickPlatform(body.platform));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
