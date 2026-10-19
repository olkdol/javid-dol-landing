// Verified-backtest publish pipeline (SPEC: backtest_runs / published_backtest).
//
//   node tools/backtest_publish.mjs validate src/data/backtest/runs/<run>.json
//   node tools/backtest_publish.mjs publish  src/data/backtest/runs/<run>.json --reason "why this replaces the previous one"
//   node tools/backtest_publish.mjs unpublish --reason "..."
//
// Rules enforced (shown on /exchange as the 8 publication rules):
//  1 engine build stated and one of the released builds        5 each position counted once (duplicate / overlap check)
//  2 period, symbol universe, data source stated               6 headline figures recomputed from the trade list must match
//  3 fees / funding / slippage each marked included or not     7 only the latest verified run is published; history keeps the
//  4 survivorship bias stated (delisted symbols included?)       previous one and the reason it changed
//                                                              8 never a live record (is_live must be false); never summed with live
// A failed validation leaves published.json untouched. Publishing writes a temp file and renames it
// (atomic replace). After publishing, rebuild the site: node src/build.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "src/data/backtest/published.json");
const RELEASED_BUILDS = ["V19.7"];

export function validateRun(run) {
  const e = [];
  const need = (cond, msg) => { if (!cond) e.push(msg); };
  need(run && typeof run === "object", "run must be an object");
  if (!run || typeof run !== "object") return e;
  need(typeof run.id === "string" && /^[A-Za-z0-9._-]{3,80}$/.test(run.id), "id: 3-80 chars [A-Za-z0-9._-]");
  need(run.is_live === false, "rule 8: is_live must be false (backtests are never live records)");
  need(RELEASED_BUILDS.includes(run.engine_build), `rule 1: engine_build must be one of ${RELEASED_BUILDS}`);
  need(run.period && /^\d{4}-\d{2}-\d{2}$/.test(run.period.from || "") && /^\d{4}-\d{2}-\d{2}$/.test(run.period.to || "") && run.period.from < run.period.to, "rule 2: period.from < period.to (YYYY-MM-DD)");
  need(run.universe && typeof run.universe.description === "string" && run.universe.description.length > 5, "rule 2: universe.description");
  need(typeof run.data_source === "string" && run.data_source.length > 5, "rule 2: data_source");
  for (const c of ["fees", "funding", "slippage"]) need(run.costs && run.costs[c] && typeof run.costs[c].included === "boolean", `rule 3: costs.${c}.included must be true/false`);
  need(run.universe && typeof run.universe.includes_delisted === "boolean", "rule 4: universe.includes_delisted must be true/false");
  need(run.verification && typeof run.verification.verified_by === "string" && /^\d{4}-\d{2}-\d{2}/.test(run.verification.verified_at || ""), "verification.verified_by / verified_at");
  const trades = Array.isArray(run.trades) ? run.trades : null;
  need(trades && trades.length > 0, "trades: non-empty list");
  if (!trades) return e;
  const ids = new Set(), keys = new Set(), bySide = {};
  let wins = 0, pnl = 0, liq = 0;
  for (const [i, t] of trades.entries()) {
    const ok = t && typeof t.id === "string" && typeof t.symbol === "string" && ["LONG", "SHORT"].includes(t.side) &&
      !isNaN(Date.parse(t.entry_time)) && !isNaN(Date.parse(t.exit_time)) && Date.parse(t.exit_time) >= Date.parse(t.entry_time) && Number.isFinite(t.pnl_usdt);
    if (!ok) { e.push(`trades[${i}]: needs id, symbol, side LONG|SHORT, entry_time <= exit_time, pnl_usdt`); continue; }
    if (ids.has(t.id)) e.push(`rule 5: duplicate trade id ${t.id}`);
    ids.add(t.id);
    const k = `${t.symbol}|${t.side}|${t.entry_time}`;
    if (keys.has(k)) e.push(`rule 5: same position twice ${k}`);
    keys.add(k);
    (bySide[`${t.symbol}|${t.side}`] ||= []).push([Date.parse(t.entry_time), Date.parse(t.exit_time), t.id]);
    if (t.pnl_usdt > 0) wins++;
    if (t.liquidated === true) liq++;
    pnl += t.pnl_usdt;
  }
  for (const [k, arr] of Object.entries(bySide)) {
    arr.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < arr.length; i++) if (arr[i][0] < arr[i - 1][1]) e.push(`rule 5: overlapping positions ${k}: ${arr[i - 1][2]} and ${arr[i][2]}`);
  }
  const h = run.headline || {};
  const close = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
  need(h.trades === trades.length, `rule 6: headline.trades ${h.trades} != ${trades.length}`);
  need(h.wins === wins, `rule 6: headline.wins ${h.wins} != ${wins}`);
  need(close(h.net_pnl_usdt, pnl, 0.01), `rule 6: headline.net_pnl_usdt ${h.net_pnl_usdt} != ${pnl.toFixed(2)}`);
  need(h.liquidations === liq, `rule 6: headline.liquidations ${h.liquidations} != ${liq}`);
  if (Array.isArray(run.equity) && run.equity.length > 1) {
    let peak = -Infinity, mdd = 0;
    for (const p of run.equity) { peak = Math.max(peak, p.equity); mdd = Math.max(mdd, (peak - p.equity) / peak * 100); }
    const ret = (run.equity[run.equity.length - 1].equity / run.equity[0].equity - 1) * 100;
    need(close(h.max_drawdown_pct, mdd, 0.05), `rule 6: headline.max_drawdown_pct ${h.max_drawdown_pct} != ${mdd.toFixed(2)} (account equity curve)`);
    need(close(h.net_return_pct, ret, 0.05), `rule 6: headline.net_return_pct ${h.net_return_pct} != ${ret.toFixed(2)}`);
  } else {
    need(h.max_drawdown_pct == null && h.net_return_pct == null, "rule 6: max_drawdown_pct / net_return_pct need an account-level equity curve (equity[]); otherwise leave them null");
  }
  return e;
}

function summary(run, file) {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return {
    id: run.id, engine_build: run.engine_build, period: run.period, universe: run.universe, data_source: run.data_source,
    costs: run.costs, headline: run.headline, verification: run.verification, run_file_sha256: sha,
    summary: `${run.engine_build} · ${run.period.from} – ${run.period.to} · ${run.headline.trades} trades`,
  };
}

function writeAtomic(obj) {
  const tmp = PUB + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, PUB);
}

function main() {
  const [cmd, file] = process.argv.slice(2);
  const ri = process.argv.indexOf("--reason");
  const reason = ri > 0 ? process.argv[ri + 1] : null;
  const cur = JSON.parse(fs.readFileSync(PUB, "utf8"));
  if (cmd === "unpublish") {
    if (!reason) { console.error("--reason required"); process.exit(2); }
    if (cur.published) cur.history = [...(cur.history || []), { id: cur.published.id, removed_at: new Date().toISOString(), reason }];
    cur.published = null;
    writeAtomic(cur); console.log("unpublished; rebuild the site"); return;
  }
  if (!["validate", "publish"].includes(cmd) || !file) { console.error("usage: validate|publish <run.json> [--reason ...] | unpublish --reason ..."); process.exit(2); }
  let run;
  try { run = JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { console.error("cannot read run: " + err.message); process.exit(1); }
  const errs = validateRun(run);
  if (errs.length) { console.error("NOT VERIFIED — published.json left unchanged:\n - " + errs.join("\n - ")); process.exit(1); }
  console.log("all checks passed");
  if (cmd === "validate") return;
  if (!reason) { console.error("--reason required to publish (kept in history)"); process.exit(2); }
  const next = { ...cur, published: summary(run, file), history: [...(cur.history || [])] };
  if (cur.published) next.history.push({ id: cur.published.id, replaced_at: new Date().toISOString(), replaced_by: run.id, reason });
  else next.history.push({ id: run.id, published_at: new Date().toISOString(), reason });
  writeAtomic(next);
  console.log(`published ${run.id}; rebuild the site (node src/build.mjs)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
