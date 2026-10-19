// legacy_redirect.js — CANONICAL COPY. tools/sync_redirect.mjs copies this file into
// bitget-site/, binance-site/, bybit-site/, okx-site/ and _to_delete_legacy_javid-dol-uk/
// (each worker is deployed from its own folder). Edit here, then run the sync script.
//
// 2026-10-19 renewal: the exchange sites' pages moved to https://www.javidtrading.com.
// User decision: "화면만 없애고 연결" — every HTML page answers with a 301 to the matching
// www page (language and exchange preserved); /api/* is NOT touched (downloads + D1 counting,
// board, status, stats keep running on each exchange worker); images, screenshots, result
// images, download fallbacks, data files, robots.txt and sitemap.xml keep being served so old
// blog posts keep their images and search engines can re-crawl the old URLs and see the 301s.

export const WWW = "https://www.javidtrading.com";
const LANGS = ["ko", "ja", "es", "fr", "vi", "tr", "pt"];
// paths that stay on the exchange host even though they look like pages
const KEEP_PAGES = new Set(["/download-stats", "/download-stats.html"]);

function withQuery(target, url, extra = {}) {
  const t = new URL(target);
  for (const [k, v] of url.searchParams) if (k !== "lang" && !t.searchParams.has(k)) t.searchParams.set(k, v);
  for (const [k, v] of Object.entries(extra)) t.searchParams.set(k, v);
  return t.toString();
}

// Returns the www URL for an exchange-site path, or null when the path must be served as before.
export function legacyTarget(exchange, urlLike) {
  const url = new URL(urlLike);
  let p = url.pathname;
  if (p.startsWith("/api/")) return null;
  if (KEEP_PAGES.has(p)) return null;
  if (p === "/llms.txt") return WWW + "/llms.txt";
  // anything with a file extension other than .html is an asset (images, zips, json, xml, txt)
  const last = p.split("/").pop();
  if (/\.[A-Za-z0-9]{1,5}$/.test(last) && !/\.html?$/i.test(last)) return null;
  p = p.replace(/\.html?$/i, "").replace(/\/index$/, "/").replace(/\/+$/, "") || "/";
  const ex = { exchange };
  const lang = LANGS.includes(url.searchParams.get("lang")) ? url.searchParams.get("lang") : null;
  const pre = (l) => (l ? "/" + l : "");
  if (p === "/") return withQuery(WWW + "/", url, ex);
  const m = p.match(/^\/(ko|ja|es|fr|vi|tr|pt)$/);
  if (m) return withQuery(WWW + "/" + m[1], url, ex);
  const lm = p.match(/^\/(ko|ja|es|fr|vi|tr|pt)\/(.+)$/);
  const l2 = lm ? lm[1] : lang;
  const rest = lm ? "/" + lm[2] : p;
  if (rest === "/results") return withQuery(WWW + pre(l2) + "/exchange", url, ex);
  if (rest === "/manual") return withQuery(WWW + pre(l2) + "/guide", url, ex);
  if (rest === "/board") return withQuery(WWW + pre(l2) + "/board", url);
  if (rest === "/install-help") return withQuery(WWW + pre(l2) + "/download", url, ex) + "#install";
  if (rest === "/download") return withQuery(WWW + pre(l2) + "/download", url, ex);
  if (/^\/(binance|bitget|bybit|okx)-signup-api-guide$/.test(rest)) return withQuery(WWW + "/api-guide/" + rest.slice(1).split("-")[0], url);
  // unknown page -> that language's home with the exchange preselected
  return withQuery(l2 ? WWW + "/" + l2 : WWW + "/", url, ex);
}

export function legacyRedirect(exchange, request) {
  const to = legacyTarget(exchange, request.url);
  if (!to) return null;
  const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  return new Response(null, { status, headers: { Location: to, "Cache-Control": "public, max-age=3600" } });
}
