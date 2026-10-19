// Live dashboard captures for www.javidtrading.com
//
//   POST /api/live-capture            upload (multipart: manifest JSON + images). Header x-capture-key must
//                                     equal the LIVE_CAPTURE_KEY secret (wrangler secret put LIVE_CAPTURE_KEY).
//   GET  /api/live-capture/latest     latest good manifest (+ image URLs, age, stale flag). Short cache.
//   GET  /api/live-capture/img/<key>  one stored image. Keys are unique per capture -> immutable cache.
//
// The uploader is scripts/live_capture_upload.py on the operator's PC (hourly). It captures the
// masked proxy of one real account's dashboard and computes figures from that account's
// /api/records in the same run. Nothing here is generated: if no upload has arrived, the site
// shows "no capture yet"; if uploads stop, the last good capture is served with stale=true.
// A failed or invalid upload never replaces the previous manifest (images first, manifest last).

const LATEST = "manifest/latest.json";
const STALE_AFTER_S = 2 * 3600;
const MAX_IMG = 4 * 1024 * 1024;
const VIEWS = ["dashboard", "positions"];
const IMG_TYPES = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };
const RETAIN_DAYS = 14;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Validate and re-build the manifest from whitelisted fields only (anything else is dropped,
// so a secret accidentally included by the uploader can never be re-published).
export function sanitizeManifest(m, now = Date.now()) {
  const err = (e) => ({ error: e });
  if (!m || typeof m !== "object") return err("manifest_not_object");
  if (m.schema !== 1) return err("schema");
  const t = Date.parse(m.captured_at);
  if (!Number.isFinite(t)) return err("captured_at");
  if (t > now + 10 * 60 * 1000 || t < now - 6 * 3600 * 1000) return err("captured_at_out_of_range");
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
      settings: null,
    },
    views: {},
    metrics: null,
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
        entry_mode: typeof s.entry_mode === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(s.entry_mode) ? s.entry_mode : null,
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
      if (!["LONG", "SHORT"].includes(r.side) || !isNum(r.pnl) || (r.roe != null && !isNum(r.roe))) return err("trade_row");
      recent.push({ t: r.t, s: r.s, side: r.side, pnl: r.pnl, roe: r.roe ?? null });
    }
    out.metrics = {
      scope: "closed trades + funding fees; open positions and shadow trades excluded; dates Korea time (UTC+9)",
      tz: "Asia/Seoul",
      daily,
      recent_trades: recent,
    };
  }
  return out;
}

function dayFolder(iso) { return iso.slice(0, 10); }

async function prune(env, nowIso) {
  // delete one stale day-folder per upload (cheap, bounded work)
  const d = new Date(nowIso); d.setUTCDate(d.getUTCDate() - RETAIN_DAYS);
  const prefix = "captures/" + d.toISOString().slice(0, 10) + "/";
  const list = await env.LIVE_CAPTURES.list({ prefix, limit: 100 });
  if (list.objects.length) await env.LIVE_CAPTURES.delete(list.objects.map((o) => o.key));
}

export async function upload({ request, env, ctx }) {
  if (!env.LIVE_CAPTURES) return json({ error: "not_configured" }, 500);
  const key = request.headers.get("x-capture-key") || "";
  if (!env.LIVE_CAPTURE_KEY || !timingSafeEqual(key, env.LIVE_CAPTURE_KEY)) return json({ error: "forbidden" }, 403);
  let form;
  try { form = await request.formData(); } catch { return json({ error: "expected_multipart" }, 400); }
  let raw;
  try { raw = JSON.parse(String(form.get("manifest") || "")); } catch { return json({ error: "manifest_json" }, 400); }
  const m = sanitizeManifest(raw);
  if (m.error) return json({ error: "invalid_manifest", detail: m.error }, 422);

  const stamp = m.captured_at.replace(/[-:]/g, "").slice(0, 13); // 20261019T0705
  const files = [];
  for (const v of VIEWS) {
    const f = form.get(v);
    if (!f || typeof f === "string") continue;
    const ext = IMG_TYPES[f.type];
    if (!ext) return json({ error: "image_type", view: v }, 415);
    if (f.size > MAX_IMG || f.size < 1000) return json({ error: "image_size", view: v }, 413);
    const w = Number(raw.views && raw.views[v] && raw.views[v].width), h = Number(raw.views && raw.views[v] && raw.views[v].height);
    files.push({ v, f, ext, w: Number.isInteger(w) && w > 0 && w < 5000 ? w : null, h: Number.isInteger(h) && h > 0 && h < 5000 ? h : null });
  }
  if (!files.find((x) => x.v === "dashboard")) return json({ error: "dashboard_image_required" }, 400);

  for (const x of files) {
    const k = `captures/${dayFolder(m.captured_at)}/${stamp}Z-${x.v}.${x.ext}`;
    await env.LIVE_CAPTURES.put(k, await x.f.arrayBuffer(), { httpMetadata: { contentType: x.f.type } });
    m.views[x.v] = { key: k, width: x.w, height: x.h, bytes: x.f.size };
  }
  m.received_at = new Date().toISOString();
  // manifest last: until it is written, readers keep getting the previous good capture
  await env.LIVE_CAPTURES.put(LATEST, JSON.stringify(m), { httpMetadata: { contentType: "application/json" } });
  if (ctx && ctx.waitUntil) ctx.waitUntil(prune(env, m.captured_at).catch(() => {}));
  return json({ ok: true, captured_at: m.captured_at, views: Object.keys(m.views) });
}

export async function readLatest(env) {
  if (!env.LIVE_CAPTURES) return null;
  const o = await env.LIVE_CAPTURES.get(LATEST);
  if (!o) return null;
  try { return JSON.parse(await o.text()); } catch { return null; }
}

export function publicManifest(m, now = Date.now()) {
  if (!m) return { available: false };
  const age = Math.max(0, Math.round((now - Date.parse(m.captured_at)) / 1000));
  const views = {};
  for (const [v, info] of Object.entries(m.views || {})) {
    views[v] = { url: "/api/live-capture/img/" + info.key.replace(/^captures\//, ""), width: info.width, height: info.height };
  }
  return { available: true, captured_at: m.captured_at, age_seconds: age, stale: age > STALE_AFTER_S, source: m.source, account: m.account, views, metrics: m.metrics };
}

export async function latest({ env }) {
  const m = await readLatest(env);
  return json(publicManifest(m), 200, { "Cache-Control": "public, max-age=60" });
}

export async function image({ env, params }) {
  if (!env.LIVE_CAPTURES) return new Response("not configured", { status: 500 });
  const rel = params.path || "";
  if (!/^\d{4}-\d{2}-\d{2}\/\d{8}T\d{4}Z-(dashboard|positions)\.(webp|png|jpg)$/.test(rel)) return new Response("not found", { status: 404 });
  const o = await env.LIVE_CAPTURES.get("captures/" + rel);
  if (!o) return new Response("not found", { status: 404 });
  return new Response(o.body, {
    headers: {
      "Content-Type": (o.httpMetadata && o.httpMetadata.contentType) || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
