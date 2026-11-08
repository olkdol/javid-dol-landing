// Path gate for /blog-media when this Worker runs.
// The approved path is also listed as a negative run_worker_first rule so a
// matching GET is served by the asset worker and does not invoke this script.
// This gate still applies if the rule is absent: it never reads LIVE_CAPTURES,
// and it never accepts a non-card path.

export const CARD_FILENAME_SOURCE =
  "^acct_\\d{8}_(en|ja|es|fr|vi|tr|pt)_(1_calendar|2_report)\\.png$";

const CARD_FILENAME = new RegExp(CARD_FILENAME_SOURCE);
const PREFIX = "/blog-media/";

export function validCardDate(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd)) return false;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function plain(status, body, extra) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

export function blogMediaResponse(request, env, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return plain(405, "method not allowed", { Allow: "GET, HEAD" });
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return plain(404, "not found");
  }
  if (decoded !== pathname || decoded.includes("\\") || decoded.includes("..") || !decoded.startsWith(PREFIX)) {
    return plain(404, "not found");
  }
  const name = decoded.slice(PREFIX.length);
  if (name.includes("/") || !CARD_FILENAME.test(name) || !validCardDate(name.slice(5, 13))) {
    return plain(404, "not found");
  }
  return env.ASSETS.fetch(request);
}
