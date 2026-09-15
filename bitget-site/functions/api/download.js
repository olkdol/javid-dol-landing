// Cloudflare Pages Function — serves /api/download
//
// Downloads are free and open, no access code. A GET request now serves the
// installer straight out of the R2 bucket (DOWNLOADS_BUCKET) first — so a new
// release can be published just by replacing the object in the Cloudflare
// dashboard (Storage & Databases -> R2 -> javid-downloads-bitget), no git
// push / redeploy needed, same as the bn.javidtrading.com site.
//
// If the R2 object isn't found (e.g. bucket not filled in yet), it falls
// back to this project's own static assets (bitget-site/downloads/*.zip,
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
//   R2 bucket    -> variable name: DOWNLOADS_BUCKET (bucket_name: javid-downloads-bitget)
//   Assets binding -> ASSETS  (wrangler.jsonc "assets") — fallback only
//   D1 database  -> BOARD_DB (javid-board-db-bitget)
//
// To publish a new build: Cloudflare dashboard -> R2 -> javid-downloads-bitget
// -> upload/overwrite an object with EXACTLY the key name below (case
// sensitive, no version number in the filename):
//   JaviD_Future_Bot_Bitget_Windows.zip
//   JaviD_Future_Bot_Bitget_macOS.zip
//
// (The DOWNLOAD_CODES KV namespace is no longer read by this endpoint. It can
// stay bound harmlessly, or be unbound once nothing else uses it.)

const SITE = "bg";

const FILES = {
  windows: {
    r2Key: "JaviD_Future_Bot_Bitget_Windows.zip",
    assetPath: "downloads/JaviD_Future_Bot_Bitget_Windows.zip",
  },
  mac: {
    r2Key: "JaviD_Future_Bot_Bitget_macOS.zip",
    assetPath: "downloads/JaviD_Future_Bot_Bitget_macOS.zip",
  },
  // 안드로이드 APK. 이게 없으면 ?platform=android 가 pickPlatform 의 기본값인
  // windows 로 떨어져서, 폰 사용자에게 윈도우 zip 이 내려간다.
  android: {
    r2Key: "JaviD_Future_Bot_Bitget_Android.apk",
    assetPath: "downloads/JaviD_Future_Bot_Bitget_Android.apk",
    contentType: "application/vnd.android.package-archive",
  },
};

function pickPlatform(value) {
  const v = String(value || "").toLowerCase();
  if (v === "mac" || v === "macos" || v === "osx" || v === "darwin") return "mac";
  if (v === "android" || v === "apk") return "android";
  return "windows";
}

// 값이 없으면 NULL, 있으면 64자로 잘라서 저장 (개인정보 아님 — IP/UA는 절대 저장하지 않는다).
function clip(value) {
  if (!value) return null;
  const s = String(value).slice(0, 64);
  return s.length ? s : null;
}

// 사람/기계 구분 신호. 원본 User-Agent 는 저장하지 않고 **분류 결과만** 남긴다(개인정보 원칙 유지).
// 2026-09-12 전수 분석: 집계 대부분이 랜딩을 거치지 않은 직접 호출이었고, 절반은 같은 국가에서
// 수 초 간격으로 mac+windows 를 연달아 받는 크롤러 패턴이었다. UA 가 없어 사후 필터가 불가능했다.
// ⚠️ "telegram" 같은 앱 이름은 넣지 말 것 — 텔레그램 인앱 브라우저(사람)의 UA 에도 들어 있다.
//    링크 미리보기 봇은 이름에 bot/preview 가 있어 아래 패턴으로 이미 걸린다.
// ⚠️ 이 INSERT 는 D1 에 ua_class·fetch_site 컬럼이 있어야 성공한다. 없으면 실패가 삼켜져
//    다운로드 기록이 **조용히 사라진다** — 컬럼 추가(ALTER)를 먼저 하고 배포할 것.
const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|preview|scanner|headless|lighthouse|facebookexternalhit|embedly|^whatsapp\//i;
const SCRIPT_UA = /^(curl|wget|python|go-http|java\/|okhttp|axios|node|undici|libwww|httpie|aiohttp|scrapy|php|ruby|dart)/i;

function classifyClient(request) {
  const ua = request.headers.get("user-agent") || "";
  if (!ua) return "empty";
  if (BOT_UA.test(ua)) return "bot";
  if (SCRIPT_UA.test(ua)) return "script";
  if (/^Mozilla\//.test(ua)) return "browser";
  return "other";
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
  const uaClass = classifyClient(request);
  // 브라우저가 붙이는 헤더: 우리 페이지 버튼이면 same-origin, 외부 링크에서 바로 받으면 cross-site,
  // 주소창 직접 입력이면 none. 스크립트·크롤러는 대개 보내지 않는다.
  const fetchSite = clip(request.headers.get("sec-fetch-site"));
  const task = env.BOARD_DB
    .prepare(
      `INSERT INTO download_events
         (site, platform, downloaded_at, referrer_host, utm_source, utm_medium, utm_campaign, landing_path, country, ua_class, fetch_site)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(SITE, platform, new Date().toISOString(), referrerHost, utmSource, utmMedium, utmCampaign, landingPath, country, uaClass, fetchSite)
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
  headers.set("Content-Type", FILES[platform].contentType || "application/zip");
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
  headers.set("Content-Type", FILES[platform].contentType || "application/zip");
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
