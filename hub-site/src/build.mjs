// Static site generator for www.javidtrading.com.
//   node src/build.mjs            -> writes ./public (the Workers assets directory)
// Inputs: src/i18n/<lang>.json, src/config/*.json, src/install-help/*.json,
//         src/data/backtest/published.json, src/assets/**, src/static/**, src/api-guides/*.html
// Every language page is rendered from the same template, so the static HTML,
// the JSON-LD and the strings the browser script uses always come from one
// dictionary (the "three layers" can no longer drift apart).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "public");
const ORIGIN = "https://www.javidtrading.com";
export const LANGS = ["en", "ko", "ja", "es", "fr", "vi", "tr", "pt"];
const TELEGRAM = "https://t.me/+P_CukTNNKRI4ZDVl";
const YT_LIVE = "https://www.youtube.com/@javidfuture/live";
const EMAIL = "support@javidtrading.com";
const FONT_CSS = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
const LASTMOD = "2026-10-19";

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const EX = readJSON(path.join(SRC, "config/exchanges.json"));
const CT = readJSON(path.join(SRC, "config/copy_trading.json"));
const BT = readJSON(path.join(SRC, "data/backtest/published.json"));
const IH = {};
for (const n of ["bitget", "binance", "bybit"]) IH[n] = readJSON(path.join(SRC, "install-help", n + ".json"));

const DICT = {};
const BUILT_LANGS = LANGS.filter((l) => fs.existsSync(path.join(SRC, "i18n", l + ".json")));
for (const l of BUILT_LANGS) DICT[l] = readJSON(path.join(SRC, "i18n", l + ".json"));
const EN = DICT.en;

// ── validation (build fails instead of shipping a broken page) ────────────
const errors = [];
for (const l of BUILT_LANGS) {
  for (const k of Object.keys(EN)) if (!(k in DICT[l])) errors.push(`i18n ${l}: missing key ${k}`);
  for (const k of Object.keys(DICT[l])) if (!(k in EN)) errors.push(`i18n ${l}: extra key ${k}`);
}
for (const [id, p] of Object.entries(CT.profiles)) {
  if (!["coming_soon", "live"].includes(p.status)) errors.push(`copy_trading ${id}: bad status ${p.status}`);
  if (p.status === "live") {
    let u; try { u = new URL(p.profile_url); } catch { errors.push(`copy_trading ${id}: profile_url is not a URL`); continue; }
    const okDom = (CT.allowed_domains[id] || []).some((d) => u.hostname === d || u.hostname.endsWith("." + d));
    if (u.protocol !== "https:" || !okDom) errors.push(`copy_trading ${id}: profile_url must be https on ${CT.allowed_domains[id]}`);
  } else if (p.profile_url) errors.push(`copy_trading ${id}: profile_url set but status is not live`);
}
for (const [id, e] of Object.entries(EX.exchanges)) {
  if (e.status === "available") {
    for (const os of ["windows", "mac"]) {
      const d = e.downloads[os];
      if (!d || !/^https:\/\/(bg|bn|bb|okx)\.javidtrading\.com\/api\/download\?platform=(windows|mac)$/.test(d.url)) errors.push(`exchange ${id}: bad ${os} download url`);
      if (!d || !/^[0-9a-f]{64}$/.test(d.sha256 || "")) errors.push(`exchange ${id}: bad ${os} sha256`);
    }
  } else if (Object.keys(e.downloads || {}).length) errors.push(`exchange ${id}: not available but has downloads`);
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

// ── helpers ───────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const strip = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const fill = (s, vars = {}) => Object.entries(vars).reduce((a, [k, v]) => a.split("{" + k + "}").join(v), s);
function T(lang) {
  const d = DICT[lang];
  const f = (k, vars) => { if (!(k in d)) throw new Error(`missing ${lang}.${k}`); return fill(d[k], vars); };
  f.txt = (k, vars) => esc(strip(f(k, vars)));
  return f;
}
const PAGES = {
  home: "", "how-it-works": "how-it-works", exchange: "exchange", download: "download", guide: "guide",
  "copy-trading": "copy-trading", "risk-disclosure": "risk-disclosure", faq: "faq", board: "board",
  contact: "contact", privacy: "privacy", terms: "terms",
};
function href(lang, page) {
  const slug = PAGES[page];
  if (lang === "en") return slug ? "/" + slug : "/";
  return slug ? `/${lang}/${slug}` : `/${lang}`;
}
function outFile(lang, page) {
  const slug = PAGES[page];
  if (lang === "en") return slug ? slug + ".html" : "index.html";
  return slug ? `${lang}/${slug}.html` : `${lang}.html`;
}
function fmtBytes(n, lang) {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(n / 1048576) + " MB";
}
function fmtDate(iso, lang) {
  return new Intl.DateTimeFormat(lang, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
}
function hashFile(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 10); }
function writeOut(rel, content) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, ent.name), b = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(a, b);
    else { fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(a, b); }
  }
}

// ── icons (inline SVG, stroke icons) ──────────────────────────────────────
const P = {
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  windows: '<path d="M3 5.5 10.5 4.5v7H3zM12 4.3 21 3v8.5h-9zM3 12.5h7.5v7L3 18.5zM12 12.5h9V21l-9-1.3z" fill="currentColor" stroke="none"/>',
  apple: '<path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.8ZM14.1 5.8c.6-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4Z" fill="currentColor" stroke="none"/>',
};
const ico = (n, cls = "") => `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;

// ── shared chrome ─────────────────────────────────────────────────────────
let CSS_V = "", JS_V = "";
const JS_KEYS = ["nav_menu", "nav_close", "perf_captured", "perf_stale", "perf_none", "perf_error", "view_dashboard", "view_positions", "perf_zoom",
  "hero_shot_alt", "m_trades", "m_wins", "m_wins_val", "m_realized", "m_worst", "m_down", "m_down_val", "m_funding", "m_period", "m_unavailable",
  "chart_aria", "time_now", "ago_min", "ago_h", "ago_d", "bd_secret_label", "bd_password", "bd_open", "bd_reply", "bd_empty", "bd_loading",
  "bd_error", "bd_posted", "bd_post_error", "bd_wrong_pw", "m_settings", "m_open", "hs_on", "hs_off"];

const CAPTURE_SRC = `(function(){try{if(sessionStorage.getItem("jfb_src"))return;var q=new URLSearchParams(location.search),r="";try{r=document.referrer?new URL(document.referrer).hostname:""}catch(e){}if(/(^|\\.)javidtrading\\.com$/.test(r))r="";sessionStorage.setItem("jfb_src",JSON.stringify({r:r,us:q.get("utm_source")||"",um:q.get("utm_medium")||"",uc:q.get("utm_campaign")||"",lp:location.pathname}))}catch(e){}})();`;

function jsonld(obj) { return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`; }

function head(lang, page, { title, desc, ld = [], noindex = false }) {
  const t = T(lang);
  const canon = ORIGIN + href(lang, page);
  const alts = BUILT_LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN + href(l, page)}">`).join("\n") +
    `\n<link rel="alternate" hreflang="x-default" href="${ORIGIN + href("en", page)}">`;
  const strings = {}; for (const k of JS_KEYS) strings[k] = DICT[lang][k];
  return `<!doctype html>
<html lang="${t("_html_lang")}">
<head>
<meta charset="utf-8">
<script>${CAPTURE_SRC}</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canon}">
${noindex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="index,follow,max-image-preview:large">'}
${alts}
<meta property="og:type" content="website">
<meta property="og:site_name" content="JaviD Future Bot">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canon}">
<meta property="og:image" content="${ORIGIN}/assets/img/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${t("_og_locale")}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#065f46">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="${FONT_CSS}" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css?v=${CSS_V}">
<script>window.JFB=${JSON.stringify({ lang, t: strings }).replace(/</g, "\\u003c")};</script>
${ld.map(jsonld).join("\n")}
</head>`;
}

function header(lang, active) {
  const t = T(lang);
  const items = [["how-it-works", "nav_product"], ["exchange", "nav_performance"], ["guide", "nav_guide"], ["risk-disclosure", "nav_risk"]];
  const nav = items.map(([p, k]) => `<a href="${href(lang, p)}"${active === p ? ' aria-current="page"' : ""}>${t.txt(k)}</a>`).join("");
  const opts = BUILT_LANGS.map((l) => `<option value="${l}" data-href="${href(l, active)}"${l === lang ? " selected" : ""}>${esc(DICT[l]._lang_name)}</option>`).join("");
  return `<body>
<a class="skip" href="#main">${t.txt("skip")}</a>
<header class="site-header">
  <div class="wrap hdr">
    <a class="brand" href="${href(lang, "home")}"><img src="/assets/img/logo-96.png" alt="" width="30" height="30"><span class="brand-name">JaviD Future Bot</span></a>
    <nav class="nav" aria-label="Main">${nav}</nav>
    <div class="hdr-tools">
      <label class="lang"><span class="sr-only">${t.txt("lang_label")}</span><select data-lang-switch aria-label="${t.txt("lang_label")}">${opts}</select></label>
      <a class="btn btn-primary btn-sm hdr-cta" href="${href(lang, "download")}">${ico("download")}${t.txt("nav_download")}</a>
      <button class="menu-btn" type="button" aria-controls="mnav" aria-expanded="false" aria-label="${t.txt("nav_menu")}">${ico("menu")}</button>
    </div>
  </div>
  <nav id="mnav" class="mnav" aria-label="Mobile">${nav}<a href="${href(lang, "download")}"${active === "download" ? ' aria-current="page"' : ""}>${t.txt("nav_download")}</a></nav>
</header>
<main id="main">`;
}

function footer(lang) {
  const t = T(lang);
  const li = (h, k, ext) => `<li><a href="${h}"${ext ? ' target="_blank" rel="noopener"' : ""}>${t.txt(k)}</a></li>`;
  return `</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="ft-grid">
      <div class="ft-about">
        <a class="brand" href="${href(lang, "home")}"><img src="/assets/img/logo-96.png" alt="" width="28" height="28" loading="lazy">JaviD Future Bot</a>
        <p>${t("foot_about")}</p>
      </div>
      <div><h3>${t.txt("foot_product")}</h3><ul>
        ${li(href(lang, "how-it-works"), "nav_product")}${li(href(lang, "exchange"), "nav_performance")}${li(href(lang, "download"), "nav_download")}${li(href(lang, "guide"), "nav_guide")}${li(href(lang, "copy-trading"), "foot_copy")}
      </ul></div>
      <div><h3>${t.txt("foot_support")}</h3><ul>
        ${li(href(lang, "faq"), "foot_faq")}${li(href(lang, "board"), "foot_board")}${li(href(lang, "contact"), "foot_contact")}${li(TELEGRAM, "foot_telegram", true)}${li("/api-guide/bitget", "foot_api_guides")}
      </ul></div>
      <div><h3>${t.txt("foot_legal")}</h3><ul>
        ${li(href(lang, "risk-disclosure"), "nav_risk")}${li(href(lang, "privacy"), "foot_privacy")}${li(href(lang, "terms"), "foot_terms")}
      </ul></div>
    </div>
    <div class="ft-risk">
      <p><b>${t.txt("risk_line")}</b> ${t("foot_tm")}</p>
      <p>${t.txt("foot_rights")}</p>
    </div>
  </div>
</footer>
<script src="/assets/js/site.js?v=${JS_V}" defer></script>
</body>
</html>
`;
}

const badge = (cls, text) => `<span class="badge ${cls}">${text}</span>`;
function exStatusBadges(t, e) {
  const prof = CT.profiles[e.copy_trading_key] || {};
  return [
    e.status === "available" ? badge("b-ok", t.txt("st_available")) : badge("b-wait", t.txt("st_preparing")),
    e.live_data ? badge("b-live", t.txt("live_yes")) : badge("b-off", t.txt("live_no")),
    prof.status === "live" && prof.profile_url
      ? `<span class="copy-row">${badge("b-ok", t.txt("copy_live"))}<a class="ct-join" href="${esc(prof.profile_url)}" target="_blank" rel="noopener nofollow sponsored" title="${t.txt("ct_invite_note")}" aria-label="${t.txt("ct_live_btn", { name: e.name })}">${t.txt("ct_join")} ↗</a></span>`
      : badge("b-off", t.txt("copy_soon")),
  ].join("");
}

// The live block. mode "hero": one screenshot. mode "full": views, metrics, chart (+ trades on /exchange).
function liveBlock(lang, mode, { trades = false } = {}) {
  const t = T(lang);
  if (mode === "hero") {
    return `<div class="hero-shot" data-live>
      <div class="frame" data-shot="dashboard"><div class="ph">${t.txt("perf_loading")}</div></div>
      <noscript><p class="small muted mt-8">${t.txt("perf_nojs")}</p></noscript>
      <div class="cap"><span>${t.txt("hero_shot_label")} · ${t.txt("perf_exchange")}</span><span data-live-status></span></div>
    </div>`;
  }
  const periods = ["7", "30", "90", "all"].map((p) => `<button type="button" data-period="${p}" aria-pressed="${p === "all"}">${t.txt("p_" + p)}</button>`).join("");
  return `<div data-live>
    <div class="grid g2 mt-16">
      <figure style="margin:0"><figcaption class="small" style="font-weight:700;margin-bottom:6px">${t.txt("view_dashboard")}</figcaption><div class="shot" data-shot="dashboard"><div class="ph">${t.txt("perf_loading")}</div></div></figure>
      <figure style="margin:0"><figcaption class="small" style="font-weight:700;margin-bottom:6px">${t.txt("view_positions")}</figcaption><div class="shot" data-shot="positions"><div class="ph">${t.txt("perf_loading")}</div></div></figure>
    </div>
    <noscript><p class="small muted mt-8">${t.txt("perf_nojs")}</p></noscript>
    <div class="shot-meta"><span data-live-status></span><a href="${YT_LIVE}" target="_blank" rel="noopener" class="ext">${t.txt("perf_stream")}</a></div>
    <p class="stale" data-live-stale hidden></p>
    <p class="tiny muted mt-8">${t.txt("perf_title_note")}</p>
    <div data-metrics-wrap hidden>
      <div class="chart-top mt-24"><h3>${t.txt("m_h3")}</h3><div class="seg" role="group" aria-label="${t.txt("m_period_label")}">${periods}</div></div>
      <p class="small muted" data-period-label></p>
      <div class="metrics" data-metrics></div>
      <div class="scope"><p data-open-count hidden></p><p>${t("m_scope")}</p><p>${t("m_trades_note")} ${t("m_zero_policy")}</p><p data-settings hidden></p></div>
      <div class="card card-pad chart-card">
        <h3>${t.txt("chart_h3")}</h3>
        <div class="chart" data-chart></div>
        <p class="chart-note">${t("chart_note")}</p>
      </div>
      ${trades ? `<div class="card card-pad mt-16" data-trades-wrap hidden><h3>${t.txt("trades_h3")}</h3>
        <div class="tbl-wrap mt-8"><table class="tbl"><thead><tr>${t("trades_cols").split("|").map((c, i) => `<th${i >= 3 ? ' style="text-align:right"' : ""}>${esc(c)}</th>`).join("")}</tr></thead><tbody data-trades></tbody></table></div>
        <p class="tiny muted mt-8">${t.txt("trades_note")}</p></div>` : ""}
    </div>
  </div>`;
}

// ── pages ─────────────────────────────────────────────────────────────────
function pageHome(lang) {
  const t = T(lang);
  const cards = EX.order.map((id) => {
    const e = EX.exchanges[id];
    const target = href(lang, "download") + "?exchange=" + id;
    // The card is a container, not one big <a>: it holds a second link (copy-trading Join), and
    // nested anchors are invalid HTML. The whole card stays clickable through .go's ::after overlay.
    return `<div class="card ex-card" data-ex-card="${id}">
      <div class="logo"><img src="${e.logo}" alt="${esc(e.name)}" width="104" height="42" loading="lazy"></div>
      <div class="name">${esc(e.name)}</div>
      <div class="meta">${exStatusBadges(t, e)}</div>
      <div class="note">${t.txt(e.notes_key)}</div>
      <a class="go" href="${target}">${e.status === "available" ? t.txt("ex_cta", { name: e.name }) : t.txt("ex_cta_prep")} ${ico("arrow")}</a>
    </div>`;
  }).join("");
  const feats = [["monitor", "f1", "badge_available"], ["eye", "f2", "badge_available"], ["layers", "f3", "badge_available"], ["shield", "f4", "badge_available"],
    ["filter", "f5", "badge_available"], ["alert", "f6", "badge_available"], ["cpu", "f7", "badge_dev"], ["phone", "f8", "badge_hold"]];
  const featHtml = feats.map(([ic, k, b]) => `<div class="card feat${b !== "badge_available" ? " dim" : ""}"><div class="ico">${ico(ic)}</div><div>
      <h3>${t.txt(k + "_t")} ${badge(b === "badge_available" ? "b-ok" : b === "badge_dev" ? "b-wait" : "b-off", t.txt(b))}</h3><p>${t(k + "_d")}</p></div></div>`).join("");
  const li = (k) => `<li>${ico("check")}<span>${t(k)}</span></li>`;
  const ld = [
    { "@context": "https://schema.org", "@type": "Organization", "@id": ORIGIN + "/#org", name: "JaviD Future Bot", url: ORIGIN + "/", logo: ORIGIN + "/assets/img/logo-96.png", email: EMAIL, sameAs: [TELEGRAM, "https://www.youtube.com/@javidfuture"] },
    { "@context": "https://schema.org", "@type": "WebSite", "@id": ORIGIN + "/#website", name: "JaviD Future Bot", url: ORIGIN + "/", inLanguage: BUILT_LANGS },
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "JaviD Future Bot", applicationCategory: "FinanceApplication", operatingSystem: "Windows, macOS",
      softwareVersion: "19.7", description: strip(t("home_desc")), url: ORIGIN + href(lang, "home"), downloadUrl: ORIGIN + href(lang, "download"),
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, publisher: { "@id": ORIGIN + "/#org" } },
  ];
  return head(lang, "home", { title: t("home_title"), desc: strip(t("home_desc")), ld }) + header(lang, "home") + `
<section class="hero"><div class="wrap hero-grid">
  <div>
    <span class="kicker">${t.txt("hero_kicker")}</span>
    <h1>${t("hero_h1")}</h1>
    <p class="sub">${t("hero_sub")}</p>
    <div class="ctas">
      <a class="btn btn-primary" href="${href(lang, "download")}">${ico("download")}${t.txt("hero_cta1")}</a>
      <a class="btn btn-outline" href="#live">${ico("chart")}${t.txt("hero_cta2")}</a>
    </div>
    <div class="chips"><span class="chip">${ico("check")}${t.txt("hero_chip1")}</span><span class="chip">${ico("lock")}${t.txt("hero_chip2")}</span><span class="chip">${ico("eye")}${t.txt("hero_chip3")}</span></div>
    <p class="risk">${t.txt("risk_line")}</p>
  </div>
  ${liveBlock(lang, "hero")}
</div></section>

<section class="section" id="exchanges"><div class="wrap">
  <div class="section-head"><div><h2>${t.txt("ex_h2")}</h2><p>${t.txt("ex_sub")}</p></div></div>
  <div class="grid g4">${cards}</div>
</div></section>

<section class="section-tight" id="live"><div class="wrap"><div class="card card-pad">
  <div class="perf-head"><h2>${t.txt("perf_h2")} (${t.txt("perf_exchange")})</h2>${badge("b-live", t.txt("perf_badge"))}</div>
  <p class="perf-what">${t("perf_what")}</p>
  ${liveBlock(lang, "full")}
  <p class="mt-16"><a href="${href(lang, "exchange")}">${t.txt("perf_more")} →</a></p>
</div></div></section>

<section class="section" id="features"><div class="wrap">
  <div class="section-head"><h2>${t.txt("feat_h2")}</h2></div>
  <div class="grid g2">${featHtml}</div>
</div></section>

<section class="section-tight" id="ways"><div class="wrap">
  <div class="section-head"><h2>${t.txt("ways_h2")}</h2></div>
  <div class="grid g2">
    <div class="card way"><h3>${ico("monitor")}${t.txt("w1_t")}</h3><ul>${li("w1_l1")}${li("w1_l2")}${li("w1_l3")}${li("w1_l4")}</ul>
      <div class="acts"><a class="btn btn-primary" href="${href(lang, "download")}">${ico("download")}${t.txt("w1_cta")}</a><a class="btn btn-ghost" href="${href(lang, "guide")}">${t.txt("w1_cta2")}</a></div></div>
    <div class="card way"><h3>${ico("users")}${t.txt("w2_t")}</h3><ul>${li("w2_l1")}${li("w2_l2")}${li("w2_l3")}</ul>
      <p class="state">${t("w2_state")}</p>
      <div class="acts"><a class="btn btn-outline" href="${href(lang, "copy-trading")}">${t.txt("w2_cta")}</a></div></div>
  </div>
</div></section>

<section class="section-tight"><div class="wrap">
  <div class="riskbox"><h2>${ico("alert")}${t.txt("riskbox_h2")}</h2><p>${t("riskbox_p")}</p><p><a href="${href(lang, "risk-disclosure")}">${t.txt("riskbox_cta")} →</a></p></div>
</div></section>

<section class="section"><div class="wrap"><div class="final">
  <div><h2>${t.txt("final_h2")}</h2><p>${t("final_p")}</p></div>
  <div class="acts"><a class="btn btn-primary" href="${href(lang, "download")}">${ico("download")}${t.txt("hero_cta1")}</a><a class="btn btn-ghost" href="${href(lang, "guide")}">${t.txt("nav_guide")}</a></div>
</div></div></section>
` + footer(lang);
}

function crumbs(lang, page, nameKey) {
  const t = T(lang);
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "JaviD Future Bot", item: ORIGIN + href(lang, "home") },
    { "@type": "ListItem", position: 2, name: strip(t(nameKey)), item: ORIGIN + href(lang, page) }] };
}
function simple(lang, page, titleKey, descKey, nameKey, body, extraLd = []) {
  const t = T(lang);
  return head(lang, page, { title: t(titleKey), desc: strip(t(descKey)), ld: [crumbs(lang, page, nameKey), ...extraLd] }) + header(lang, page) + body + footer(lang);
}
function prose(t, keys) { return keys.map(([h, p]) => `<h2>${t.txt(h)}</h2><p>${t(p)}</p>`).join(""); }

function pageHow(lang) {
  const t = T(lang);
  const body = `<div class="wrap page-head"><h1>${t.txt("hiw_h1")}</h1><p>${t("hiw_lead")}</p></div>
<section class="section-tight"><div class="wrap"><div class="card card-pad prose">
  ${prose(t, [["hiw_s1_h", "hiw_s1_p"], ["hiw_s2_h", "hiw_s2_p"]])}
  <h2>${t.txt("hiw_s3_h")}</h2><p>${t("hiw_s3_p1")}</p><p>${t("hiw_s3_p2")}</p>
  <ul><li>${t("hiw_s3_l1")}</li><li>${t("hiw_s3_l2")}</li><li>${t("hiw_s3_l3")}</li><li>${t("hiw_s3_l4")}</li></ul><p>${t("hiw_s3_p3")}</p>
  ${prose(t, [["hiw_s4_h", "hiw_s4_p"]])}
  <h2>${t.txt("hiw_s5_h")}</h2><ul><li>${t("hiw_s5_l1")}</li><li>${t("hiw_s5_l2")}</li><li>${t("hiw_s5_l3")}</li><li>${t("hiw_s5_l4")}</li></ul>
  ${prose(t, [["hiw_s6_h", "hiw_s6_p"]])}
  <div class="riskbox mt-24"><p><b>${t.txt("risk_line")}</b></p></div>
</div></div></section>`;
  return simple(lang, "how-it-works", "hiw_title", "hiw_desc", "nav_product", body);
}

function pageExchange(lang) {
  const t = T(lang);
  const tabs = EX.order.map((id) => {
    const e = EX.exchanges[id];
    return `<button class="ex-tab" role="tab" type="button" id="tab-${id}" data-ex="${id}" aria-controls="panel-${id}" aria-selected="false"><img src="${e.logo}" alt="" width="64" height="26">${esc(e.name)}</button>`;
  }).join("");
  const panels = EX.order.map((id) => {
    const e = EX.exchanges[id];
    const inner = e.live_data
      ? `<div class="card card-pad"><div class="perf-head"><h2>${t.txt("perf_h2")} (${esc(e.name)})</h2>${badge("b-live", t.txt("perf_badge"))}</div>
          <p class="perf-what">${t("perf_what")}</p>${liveBlock(lang, "full", { trades: true })}
          <div class="note-box mt-24"><h3>${ico("info")}${t.txt("src_h3")}</h3><p>${t("src_p")}</p></div></div>`
      : `<div class="empty"><b>${t.txt("exp_nodata_h", { name: e.name })}</b><p>${t.txt("exp_nodata_p", { name: e.name })}</p>
          <p class="mt-16"><a class="btn btn-outline btn-sm" href="${href(lang, "download")}?exchange=${id}">${t.txt(e.status === "available" ? "exp_nodata_cta" : "ex_cta_prep", { name: e.name })}</a></p></div>`;
    return `<div class="panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" data-panel="${id}">${inner}</div>`;
  }).join("");
  const bt = BT.published
    ? `<div class="card card-pad"><h3>${t.txt("bt_published")}</h3><p class="small muted">${esc(BT.published.summary || "")}</p></div>`
    : `<div class="empty"><b>${t.txt("bt_empty")}</b><p>${t("bt_why")}</p></div>`;
  const rules = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<li>${t("bt_r" + i)}</li>`).join("");
  const body = `<div class="wrap page-head"><h1>${t.txt("exp_h1")}</h1><p>${t("exp_lead")}</p></div>
<section class="section-tight" data-tabroot><div class="wrap">
  <div class="ex-tabs" role="tablist" aria-label="${t.txt("exp_tab_label")}" data-tabs data-default="binance">${tabs}</div>
  <div class="mt-16">${panels}</div>
</div></section>
<section class="section-tight" id="backtest"><div class="wrap">
  <div class="section-head"><h2>${t.txt("bt_h2")}</h2></div>
  ${bt}
  <div class="card card-pad mt-16"><h3>${t.txt("bt_rules_h3")}</h3><ol class="rules mt-8">${rules}</ol></div>
</div></section>
<section class="section-tight"><div class="wrap"><div class="riskbox"><p>${t("riskbox_p")}</p><p><a href="${href(lang, "risk-disclosure")}">${t.txt("riskbox_cta")} →</a></p></div></div></section>`;
  return simple(lang, "exchange", "exp_title", "exp_desc", "nav_performance", body);
}

function installSection(lang) {
  const t = T(lang);
  const d = IH.bitget[lang] || IH.bitget.en;
  const x = (k) => esc(d[k]).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  return `<section class="section-tight" id="install"><div class="wrap">
  <div class="section-head"><h2>${t.txt("dl_install_h2")}</h2></div>
  <div class="card card-pad prose">
    <p>${x("whyB")}</p>
    <h3>${x("winT")}</h3>
    <div class="install-grid">
      <div><p class="small"><b>${x("winStep1")}</b></p><div class="mock"><div class="t">${x("ssTitle")}</div><div>${x("ssBody")}</div><div class="bts"><span class="bt on">${x("ssMore")}</span><span class="bt">${x("ssDont")}</span></div></div><p class="small mt-8">${x("winHint")}</p></div>
      <div><p class="small"><b>${x("winStep2")}</b></p><div class="mock"><div class="t">${x("ssTitle")}</div><div class="small">${x("ssPub")}</div><div class="bts"><span class="bt on">${x("ssRun")}</span><span class="bt">${x("ssDont")}</span></div></div><p class="small mt-8">${x("winDone")}</p></div>
    </div>
    <h3>${x("macT")}</h3>
    <p>${x("macZip")}</p>
    <div class="install-grid">
      <div><p class="small"><b>macOS 15+</b></p><div class="mock"><div class="t">${x("gk15T")}</div><div>${x("gk15B")}</div><div class="bts"><span class="bt">${x("gkTrash")}</span><span class="bt on">${x("gkOk")}</span></div></div><p class="small mt-8">${x("mac15")}</p></div>
      <div><p class="small"><b>macOS 14</b></p><div class="mock"><div class="t">${x("gk14T")}</div><div>${x("gk14B")}</div><div class="bts"><span class="bt">${x("gkCancel")}</span><span class="bt on">${x("gkOpen")}</span></div></div><p class="small mt-8">${x("mac14")}</p></div>
    </div>
    <p class="small muted">${x("macVary")}</p>
  </div>
</div></section>`;
}

function pageDownload(lang) {
  const t = T(lang);
  const tabs = EX.order.map((id) => {
    const e = EX.exchanges[id];
    return `<a class="ex-tab" role="tab" href="?exchange=${id}" id="tab-${id}" data-ex="${id}" aria-controls="panel-${id}" aria-selected="false"><img src="${e.logo}" alt="" width="64" height="26"><span>${esc(e.name)}</span><span class="st">${e.status === "available" ? badge("b-ok", t.txt("badge_available")) : badge("b-wait", t.txt("st_preparing"))}</span></a>`;
  }).join("");
  const panels = EX.order.map((id) => {
    const e = EX.exchanges[id];
    const apiBox = `<div class="note-box"><h3>${ico("lock")}${t.txt("dl_api_h")}</h3><p>${t("dl_api_p")}</p>${e.passphrase ? `<p>${t("dl_api_pass", { name: esc(e.name) })}</p>` : ""}
      <p class="mt-8"><a href="${e.api_guide_path}">${t.txt("dl_api_guide", { name: e.name })} →</a></p>
      <p class="mt-8"><a href="${e.signup_url}" target="_blank" rel="noopener" class="ext">${t.txt("dl_signup", { name: e.name })}</a><br><span class="tiny">${t.txt("dl_signup_note")}</span></p></div>`;
    if (e.status !== "available") {
      return `<div class="panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" data-panel="${id}"><div class="dl-box">
        <div class="empty"><b>${t.txt("dl_prep_h", { name: e.name })}</b><p>${t.txt("dl_prep_p", { name: e.name })}</p></div>${apiBox}</div></div>`;
    }
    const w = e.downloads.windows, m = e.downloads.mac;
    const ih = IH[e.install_help][lang] || IH[e.install_help].en;
    return `<div class="panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" data-panel="${id}"><div class="dl-box">
      <div class="card card-pad">
        <h2>${esc(e.name)} · ${esc(e.version)}</h2>
        <p class="small muted mt-8">${t.txt("dl_free")}</p>
        <div class="dl-btns mt-16">
          <a class="btn btn-primary" data-dl href="${w.url}" rel="nofollow">${ico("windows")}${t.txt("dl_win")}</a>
          <a class="btn btn-primary" data-dl href="${m.url}" rel="nofollow">${ico("apple")}${t.txt("dl_mac")}</a>
        </div>
        <dl class="kv mt-16">
          <dt>${t.txt("dl_ver")}</dt><dd>${esc(e.version)}</dd>
          <dt>${t.txt("dl_date")}</dt><dd><time datetime="${e.release_date}">${esc(fmtDate(e.release_date, lang))}</time></dd>
          <dt>${t.txt("dl_os")}</dt><dd>Windows 10/11 · macOS</dd>
          <dt>Windows</dt><dd>${esc(w.file)} · ${fmtBytes(w.bytes, lang)}</dd>
          <dt>macOS</dt><dd>${esc(m.file)} · ${fmtBytes(m.bytes, lang)}</dd>
        </dl>
        <p class="tiny muted mt-16">${t.txt("dl_android")}</p>
        <h3 class="mt-24" id="verify-${id}">${t.txt("dl_verify_h3")}</h3>
        <p class="small mt-8">${esc(ih.hashB)}</p>
        <p class="hash mt-8">${esc(w.file)}<br>${w.sha256}</p>
        <p class="hash mt-8">${esc(m.file)}<br>${m.sha256}</p>
        <p class="tiny muted mt-8">${esc(ih.hashDate)}</p>
        <p class="small mt-16">${esc(ih.ver2)}</p>
      </div>
      ${apiBox}
    </div></div>`;
  }).join("");
  const faqKeys = [1, 2, 3, 4, 5, 6];
  const body = `<div class="wrap page-head"><h1>${t.txt("dl_h1")}</h1><p>${t("dl_lead")}</p></div>
<section class="section-tight"><div class="wrap">
  <div class="steps">
    <div class="card step"><span class="n">1</span><div><b>${t.txt("dl_s1_t")}</b><span>${t.txt("dl_s1_d")}</span></div></div>
    <div class="card step"><span class="n">2</span><div><b>${t.txt("dl_s2_t")}</b><span>${t.txt("dl_s2_d")}</span></div></div>
    <div class="card step"><span class="n">3</span><div><b>${t.txt("dl_s3_t")}</b><span>${t.txt("dl_s3_d")}</span></div></div>
  </div>
</div></section>
<section class="section-tight" id="get" data-tabroot><div class="wrap">
  <h2 class="sr-only">${t.txt("dl_pick")}</h2>
  <p class="small muted" style="margin-bottom:10px">${t.txt("dl_pick")}</p>
  <div class="ex-tabs" role="tablist" aria-label="${t.txt("dl_pick")}" data-tabs data-default="${EX.default}">${tabs}</div>
  <div class="mt-16">${panels}</div>
  <div class="riskbox mt-16"><p><b>${t.txt("risk_line")}</b> ${t("rk_2_p")}</p></div>
</div></section>
${installSection(lang)}
<section class="section-tight" id="changes"><div class="wrap"><div class="card card-pad">
  <h2>${t.txt("dl_changes_h2")}</h2>
  <ul class="list-check mt-16">${[1, 2, 3, 4, 5].map((i) => `<li>${t("dl_c" + i)}</li>`).join("")}</ul>
</div></div></section>
<section class="section-tight" id="faq"><div class="wrap"><div class="card card-pad">
  <h2>${t.txt("dl_faq_h2")}</h2>
  <div class="mt-8">${faqKeys.map((i) => `<details class="faq"><summary>${t.txt("q" + i)}</summary><div class="ans">${t("a" + i)}</div></details>`).join("")}</div>
  <p class="mt-16"><a href="${href(lang, "faq")}">${t.txt("foot_faq")} →</a></p>
</div></div></section>`;
  return simple(lang, "download", "dl_title", "dl_desc", "nav_download", body);
}

const GUIDE_SHOTS = [null, "01-api-keys", "02-investment-amount", "03-entry-mode", "04-leverage", "05-symbols-select-all", "06-symbols-save-all", "07-start-trading"];
let SHOT_SIZES = {};
function pageGuide(lang) {
  const t = T(lang);
  const steps = GUIDE_SHOTS.map((shot, i) => {
    const title = t.txt("g_s" + i + "_t");
    const fig = shot && SHOT_SIZES[shot]
      ? `<figure><a href="/assets/guide/${shot}.png" target="_blank" rel="noopener"><img src="/assets/guide/${shot}.webp" alt="${t.txt("g_shot_alt", { step: strip(t("g_s" + i + "_t")) })}" width="${SHOT_SIZES[shot][0]}" height="${SHOT_SIZES[shot][1]}" loading="${i < 2 ? "eager" : "lazy"}" decoding="async"></a></figure>`
      : "";
    return `<div class="card gstep" id="step-${i}"><div><h2><span class="num">${i + 1}</span>${title}</h2><p>${t("g_s" + i + "_p")}</p></div>${fig}</div>`;
  }).join("");
  const howTo = { "@context": "https://schema.org", "@type": "HowTo", name: strip(t("g_h1")) + " — JaviD Future Bot", description: strip(t("g_desc")),
    step: GUIDE_SHOTS.map((shot, i) => ({ "@type": "HowToStep", position: i + 1, name: strip(t("g_s" + i + "_t")), text: strip(t("g_s" + i + "_p")),
      ...(shot ? { image: ORIGIN + "/assets/guide/" + shot + ".png" } : {}) })) };
  const body = `<div class="wrap page-head"><h1>${t.txt("g_h1")}</h1><p>${t("g_lead")}</p></div>
<section class="section-tight"><div class="wrap stack">
  <div class="note-box"><h3>${ico("eye")}${t.txt("g_tip_h")}</h3><p>${t("g_tip_p")}</p></div>
  ${steps}
  <div class="card card-pad"><h2>${t.txt("g_diff_h")}</h2><ul class="list-check mt-16">
    <li>${t("g_diff_bitget")}</li><li>${t("g_diff_binance")}</li><li>${t("g_diff_bybit")}</li><li>${t("g_diff_okx")}</li><li>${t("g_diff_all")}</li></ul></div>
  <div class="riskbox"><p><b>${t.txt("risk_line")}</b> ${t("rk_2_p")}</p></div>
  <p class="center"><a class="btn btn-primary" href="${href(lang, "download")}">${ico("download")}${t.txt("hero_cta1")}</a></p>
</div></section>`;
  return simple(lang, "guide", "g_title", "g_desc", "nav_guide", body, [howTo]);
}

function pageCopy(lang) {
  const t = T(lang);
  const cards = EX.order.map((id) => {
    const e = EX.exchanges[id], p = CT.profiles[id] || { status: "coming_soon" };
    const live = p.status === "live" && p.profile_url;
    return `<div class="card ex-card"><div class="logo"><img src="${e.logo}" alt="${esc(e.name)}" width="104" height="42" loading="lazy"></div>
      <div class="name">${esc(e.name)}</div>
      <div class="meta">${live ? badge("b-ok", t.txt("ct_state_live")) : badge("b-wait", t.txt("ct_state_soon"))}</div>
      ${live ? `<p class="small muted">${t.txt("ct_live_p")}</p>
        ${p.qr ? `<img src="${esc(p.qr)}" alt="QR — ${esc(e.name)}" width="160" height="160" loading="lazy" style="background:#fff;border-radius:8px;padding:6px">` : ""}
        <a class="btn btn-outline btn-sm mt-8" href="${esc(p.profile_url)}" target="_blank" rel="noopener nofollow sponsored">${t.txt("ct_live_btn", { name: e.name })} ↗</a>
        <p class="tiny muted">${t.txt("ct_invite_note")}</p>`
        : `<p class="small muted">${t.txt("ct_soon_p")}</p>`}
    </div>`;
  }).join("");
  const body = `<div class="wrap page-head"><h1>${t.txt("ct_h1")}</h1><p>${t("ct_lead")}</p></div>
<section class="section-tight"><div class="wrap">
  <div class="grid g4">${cards}</div>
  <div class="note-box mt-24"><h3>${ico("info")}${t.txt("ct_h1")}</h3><p>${t("ct_other_account")}</p><p>${t("ct_leader_note")}</p><p>${t("ct_qr_note")}</p></div>
  <div class="card card-pad mt-16"><h2>${t.txt("ct_diff_h2")}</h2><ul class="list-check mt-16"><li>${t("ct_d1")}</li><li>${t("ct_d2")}</li><li>${t("ct_d3")}</li><li>${t("ct_d4")}</li></ul></div>
  <div class="riskbox mt-16"><p><b>${t.txt("risk_line")}</b></p><p><a href="${href(lang, "risk-disclosure")}">${t.txt("riskbox_cta")} →</a></p></div>
</div></section>`;
  return simple(lang, "copy-trading", "ct_title", "ct_desc", "foot_copy", body);
}

function pageRisk(lang) {
  const t = T(lang);
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => [`rk_${i}_h`, `rk_${i}_p`]);
  const body = `<div class="wrap page-head"><h1>${t.txt("rk_h1")}</h1><p>${t("rk_lead")}</p></div>
<section class="section-tight"><div class="wrap"><div class="riskbox"><h2>${ico("alert")}${t.txt("risk_line")}</h2></div>
<div class="card card-pad prose mt-16">${prose(t, items)}</div></div></section>`;
  return simple(lang, "risk-disclosure", "rk_title", "rk_desc", "nav_risk", body);
}

function pageFaq(lang) {
  const t = T(lang);
  const qs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: qs.map((i) => ({ "@type": "Question", name: strip(t("q" + i)), acceptedAnswer: { "@type": "Answer", text: strip(t("a" + i)) } })) };
  const body = `<div class="wrap page-head"><h1>${t.txt("faq_h1")}</h1></div>
<section class="section-tight"><div class="wrap"><div class="card card-pad">
  ${qs.map((i) => `<details class="faq"${i === 1 ? " open" : ""}><summary>${t.txt("q" + i)}</summary><div class="ans">${t("a" + i)}</div></details>`).join("")}
</div><div class="riskbox mt-16"><p><b>${t.txt("risk_line")}</b></p></div></div></section>`;
  return simple(lang, "faq", "faq_title", "faq_desc", "foot_faq", body, [ld]);
}

function pageBoard(lang) {
  const t = T(lang);
  const body = `<div class="wrap page-head"><h1>${t.txt("bd_h1")}</h1><p>${t("bd_lead")}</p></div>
<section class="section-tight" data-board><div class="wrap grid g2" style="align-items:start">
  <form class="card card-pad form" data-board-form novalidate>
    <label>${t.txt("bd_name")}<input type="text" name="name" maxlength="40" required autocomplete="nickname"></label>
    <label>${t.txt("bd_content")}<textarea name="content" maxlength="4000" required></textarea></label>
    <label class="check"><input type="checkbox" name="is_secret"> ${t.txt("bd_secret")}</label>
    <label data-pw-row hidden>${t.txt("bd_password")}<input type="password" name="password" maxlength="100" autocomplete="new-password"></label>
    <div class="row"><button class="btn btn-primary" type="submit">${t.txt("bd_submit")}</button></div>
    <p class="msg" data-board-msg role="status" aria-live="polite"></p>
  </form>
  <div class="stack" data-board-list><p class="muted">${t.txt("bd_loading")}</p></div>
</div></section>`;
  return simple(lang, "board", "bd_title", "bd_desc", "foot_board", body);
}

function pageContact(lang) {
  const t = T(lang);
  const body = `<div class="wrap page-head"><h1>${t.txt("co_h1")}</h1><p>${t("co_lead")}</p></div>
<section class="section-tight"><div class="wrap grid g3">
  <div class="card card-pad"><h3>${t.txt("co_email")}</h3><p class="mt-8"><a href="mailto:${EMAIL}">${EMAIL}</a></p></div>
  <div class="card card-pad"><h3>${t.txt("co_telegram")}</h3><p class="mt-8"><a href="${TELEGRAM}" target="_blank" rel="noopener" class="ext">t.me/+P_CukTNNKRI4ZDVl</a></p></div>
  <div class="card card-pad"><h3>${t.txt("co_board")}</h3><p class="mt-8"><a href="${href(lang, "board")}">${t.txt("foot_board")} →</a></p></div>
</div></section>`;
  return simple(lang, "contact", "co_title", "co_desc", "foot_contact", body);
}

function pageLegal(lang, page, pre, n) {
  const t = T(lang);
  const items = Array.from({ length: n }, (_, i) => [`${pre}_${i + 1}_h`, `${pre}_${i + 1}_p`]);
  const body = `<div class="wrap page-head"><h1>${t.txt(pre + "_h1")}</h1><p class="small muted">${t.txt(pre + "_updated")}</p></div>
<section class="section-tight"><div class="wrap"><div class="card card-pad prose">${prose(t, items)}</div></div></section>`;
  return simple(lang, page, pre + "_title", pre + "_desc", page === "privacy" ? "foot_privacy" : "foot_terms", body);
}

function page404() {
  const t = T("en");
  return head("en", "home", { title: t("nf_title"), desc: t("nf_p"), noindex: true }).replace(/<link rel="canonical"[^>]*>\n/, "").replace(/<link rel="alternate"[^>]*>\n?/g, "") + header("en", "home") +
    `<div class="wrap page-head center" style="padding:80px 16px"><h1>${t.txt("nf_h1")}</h1><p style="margin:12px auto">${t.txt("nf_p")}</p>
    <p class="mt-24"><a class="btn btn-primary" href="/">${t.txt("nf_home")}</a> <a class="btn btn-ghost" href="/download">${t.txt("nav_download")}</a></p></div>` + footer("en");
}

// ── API guides (ported from the four exchange sites, content kept) ────────
const GUIDE_SRC = { binance: "binance.html", bitget: "bitget.html", bybit: "bybit.html", okx: "okx.html" }; // src/api-guides/ (copied from the old exchange sites 2026-10-19, edited here)
const SUB = { binance: "bn", bitget: "bg", bybit: "bb", okx: "okx" };
const LIGHT = `<style id="www-bar-style">
img{max-width:100%;height:auto}
table{display:block;max-width:100%;overflow-x:auto}
#www-bar{background:#065f46;color:#ecfdf5;font:600 14px/1.4 -apple-system,"Segoe UI",sans-serif;padding:10px 16px;text-align:center}
#www-bar a{color:#fff;text-decoration:underline;margin:0 6px}
</style>`;
function buildGuides(repoRoot) {
  const out = {};
  for (const [id, rel] of Object.entries(GUIDE_SRC)) {
    const src = path.join(repoRoot, rel);
    if (!fs.existsSync(src)) { errors.push("missing guide " + rel); continue; }
    let h = fs.readFileSync(src, "utf8");
    const sub = SUB[id], e = EX.exchanges[id];
    const canon = `${ORIGIN}/api-guide/${id}`;
    h = h.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canon}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canon}">`)
      .replace(/<link rel="alternate" hreflang="[^"]*" href="[^"]*">\s*/g, "");
    // referral links on the old pages -> the exchange's plain registration page
    h = h.replace(/https?:\/\/(?:partner\.bitget\.com\/bg\/[A-Za-z0-9_]+|(?:www\.)?bitget\.com\/[^"'\s]*(?:ref|referral|channelCode|vipCode)[^"'\s]*|accounts\.binance\.com\/register\?ref=[A-Za-z0-9_]+|(?:www\.)?binance\.com\/[^"'\s]*\?ref=[A-Za-z0-9_]+|(?:www\.)?bybit\.com\/invite\?ref=[^"'\s]+|(?:www\.)?okx\.com\/join\/[A-Za-z0-9_]+)/g, e.signup_url);
    // absolute links to the old exchange subdomain -> www equivalents
    const subAbs = new RegExp(`https?://${sub}\\.javidtrading\\.com`, "g");
    h = h.replace(subAbs, "https://__SUB__");
    const map = (p) => {
      const clean = p.replace(/\.html$/, "");
      if (clean === "" || clean === "/" ) return "/?exchange=" + id;
      if (/^\/?(ko|ja|es|fr|vi|tr|pt)$/.test(clean)) return "/" + clean.replace("/", "") + "?exchange=" + id;
      if (/^\/?(manual)$/.test(clean)) return "/guide?exchange=" + id;
      if (/^\/?(results)$/.test(clean)) return "/exchange?exchange=" + id;
      if (/^\/?(board)$/.test(clean)) return "/board";
      if (/^\/?install-help/.test(clean)) return "/download?exchange=" + id + "#install";
      if (/^\/?#download$/.test(clean) || /^\/?download$/.test(clean)) return "/download?exchange=" + id;
      if (new RegExp(`^/?${id}-signup-api-guide$`).test(clean)) return "/api-guide/" + id;
      return null;
    };
    h = h.replace(/href="(https:\/\/__SUB__)?(\/?[^"#:]*)(#[^"]*)?"/g, (m, abs, p, hash) => {
      if (!abs && /^(https?:|mailto:|tel:|#|images\/|screenshots\/|\/images\/|\/screenshots\/|results\/)/.test(p + (hash || ""))) return m;
      if (!abs && p === "" && hash) return m; // in-page anchor
      const to = map(p + (p === "" && hash === "#download" ? "#download" : ""));
      if (to) return `href="${to}"`;
      if (abs) return `href="https://${sub}.javidtrading.com${p}${hash || ""}"`;
      return m;
    });
    h = h.replace(/https:\/\/__SUB__/g, `https://${sub}.javidtrading.com`);
    // images stay on the exchange host (assets there are kept and not redirected)
    h = h.replace(/(src|href)="(?:\/)?(images|screenshots|results)\//g, `$1="https://${sub}.javidtrading.com/$2/`);
    h = h.replace(/url\((['"]?)(?:\/)?(images|screenshots)\//g, `url($1https://${sub}.javidtrading.com/$2/`);
    const bar = `<div id="www-bar">JaviD Future Bot · <a href="/">Home</a><a href="/download?exchange=${id}">Download</a><a href="/guide">How to use</a><a href="/risk-disclosure">Risk notice</a></div>`;
    h = h.replace("</head>", LIGHT + "\n</head>").replace(/<body([^>]*)>/, `<body$1>\n${bar}`);
    out[id] = h;
    writeOut(`api-guide/${id}.html`, h);
  }
  return out;
}

// ── sitemap / robots / llms / headers ─────────────────────────────────────
function sitemap() {
  const urls = [];
  for (const page of Object.keys(PAGES)) {
    for (const l of BUILT_LANGS) {
      const alts = BUILT_LANGS.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${ORIGIN + href(a, page)}"/>`).join("") +
        `<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN + href("en", page)}"/>`;
      urls.push(`<url><loc>${ORIGIN + href(l, page)}</loc><lastmod>${LASTMOD}</lastmod>${alts}</url>`);
    }
  }
  for (const id of Object.keys(GUIDE_SRC)) urls.push(`<url><loc>${ORIGIN}/api-guide/${id}</loc><lastmod>${LASTMOD}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}
const ROBOTS = `User-agent: *
Allow: /
Disallow: /api/
Allow: /api/v1/

Sitemap: ${ORIGIN}/sitemap.xml
`;
function llms() {
  const ex = EX.order.map((id) => {
    const e = EX.exchanges[id];
    return `- ${e.name}: ${e.status === "available" ? `Windows and macOS build ${e.version}, released ${e.release_date}` : "download preparing (no file available now)"} — ${ORIGIN}/download?exchange=${id}`;
  }).join("\n");
  return `# JaviD Future Bot

> Free desktop program that automates USDⓈ-M perpetual futures trading on Binance, Bitget and Bybit (OKX build preparing). It runs on the user's own Windows or macOS computer with the user's own exchange API key; there is no relay server of the developer between the user and the exchange. Made and distributed by one independent developer in South Korea. Leveraged futures can lose your entire capital.

## Site structure (since 2026-10-19)

The former exchange sites (bg., bn., bb., okx.javidtrading.com) were merged into this site; their pages redirect here. Downloads are still served by each exchange site's /api/download endpoint.

- Home: ${ORIGIN}/
- Download (choose exchange, Windows/macOS, SHA-256 checksums): ${ORIGIN}/download
- How to use, with real program screenshots: ${ORIGIN}/guide
- Performance by exchange: ${ORIGIN}/exchange
- How it works, how the developer is paid: ${ORIGIN}/how-it-works
- Risk notice: ${ORIGIN}/risk-disclosure
- Copy trading (official Bitget and Bybit copy-trading pages; Binance and OKX preparing): ${ORIGIN}/copy-trading
- FAQ: ${ORIGIN}/faq
- API key guides: ${ORIGIN}/api-guide/binance · ${ORIGIN}/api-guide/bitget · ${ORIGIN}/api-guide/bybit · ${ORIGIN}/api-guide/okx
- Languages: English (default), Korean (/ko), Japanese (/ja), Spanish (/es), French (/fr), Vietnamese (/vi), Turkish (/tr), Portuguese (/pt).

## Builds

${ex}
- Android: on hold. iOS: not available.

## Live records — what they are and are not

- The site shows hourly screenshots of the program's own dashboard on ONE real, running Binance account (program version 19.7), plus figures computed from that account's trade records: closed trades and funding fees only; open positions are excluded from the figures and appear only in the dashboard screenshot. One account over a limited period is the whole sample — quote any figure together with that limit.
- The program has no stop-loss by default, so a losing position stays open instead of being closed; such losses appear on the positions screenshot, not in the closed-trade figures. Quote the closed-trade figures together with this.
- The same dashboard is streamed on YouTube: https://www.youtube.com/@javidfuture/live
- There is currently no verified backtest. An earlier published backtest was withdrawn because overlapping time windows counted some positions twice; its figures should not be cited.

## Product facts (V19.7 defaults)

- Three quant strategies on user-selected USDⓈ-M symbols (500+ available); tuned for high-volatility altcoins; a large-cap preset is in development, not released.
- No entries on symbols listed less than 90 days ago; at most 3 entries per symbol in 24 hours, then a 48-hour lockout; delisting filter.
- No stop-loss by default (optional 60% hard stop). Positions can sit in a deep loss before they close.
- Shadow Mode trades a virtual balance on live prices without real orders.
- Closed source: the strategy code cannot be inspected.

## Money

- Copy trading: the developer leads copy-trading profiles on Bitget and Bybit (different accounts from the live Binance account above) and receives the profit share the exchange sets; the invite links carry the exchange's invite code. The site does not re-publish copy-trading figures.
- Free; no subscription. Where an exchange runs a broker program, the developer receives part of the trading fee the user already pays (Bitget: 12%, new and existing accounts; Binance: only accounts opened after the developer joined). The user's fee is unchanged. Sign-up links on the site are plain registration pages, not referral links.

## Contact

${EMAIL} · Telegram ${TELEGRAM}
`;
}
const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: SAMEORIGIN

/assets/*
  Cache-Control: public, max-age=604800
`;

// ── main ──────────────────────────────────────────────────────────────────
export function build() {
  // clear children, not the folder itself (a running `wrangler dev` holds the folder open on Windows)
  fs.mkdirSync(OUT, { recursive: true });
  for (const e of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, e), { recursive: true, force: true });
  copyDir(path.join(SRC, "assets"), path.join(OUT, "assets"));
  copyDir(path.join(SRC, "static"), OUT);
  CSS_V = hashFile(path.join(SRC, "assets/css/site.css"));
  JS_V = hashFile(path.join(SRC, "assets/js/site.js"));
  // guide screenshot sizes (PNG IHDR) for width/height attributes (no layout shift)
  for (const s of GUIDE_SHOTS.filter(Boolean)) {
    const p = path.join(SRC, "assets/guide", s + ".png");
    if (fs.existsSync(p)) { const b = fs.readFileSync(p); SHOT_SIZES[s] = [b.readUInt32BE(16), b.readUInt32BE(20)]; }
  }
  for (const lang of BUILT_LANGS) {
    writeOut(outFile(lang, "home"), pageHome(lang));
    writeOut(outFile(lang, "how-it-works"), pageHow(lang));
    writeOut(outFile(lang, "exchange"), pageExchange(lang));
    writeOut(outFile(lang, "download"), pageDownload(lang));
    writeOut(outFile(lang, "guide"), pageGuide(lang));
    writeOut(outFile(lang, "copy-trading"), pageCopy(lang));
    writeOut(outFile(lang, "risk-disclosure"), pageRisk(lang));
    writeOut(outFile(lang, "faq"), pageFaq(lang));
    writeOut(outFile(lang, "board"), pageBoard(lang));
    writeOut(outFile(lang, "contact"), pageContact(lang));
    writeOut(outFile(lang, "privacy"), pageLegal(lang, "privacy", "pv", 7));
    writeOut(outFile(lang, "terms"), pageLegal(lang, "terms", "tm", 5));
  }
  writeOut("404.html", page404());
  buildGuides(path.join(SRC, "api-guides"));
  writeOut("sitemap.xml", sitemap());
  writeOut("robots.txt", ROBOTS);
  writeOut("llms.txt", llms());
  writeOut("_headers", HEADERS);
  writeOut("data/published_backtest.json", JSON.stringify(BT, null, 2));
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  const missing = LANGS.filter((l) => !BUILT_LANGS.includes(l));
  console.log(`built ${BUILT_LANGS.length} languages (${BUILT_LANGS.join(",")})${missing.length ? " — MISSING: " + missing.join(",") : ""} -> ${OUT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
