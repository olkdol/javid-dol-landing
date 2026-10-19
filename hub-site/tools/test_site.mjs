// Static checks on the generated site (./public). No network.
//   node tools/test_site.mjs [--secret-file <path>]
// 1 every inline <script> parses; every JSON-LD block is valid JSON
// 2 every page declares the same hreflang set (8 languages + x-default), reciprocal, targets exist
// 3 every internal href/src resolves to a generated file (or a known API/legacy route)
// 4 banned phrasing / withdrawn figures / wrong account claims / referral links are absent
// 5 no secret material in the output (optional: the capture key file is checked by value)
// 6 download buttons only point at the four exchange workers' /api/download and carry data-dl
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const LANGS = ["en", "ko", "ja", "es", "fr", "vi", "tr", "pt"];
const ORIGIN = "https://www.javidtrading.com";
const errors = [];
const err = (m) => errors.push(m);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(PUB);
const rel = (p) => path.relative(PUB, p).split(path.sep).join("/");
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const fileSet = new Set(files.map(rel));

function resolvesTo(urlPath) {
  const p = decodeURIComponent(urlPath.replace(/^\//, ""));
  if (p === "") return fileSet.has("index.html");
  if (fileSet.has(p)) return true;
  if (fileSet.has(p + ".html")) return true;
  if (fileSet.has(p.replace(/\/$/, "") + "/index.html")) return true;
  return false;
}
const API_OK = /^\/api\/(live-capture(\/latest)?|v1\/.*|board\/posts.*)$/;

// 1 + 2 + 3 + 6
let pages = 0, scripts = 0, ld = 0, links = 0, dl = 0;
for (const f of htmlFiles) {
  const r = rel(f);
  const h = fs.readFileSync(f, "utf8");
  pages++;
  for (const m of h.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] || "", body = m[2];
    if (/src=/.test(attrs)) continue;
    if (/application\/ld\+json/.test(attrs)) { ld++; try { JSON.parse(body); } catch (e) { err(`${r}: JSON-LD parse: ${e.message}`); } continue; }
    if (/type="(?!text\/javascript|module)/.test(attrs)) continue;
    scripts++;
    try { new vm.Script(body, { filename: r }); } catch (e) { err(`${r}: inline script syntax: ${e.message}`); }
  }
  const isGuide = r.startsWith("api-guide/");
  if (!isGuide && r !== "404.html") {
    const alts = [...h.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
    const langs = alts.map((a) => a[0]).sort();
    const want = [...LANGS, "x-default"].sort();
    if (JSON.stringify(langs) !== JSON.stringify(want)) err(`${r}: hreflang set ${langs.join(",")}`);
    const canon = (h.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
    if (!canon) err(`${r}: no canonical`);
    else if (!alts.some((a) => a[1] === canon)) err(`${r}: canonical not among its hreflang alternates`);
    for (const [, u] of alts) { if (!u.startsWith(ORIGIN) || !resolvesTo(u.slice(ORIGIN.length))) err(`${r}: hreflang target missing ${u}`); }
    if (canon && /\.html$/.test(canon)) err(`${r}: canonical ends with .html`);
  }
  for (const m of h.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:|tel:|#|data:)/.test(u)) continue;
    if (u.startsWith("?")) continue;
    links++;
    const pathOnly = u.split("#")[0].split("?")[0];
    if (API_OK.test(pathOnly)) continue;
    if (pathOnly.startsWith("/") && !resolvesTo(pathOnly)) err(`${r}: broken internal link ${u}`);
  }
  for (const m of h.matchAll(/<a\b[^>]*href="([^"]*\/api\/download[^"]*)"[^>]*>/g)) {
    dl++;
    if (!/^https:\/\/(bg|bn|bb)\.javidtrading\.com\/api\/download\?platform=(windows|mac)$/.test(m[1])) err(`${r}: unexpected download href ${m[1]}`);
    if (!/data-dl/.test(m[0])) err(`${r}: download link without data-dl (no attribution) ${m[1]}`);
    if (/platform=android/.test(m[1])) err(`${r}: android download link`);
  }
}

// 4 content rules (visible text + JSON-LD + llms.txt)
const textFiles = files.filter((f) => /\.(html|txt|json|xml)$/.test(f) && !rel(f).startsWith("assets/"));
const banned = [
  [/믿지\s*(마|말)/, "KO don't-trust"], [/don['’]t\s+(trust|believe|take my word)/i, "EN don't-trust"],
  [/信じないで|信用しないで/, "JA don't-trust"], [/no\s+conf[ií]es|no\s+te\s+f[ií]es/i, "ES don't-trust"],
  [/ne\s+(croyez|faites)\s+pas/i, "FR don't-trust"], [/n[ãa]o\s+(confie|acredite)/i, "PT don't-trust"],
  [/güvenmeyin|inanmayın/i, "TR don't-trust"], [/đừng\s+tin/i, "VI don't-trust"],
  [/보장하지\s*않/, "KO guarantee-negation"], [/(past|previous)\s+(results|performance)[^.]{0,40}(guarantee|predict)/i, "EN past-results-guarantee"],
  [/do(es)?\s+not\s+guarantee|not\s+guaranteed/i, "EN not-guaranteed"],
  [/保証(しません|するものではありません|されません)/, "JA guarantee-negation"],
  [/no\s+garantiza|no\s+se\s+garantiza/i, "ES guarantee-negation"], [/ne\s+garanti(t|ssent)\s+pas|pas\s+garanti/i, "FR guarantee-negation"],
  [/n[ãa]o\s+garante|n[ãa]o\s+s[ãa]o\s+garantid/i, "PT guarantee-negation"], [/garanti\s+(etmez|edilmez)/i, "TR guarantee-negation"],
  [/không\s+(đảm\s+bảo|bảo\s+đảm)\s+(kết\s+quả|lợi\s+nhuận)/i, "VI guarantee-negation"],
  [/2,023|2\.023|−64|-64\s*%|\+96\s*%|\+98\.77/, "withdrawn backtest figure"],
  [/operator['’]s own|운영자 본인|my own live account/i, "wrong account owner claim"],
  [/partner\.bitget\.com|[?&]ref=|okx\.com\/join\/|channelCode|vipCode/i, "referral link"],
  [/100%\s*(win|승률)|승률\s*100/i, "percent win-rate claim"],
];
for (const f of textFiles) {
  const r = rel(f);
  let s = fs.readFileSync(f, "utf8");
  if (r === "data/published_backtest.json") continue;
  if (r.endsWith(".html")) s = s.replace(/<style[\s\S]*?<\/style>/g, "");
  for (const [re, name] of banned) {
    const m = s.match(re);
    if (!m) continue;
    // the software no-warranty clause in Terms is allowed (it is not a results guarantee sentence)
    if (/terms\.html$/.test(r) && /guarantee|garant|保証|đảm bảo|보장/i.test(name + m[0])) continue;
    err(`${r}: ${name}: “${m[0]}”`);
  }
}

// 5 secrets
const secretArg = process.argv.indexOf("--secret-file");
const secretVal = secretArg > 0 ? fs.readFileSync(process.argv[secretArg + 1], "utf8").trim() : null;
for (const f of files) {
  const buf = fs.readFileSync(f);
  const s = buf.toString("latin1");
  if (secretVal && s.includes(secretVal)) err(`${rel(f)}: contains the capture key`);
  if (/oauth_token|BOARD_ADMIN_KEY\s*=|STATS_KEY\s*=|LIVE_CAPTURE_KEY\s*=|-----BEGIN [A-Z ]*PRIVATE KEY/.test(s)) err(`${rel(f)}: secret-looking string`);
}
for (const bad of ["wrangler.jsonc", "worker.js", ".dev.vars", "src/build.mjs"]) if (fileSet.has(bad)) err(`public contains ${bad}`);

console.log(`pages ${pages}, inline scripts ${scripts}, JSON-LD ${ld}, internal links ${links}, download links ${dl}`);
if (errors.length) { console.log(errors.slice(0, 80).join("\n")); console.log(`FAIL: ${errors.length} problem(s)`); process.exit(1); }
console.log("PASS");
