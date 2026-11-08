var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/blog-media-guard.js
var CARD_FILENAME_SOURCE = "^acct_\\d{8}_(en|ja|es|fr|vi|tr|pt)_(1_calendar|2_report)\\.png$";
var CARD_FILENAME = new RegExp(CARD_FILENAME_SOURCE);
var PREFIX = "/blog-media/";
function validCardDate(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd)) return false;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
__name(validCardDate, "validCardDate");
function plain(status, body, extra) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra
    }
  });
}
__name(plain, "plain");
function blogMediaResponse(request, env, pathname) {
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
__name(blogMediaResponse, "blogMediaResponse");

// functions/api/live_capture.js
var LATEST = "manifest/latest.json";
var STALE_AFTER_S = 2 * 3600;
var MAX_IMG = 4 * 1024 * 1024;
var VIEWS = ["dashboard", "positions"];
var IMG_TYPES = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };
var RETAIN_DAYS = 14;
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }
  });
}
__name(json, "json");
function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
var isNum = /* @__PURE__ */ __name((v) => typeof v === "number" && Number.isFinite(v), "isNum");
var isDay = /* @__PURE__ */ __name((s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s), "isDay");
function sanitizeManifest(m, now = Date.now()) {
  const err = /* @__PURE__ */ __name((e) => ({ error: e }), "err");
  if (!m || typeof m !== "object") return err("manifest_not_object");
  if (m.schema !== 1) return err("schema");
  const t = Date.parse(m.captured_at);
  if (!Number.isFinite(t)) return err("captured_at");
  if (t > now + 10 * 60 * 1e3 || t < now - 6 * 3600 * 1e3) return err("captured_at_out_of_range");
  const acc = m.account || {};
  if (acc.exchange !== "binance") return err("account.exchange");
  if (!m.checks || m.checks.credentials_visible !== 0 || m.checks.account_match !== true) return err("checks_failed");
  const out = {
    schema: 1,
    captured_at: new Date(t).toISOString(),
    source: "Mini-PC live dashboard (one real Binance account) via a local proxy that masks API keys and tokens",
    account: {
      id: "binance-live-1",
      exchange: "binance",
      program_version: typeof acc.program_version === "string" ? acc.program_version.slice(0, 12) : null,
      open_positions: Number.isInteger(acc.open_positions) && acc.open_positions >= 0 ? acc.open_positions : null,
      settings: null
    },
    views: {},
    metrics: null
  };
  const s = acc.settings;
  if (s && typeof s === "object") {
    const mode = String(s.investment_mode || "").toUpperCase();
    if (/^(MAX|HIGH|AGGRESSIVE|NORMAL|STABLE|CUSTOM)$/.test(mode) && isNum(s.leverage) && s.leverage > 0 && s.leverage <= 125) {
      out.account.settings = {
        investment_mode: mode,
        investment_divisor: isNum(s.investment_divisor) && s.investment_divisor > 0 ? s.investment_divisor : null,
        leverage: s.leverage,
        hard_stop: s.hard_stop === true,
        entry_mode: typeof s.entry_mode === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(s.entry_mode) ? s.entry_mode : null
      };
    }
  }
  const mt = m.metrics;
  if (mt && Array.isArray(mt.daily)) {
    if (mt.daily.length > 800) return err("daily_too_long");
    const daily = [];
    for (const d of mt.daily) {
      if (!d || !isDay(d.d) || !isNum(d.pnl) || !isNum(d.funding)) return err("daily_row");
      for (const k of ["trades", "wins", "losses", "flat"]) if (!Number.isInteger(d[k]) || d[k] < 0) return err("daily_counts");
      if (d.wins + d.losses + d.flat !== d.trades) return err("daily_count_sum");
      if (d.worst != null && !isNum(d.worst)) return err("daily_worst");
      daily.push({ d: d.d, pnl: d.pnl, funding: d.funding, trades: d.trades, wins: d.wins, losses: d.losses, flat: d.flat, worst: d.worst ?? null });
    }
    const recent = [];
    for (const r of Array.isArray(mt.recent_trades) ? mt.recent_trades.slice(0, 30) : []) {
      if (!r || typeof r.t !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.t)) return err("trade_time");
      if (typeof r.s !== "string" || !/^[A-Z0-9]{2,30}$/.test(r.s)) return err("trade_symbol");
      if (!["LONG", "SHORT"].includes(r.side) || !isNum(r.pnl) || r.roe != null && !isNum(r.roe)) return err("trade_row");
      recent.push({ t: r.t, s: r.s, side: r.side, pnl: r.pnl, roe: r.roe ?? null });
    }
    out.metrics = {
      scope: "closed trades + funding fees; open positions and shadow trades excluded; dates Korea time (UTC+9)",
      tz: "Asia/Seoul",
      daily,
      recent_trades: recent
    };
  }
  return out;
}
__name(sanitizeManifest, "sanitizeManifest");
function dayFolder(iso) {
  return iso.slice(0, 10);
}
__name(dayFolder, "dayFolder");
async function prune(env, nowIso) {
  const d = new Date(nowIso);
  d.setUTCDate(d.getUTCDate() - RETAIN_DAYS);
  const prefix = "captures/" + d.toISOString().slice(0, 10) + "/";
  const list = await env.LIVE_CAPTURES.list({ prefix, limit: 100 });
  if (list.objects.length) await env.LIVE_CAPTURES.delete(list.objects.map((o) => o.key));
}
__name(prune, "prune");
async function upload({ request, env, ctx }) {
  if (!env.LIVE_CAPTURES) return json({ error: "not_configured" }, 500);
  const key = request.headers.get("x-capture-key") || "";
  if (!env.LIVE_CAPTURE_KEY || !timingSafeEqual(key, env.LIVE_CAPTURE_KEY)) return json({ error: "forbidden" }, 403);
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "expected_multipart" }, 400);
  }
  let raw;
  try {
    raw = JSON.parse(String(form.get("manifest") || ""));
  } catch {
    return json({ error: "manifest_json" }, 400);
  }
  const m = sanitizeManifest(raw);
  if (m.error) return json({ error: "invalid_manifest", detail: m.error }, 422);
  const stamp = m.captured_at.replace(/[-:]/g, "").slice(0, 13);
  const files = [];
  for (const v of VIEWS) {
    const f = form.get(v);
    if (!f || typeof f === "string") continue;
    const ext = IMG_TYPES[f.type];
    if (!ext) return json({ error: "image_type", view: v }, 415);
    if (f.size > MAX_IMG || f.size < 1e3) return json({ error: "image_size", view: v }, 413);
    const w = Number(raw.views && raw.views[v] && raw.views[v].width), h = Number(raw.views && raw.views[v] && raw.views[v].height);
    files.push({ v, f, ext, w: Number.isInteger(w) && w > 0 && w < 5e3 ? w : null, h: Number.isInteger(h) && h > 0 && h < 5e3 ? h : null });
  }
  if (!files.find((x) => x.v === "dashboard")) return json({ error: "dashboard_image_required" }, 400);
  for (const x of files) {
    const k = `captures/${dayFolder(m.captured_at)}/${stamp}Z-${x.v}.${x.ext}`;
    await env.LIVE_CAPTURES.put(k, await x.f.arrayBuffer(), { httpMetadata: { contentType: x.f.type } });
    m.views[x.v] = { key: k, width: x.w, height: x.h, bytes: x.f.size };
  }
  m.received_at = (/* @__PURE__ */ new Date()).toISOString();
  await env.LIVE_CAPTURES.put(LATEST, JSON.stringify(m), { httpMetadata: { contentType: "application/json" } });
  if (ctx && ctx.waitUntil) ctx.waitUntil(prune(env, m.captured_at).catch(() => {
  }));
  return json({ ok: true, captured_at: m.captured_at, views: Object.keys(m.views) });
}
__name(upload, "upload");
async function readLatest(env) {
  if (!env.LIVE_CAPTURES) return null;
  const o = await env.LIVE_CAPTURES.get(LATEST);
  if (!o) return null;
  try {
    return JSON.parse(await o.text());
  } catch {
    return null;
  }
}
__name(readLatest, "readLatest");
function publicManifest(m, now = Date.now()) {
  if (!m) return { available: false };
  const age = Math.max(0, Math.round((now - Date.parse(m.captured_at)) / 1e3));
  const views = {};
  for (const [v, info] of Object.entries(m.views || {})) {
    views[v] = { url: "/api/live-capture/img/" + info.key.replace(/^captures\//, ""), width: info.width, height: info.height };
  }
  return { available: true, captured_at: m.captured_at, age_seconds: age, stale: age > STALE_AFTER_S, source: m.source, account: m.account, views, metrics: m.metrics };
}
__name(publicManifest, "publicManifest");
async function latest({ env }) {
  const m = await readLatest(env);
  return json(publicManifest(m), 200, { "Cache-Control": "public, max-age=60" });
}
__name(latest, "latest");
async function image({ env, params }) {
  if (!env.LIVE_CAPTURES) return new Response("not configured", { status: 500 });
  const rel = params.path || "";
  if (!/^\d{4}-\d{2}-\d{2}\/\d{8}T\d{4}Z-(dashboard|positions)\.(webp|png|jpg)$/.test(rel)) return new Response("not found", { status: 404 });
  const o = await env.LIVE_CAPTURES.get("captures/" + rel);
  if (!o) return new Response("not found", { status: 404 });
  return new Response(o.body, {
    headers: {
      "Content-Type": o.httpMetadata && o.httpMetadata.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(image, "image");

// src/config/exchanges.json
var exchanges_default = {
  _comment: "Single source of truth for the four exchange builds shown on www. Sizes are the R2 object sizes (Cloudflare R2 admin API, 2026-10-19); SHA-256 values are the ones published on each exchange site's install-help page for the 2026-10-13 builds. Download links point at each exchange worker's existing /api/download endpoint so D1 counting and landing attribution keep working. Never add a download URL for a file that is not in R2. Android is on hold (PyArmor runtime does not load under Chaquopy) - do not add android entries.",
  order: [
    "binance",
    "bitget",
    "bybit",
    "okx"
  ],
  default: "bitget",
  exchanges: {
    binance: {
      name: "Binance",
      logo: "/assets/img/binance-logo.png",
      site: "https://bn.javidtrading.com",
      signup_url: "https://accounts.binance.com/register",
      api_guide_path: "/api-guide/binance",
      status: "available",
      live_data: true,
      copy_trading_key: "binance",
      passphrase: false,
      version: "V19.7",
      build_tag: null,
      release_date: "2026-10-13",
      downloads: {
        windows: {
          url: "https://bn.javidtrading.com/api/download?platform=windows",
          file: "JaviD_Future_Bot_Windows.zip",
          bytes: 19856003,
          sha256: "db70a5ed681093ccfbc3122c52dcb69b0114518c5e30a0b87fec82d5d514a2f0"
        },
        mac: {
          url: "https://bn.javidtrading.com/api/download?platform=mac",
          file: "JaviD_Future_Bot_macOS.zip",
          bytes: 66112222,
          sha256: "c44bc5ffefffeee155c2eea149e36f9a4a0b8e8b19401894cf0bdbb3c774d8dc"
        }
      },
      install_help: "binance",
      notes_key: "ex_note_binance"
    },
    bitget: {
      name: "Bitget",
      logo: "/assets/img/bitget-logo.png",
      site: "https://bg.javidtrading.com",
      signup_url: "https://www.bitget.com/register",
      api_guide_path: "/api-guide/bitget",
      status: "available",
      live_data: false,
      copy_trading_key: "bitget",
      passphrase: true,
      version: "V19.7",
      build_tag: null,
      release_date: "2026-10-13",
      downloads: {
        windows: {
          url: "https://bg.javidtrading.com/api/download?platform=windows",
          file: "JaviD_Future_Bot_Bitget_Windows.zip",
          bytes: 23904206,
          sha256: "b566d6df21de0125b5498ab76d8818d3035dff3669593decfa8b1bf49a7d62f3"
        },
        mac: {
          url: "https://bg.javidtrading.com/api/download?platform=mac",
          file: "JaviD_Future_Bot_Bitget_macOS.zip",
          bytes: 73841532,
          sha256: "083c4525694d4611cf7088b4237b798289ec45790d115e9e8569c59853602eb3"
        }
      },
      install_help: "bitget",
      notes_key: "ex_note_bitget"
    },
    bybit: {
      name: "Bybit",
      logo: "/assets/img/bybit-logo.png",
      site: "https://bb.javidtrading.com",
      signup_url: "https://www.bybit.com/register",
      api_guide_path: "/api-guide/bybit",
      status: "available",
      live_data: false,
      copy_trading_key: "bybit",
      passphrase: false,
      version: "V19.7",
      build_tag: null,
      release_date: "2026-10-13",
      downloads: {
        windows: {
          url: "https://bb.javidtrading.com/api/download?platform=windows",
          file: "JaviD_Future_Bot_Bybit_Windows.zip",
          bytes: 23967335,
          sha256: "0a55c31188bb5158608ddff99f7bcbf5e35e84de5979b2b015e614c91d4657bd"
        },
        mac: {
          url: "https://bb.javidtrading.com/api/download?platform=mac",
          file: "JaviD_Future_Bot_Bybit_macOS.zip",
          bytes: 73941216,
          sha256: "4ff157605873e85fee301d99442064bf45b82dc8aabec2573ae35080d26ee608"
        }
      },
      install_help: "bybit",
      notes_key: "ex_note_bybit"
    },
    okx: {
      name: "OKX",
      logo: "/assets/img/okx-logo.png",
      site: "https://okx.javidtrading.com",
      signup_url: "https://www.okx.com/account/register",
      api_guide_path: "/api-guide/okx",
      status: "available",
      live_data: false,
      copy_trading_key: "okx",
      passphrase: true,
      version: "V19.7",
      build_tag: null,
      release_date: "2026-11-03",
      downloads: {
        windows: {
          url: "https://okx.javidtrading.com/api/download?platform=windows",
          file: "JaviD_Future_Bot_OKX_Windows.zip",
          bytes: 24459383,
          sha256: "3598628908b370c3880b5c25319d8b45dd231f011af270ab557136e46d7411db"
        },
        mac: {
          url: "https://okx.javidtrading.com/api/download?platform=mac",
          file: "JaviD_Future_Bot_OKX_macOS.zip",
          bytes: 74670985,
          sha256: "a7bb8c19dbc03aa15b9a2cce0e5b4e31507a6e08178a0686ac7e24e3a5fb7771"
        }
      },
      install_help: "okx",
      notes_key: "ex_note_okx"
    }
  }
};

// src/config/copy_trading.json
var copy_trading_default = {
  _comment: "Copy-trading profiles shown on /copy-trading, the home page and the exchange cards. Links are the exchanges' own copy-trading invite links supplied by the user on 2026-10-19 (not sign-up referral links). Both carry the exchange's invite code; the site says so next to the button. The build fails if a live entry's URL is outside allowed_domains. Never copy returns, follower counts, profit-share figures or any other numbers into this file or onto the site - link to the exchange page instead. 'qr' stays null unless a QR was captured from the official page AND decoded to the same link; never generate or fabricate one.",
  allowed_domains: {
    binance: ["binance.com"],
    bitget: ["bitget.com", "share.glassgs.com"],
    bybit: ["bybit.com", "bybit.onelink.me"],
    okx: ["okx.com"]
  },
  profiles: {
    binance: { status: "coming_soon", profile_url: null, updated: null },
    bitget: {
      status: "live",
      profile_url: "https://share.glassgs.com/sl/0756VRB2MT0J",
      resolved_url: "https://www.bitget.com/copy-trading/futures-trader/1494818877774102528/",
      resolved_checked: "2026-10-19: headless Chromium (desktop + iPhone UA) lands on Bitget's app mid-page; 'Continue' opens the Bitget futures copy-trading trader page 1494818877774102528 (profile name Javid_Trading). Link carries shareInviteCode/commonCode 'bszn'.",
      contains_invite_code: true,
      qr: null,
      qr_note: "No QR is rendered on the share page or the trader page without logging in (the share button redirects to the Bitget login). Not captured, not generated.",
      updated: "2026-10-19"
    },
    bybit: {
      status: "live",
      profile_url: "https://bybit.onelink.me/EhY6/6t5au21d?action=inviteToCopy",
      resolved_url: "https://www.bybit.com/copyTrading/en/profile?leaderMark=S16YhX0fWuC3TnlO9pay4Q%3D%3D",
      resolved_checked: "2026-10-19: curl -L resolves to www.bybit.com/copyTrading/en/profile (leaderMark S16YhX0fWuC3TnlO9pay4Q==). Link carries ref=JNY4XP.",
      contains_invite_code: true,
      qr: null,
      updated: "2026-10-19"
    },
    okx: { status: "coming_soon", profile_url: null, updated: null }
  }
};

// src/data/backtest/published.json
var published_default = {
  _comment: 'Pointer to the single verified backtest shown on the site. Written ONLY by tools/backtest_publish.mjs after every check passes (atomic replace). null = nothing verified yet; the site then shows the localized "no verified backtest yet" state. Never edit by hand.',
  published: null,
  history: []
};

// functions/api/v1.js
var CALC = {
  realized_pnl: "sum of closed-trade P&L plus funding fees from the program's trade records (USDT)",
  wins: "closed trades with P&L > 0; trades closed at exactly 0 count as neither win nor loss",
  excluded: "open positions (unrealized P&L), shadow (virtual) trades",
  curve: "cumulative realized P&L by day; NOT an account equity curve and NOT a drawdown measure",
  timezone: "Asia/Seoul (UTC+9), as recorded by the program",
  sample: "one real account; the whole sample"
};
function json2(data, status = 200, maxAge = 60) {
  return new Response(JSON.stringify(data, null, 1), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${maxAge}`, "Access-Control-Allow-Origin": "*" }
  });
}
__name(json2, "json");
function exchangeSummary(id) {
  const e = exchanges_default.exchanges[id];
  const ct = copy_trading_default.profiles[id] || {};
  return {
    id,
    name: e.name,
    download_status: e.status,
    version: e.version,
    release_date: e.release_date,
    platforms: Object.keys(e.downloads || {}),
    live_data: !!e.live_data,
    copy_trading: { status: ct.status || "coming_soon", url: ct.status === "live" ? ct.profile_url : null, contains_invite_code: !!ct.contains_invite_code }
  };
}
__name(exchangeSummary, "exchangeSummary");
function period(days, p) {
  if (!days.length || p === "all") return days;
  const n = { "7d": 7, "30d": 30, "90d": 90 }[p];
  if (!n) return null;
  const last = /* @__PURE__ */ new Date(days[days.length - 1].d + "T00:00:00Z");
  last.setUTCDate(last.getUTCDate() - (n - 1));
  const cut = last.toISOString().slice(0, 10);
  return days.filter((d) => d.d >= cut);
}
__name(period, "period");
function noData(id, what) {
  return { exchange: id, available: false, reason: "no live account data for this exchange is connected to this site", data: null, what };
}
__name(noData, "noData");
async function v1(request, env, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") return json2({ error: "method_not_allowed" }, 405, 0);
  const url = new URL(request.url);
  if (pathname === "/api/v1/exchanges") return json2({ exchanges: exchanges_default.order.map(exchangeSummary) }, 200, 300);
  if (pathname === "/api/v1/backtest/latest") {
    return json2({
      available: !!published_default.published,
      published: published_default.published || null,
      history: published_default.history || [],
      note: "only the latest verified run is published; backtests are never combined with live records"
    }, 200, 300);
  }
  const m = pathname.match(/^\/api\/v1\/exchanges\/([a-z]+)\/(performance|equity-curve|trades|status)$/);
  if (!m) return json2({ error: "not_found" }, 404, 0);
  const [, id, kind] = m;
  if (!exchanges_default.exchanges[id]) return json2({ error: "unknown_exchange" }, 404, 0);
  if (!exchanges_default.exchanges[id].live_data) return json2(noData(id, kind));
  const man = publicManifest(await readLatest(env));
  const base = {
    exchange: id,
    source: man.available ? man.source : null,
    updated_at: man.available ? man.captured_at : null,
    stale: man.available ? man.stale : null,
    calculation: CALC
  };
  if (kind === "status") {
    return json2({
      ...base,
      available: man.available,
      age_seconds: man.available ? man.age_seconds : null,
      open_positions: man.available ? man.account.open_positions : null,
      program_version: man.available ? man.account.program_version : null,
      views: man.available ? man.views : null
    });
  }
  const daily = man.available && man.metrics && man.metrics.daily || [];
  if (!daily.length) return json2({ ...base, available: false, reason: "no trade-record figures in the latest capture", data: null });
  const p = url.searchParams.get("period") || "all";
  const days = period(daily, p);
  if (!days) return json2({ error: "period must be 7d, 30d, 90d or all" }, 400, 0);
  const range = { from: days.length ? days[0].d : null, to: days.length ? days[days.length - 1].d : null, period: p };
  if (kind === "performance") {
    let trades = 0, wins = 0, losses = 0, flat = 0, pnl = 0, funding = 0, worst = null, down = 0;
    for (const d of days) {
      trades += d.trades;
      wins += d.wins;
      losses += d.losses;
      flat += d.flat;
      pnl += d.pnl;
      funding += d.funding;
      if (d.worst != null && (worst == null || d.worst < worst)) worst = d.worst;
      if (d.pnl + d.funding < 0) down++;
    }
    return json2({ ...base, available: true, range, data: {
      closed_trades: trades,
      wins,
      losses,
      flat,
      wins_fraction: `${wins}/${trades}`,
      realized_pnl_usdt: Math.round((pnl + funding) * 100) / 100,
      funding_usdt: Math.round(funding * 100) / 100,
      worst_closed_trade_usdt: worst,
      days: days.length,
      days_with_net_realized_loss: down,
      return_pct: null,
      return_pct_note: "not computed: account balance history is not published",
      max_drawdown: null,
      max_drawdown_note: "not computed: a curve of realized P&L is not an account drawdown",
      open_positions: man.account.open_positions,
      open_positions_note: "excluded from the figures; visible on the positions screenshot"
    } });
  }
  if (kind === "equity-curve") {
    let c = 0;
    const points = days.map((d) => {
      c += d.pnl + d.funding;
      return { date: d.d, cumulative_realized_usdt: Math.round(c * 100) / 100 };
    });
    return json2({ ...base, available: true, range, kind: "cumulative_realized_pnl_by_day", data: points });
  }
  return json2({ ...base, available: true, data: man.metrics.recent_trades || [], note: "latest closed trades only; funding entries and open positions are not listed; times Korea time" });
}
__name(v1, "v1");

// functions/api/board/_shared.js
function json3(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
__name(json3, "json");
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function isAdmin(request, env) {
  const key = request.headers.get("x-admin-key");
  return !!(key && env.BOARD_ADMIN_KEY && key === env.BOARD_ADMIN_KEY);
}
__name(isAdmin, "isAdmin");

// functions/api/board/posts.js
async function onRequestGet({ request, env }) {
  if (!env.BOARD_DB) return json3({ error: "not_configured" }, 500);
  const admin = isAdmin(request, env);
  const { results } = await env.BOARD_DB.prepare(
    "SELECT id, name, is_secret, content, reply, replied_at, created_at FROM posts ORDER BY id DESC LIMIT 200"
  ).all();
  const posts = results.map((p) => ({
    id: p.id,
    name: p.name,
    created_at: p.created_at,
    is_secret: !!p.is_secret,
    content: !p.is_secret || admin ? p.content : null,
    reply: p.reply || null,
    replied_at: p.replied_at || null
  }));
  return json3({ posts });
}
__name(onRequestGet, "onRequestGet");
async function onRequestPost({ request, env }) {
  if (!env.BOARD_DB) return json3({ error: "not_configured" }, 500);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json3({ error: "invalid_request" }, 400);
  }
  const name = String(body.name || "").trim().slice(0, 40);
  const content = String(body.content || "").trim().slice(0, 4e3);
  const secret = !!body.secret;
  const password = String(body.password || "").slice(0, 100);
  if (!name || !content) return json3({ error: "missing_fields" }, 400);
  if (secret && !password) return json3({ error: "missing_password" }, 400);
  let salt = null;
  let passwordHash = null;
  if (secret) {
    salt = crypto.randomUUID().replace(/-/g, "");
    passwordHash = await sha256Hex(salt + password);
  }
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const result = await env.BOARD_DB.prepare(
    "INSERT INTO posts (name, content, is_secret, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(name, content, secret ? 1 : 0, salt, passwordHash, createdAt).run();
  return json3({ ok: true, id: result.meta.last_row_id });
}
__name(onRequestPost, "onRequestPost");

// functions/api/board/posts/[id].js
async function onRequestGet2({ params, request, env }) {
  if (!env.BOARD_DB) return json3({ error: "not_configured" }, 500);
  const id = Number(params.id);
  const post = await env.BOARD_DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  if (!post) return json3({ error: "not_found" }, 404);
  const admin = isAdmin(request, env);
  if (!post.is_secret || admin) {
    return json3(toPublic(post));
  }
  const url = new URL(request.url);
  const password = url.searchParams.get("password") || "";
  if (!password) return json3({ error: "password_required" }, 401);
  const hash = await sha256Hex((post.salt || "") + password);
  if (hash !== post.password_hash) return json3({ error: "wrong_password" }, 403);
  return json3(toPublic(post));
}
__name(onRequestGet2, "onRequestGet");
function toPublic(post) {
  return {
    id: post.id,
    name: post.name,
    content: post.content,
    is_secret: !!post.is_secret,
    created_at: post.created_at,
    reply: post.reply || null,
    replied_at: post.replied_at || null
  };
}
__name(toPublic, "toPublic");

// worker.js
var LANGS = ["ja", "es", "fr", "vi", "tr", "pt"];
function redirect(url, to, status = 301) {
  const target = new URL(to, url.origin);
  for (const [k, v] of url.searchParams) if (k !== "lang" && !target.searchParams.has(k)) target.searchParams.set(k, v);
  return Response.redirect(target.toString(), status);
}
__name(redirect, "redirect");
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const base = { request, env, ctx, params: {} };
    if (url.hostname === "javidtrading.com" && (request.method === "GET" || request.method === "HEAD")) {
      return Response.redirect(`https://www.javidtrading.com${pathname}${url.search}`, 301);
    }
    if (pathname === "/blog-media" || pathname.startsWith("/blog-media/")) {
      return blogMediaResponse(request, env, pathname);
    }
    try {
      if (pathname === "/api/live-capture") {
        if (request.method === "POST") return await upload(base);
        return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
      }
      if (pathname === "/api/live-capture/latest") return await latest(base);
      if (pathname.startsWith("/api/live-capture/img/")) {
        base.params = { path: decodeURIComponent(pathname.slice("/api/live-capture/img/".length)) };
        return await image(base);
      }
      if (pathname.startsWith("/api/v1/")) return await v1(request, env, pathname);
      if (pathname === "/api/board/posts") {
        if (request.method === "GET") return await onRequestGet(base);
        if (request.method === "POST") return await onRequestPost(base);
      }
      const pm = pathname.match(/^\/api\/board\/posts\/(\d+)$/);
      if (pm && request.method === "GET") {
        base.params = { id: pm[1] };
        return await onRequestGet2(base);
      }
      if (pathname.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    const km = pathname.match(/^\/ko(?:\.html)?(?:\/(.*?))?(?:\.html)?$/);
    if (km) return redirect(url, "/" + (km[1] || ""));
    if (pathname === "/install-help" || pathname === "/install-help.html") {
      const l = url.searchParams.get("lang");
      return redirect(url, (LANGS.includes(l) ? `/${l}/download` : "/download") + "#install");
    }
    if (pathname === "/index.html") return redirect(url, "/");
    return env.ASSETS.fetch(request);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
