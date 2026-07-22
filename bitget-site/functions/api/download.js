// Cloudflare Pages Function — serves /api/download (POST)
// Validates an access code against KV (DOWNLOAD_CODES), then streams the
// matching file straight out of a private R2 bucket (DOWNLOADS_BUCKET).
// The zip files must NOT live in a public folder of this repo — only in
// R2 — otherwise this gate is pointless (the direct URL would still work).
//
// Required bindings on the Cloudflare project:
//   KV namespace   -> variable name: DOWNLOAD_CODES
//   R2 bucket      -> variable name: DOWNLOADS_BUCKET
//
// To add/remove valid codes: Cloudflare dashboard -> Storage & Databases ->
// KV -> DOWNLOAD_CODES -> Add entry. Key = the code (normalized to
// uppercase below), value = anything (e.g. "active"). No redeploy needed.

const FILES = {
  windows: "JaviD_Future_Bot_Bitget_Windows.zip",
  mac: "JaviD_Future_Bot_Bitget_macOS.zip",
};

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_request" }, 400);
  }

  const code = String(body.code || "").trim().toUpperCase();
  const platform = body.platform === "mac" ? "mac" : "windows";

  if (!code) return json({ error: "missing_code" }, 400);
  if (!env.DOWNLOAD_CODES || !env.DOWNLOADS_BUCKET) {
    return json({ error: "not_configured" }, 500);
  }

  const record = await env.DOWNLOAD_CODES.get(code);
  if (!record) return json({ error: "invalid_code" }, 403);

  const fileKey = FILES[platform];
  const object = await env.DOWNLOADS_BUCKET.get(fileKey);
  if (!object) return json({ error: "file_not_found" }, 404);

  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileKey}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet() {
  return json({ error: "method_not_allowed" }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
