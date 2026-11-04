// Consistency checks for the backtest-study data and copy. No network.
//   node tools/test_study.mjs
// 1 transcribed points reproduce the reported totals (283 / 16 / 9 / 4, per-quarter counts)
// 2 the settings chart's counts and "expected" column follow from the per-pump shares
// 3 the 3-month tables add up (monthly realised vs total; the two known open-position gaps are asserted)
// 4 the LSK case sums match the reported -306 -> -72
// 5 the study copy does not leak the hidden defense parameters (they must appear only as ** masks)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = JSON.parse(fs.readFileSync(path.join(ROOT, "src/study/data.json"), "utf8"));
const errors = [];
const eq = (a, b, m) => { if (a !== b) errors.push(`${m}: got ${a}, want ${b}`); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) errors.push(`${m}: got ${a}, want ${b} (±${tol})`); };

// 1
const pts = D.pts;
eq(pts.length, D.expect.total, "pump count");
eq(pts.filter((p) => p[2] >= 7).length, D.expect.major, "pumps of 7x or more");
eq(pts.filter((p) => p[2] >= D.lines.l300).length, D.expect.over300, "crossed the 1/300 line");
eq(pts.filter((p) => p[2] >= D.lines.l500).length, D.expect.over500, "crossed the 1/500 line");
eq(pts.filter((p) => p[3]).length, D.expect.major, "pumps carrying per-setting shares");
for (const p of pts) if (p[3] && !(p[2] >= 7)) errors.push(`${p[0]} ${p[1]}: has shares but is under 7x`);
for (const p of pts) if (!/^\d{4}-\d{2}-\d{2}$/.test(p[1]) || !(p[1] >= D.period.from.slice(0, 7) && p[1] <= D.period.to)) errors.push(`${p[0]}: date ${p[1]} outside period`);
const q = {};
for (const p of pts) {
  const y = p[1].slice(2, 4), m = +p[1].slice(5, 7), k = `${y}Q${Math.ceil(m / 3)}`;
  q[k] ||= [0, 0]; q[k][0]++; if (p[2] >= 7) q[k][1]++;
}
eq(D.quarters.length, Object.keys(q).length, "quarter count");
for (const [label, total, major] of D.quarters) { eq((q[label] || [0])[0], total, `quarter ${label} total`); eq((q[label] || [0, 0])[1], major, `quarter ${label} 7x+`); }
eq(D.quarters.reduce((a, r) => a + r[1], 0), D.expect.total, "quarter totals sum");

// 2
const sixteen = pts.filter((p) => p[3]);
D.scen.forEach((s, i) => {
  const shares = sixteen.map((p) => p[3][i]);
  eq(shares.filter((v) => v > 0).length, s.two, `${s.k}: events with two positions open`);
  near(shares.reduce((a, v) => a + v, 0) / 100, s.exp, 0.006, `${s.k}: expected column`);
});

// 3
const num = (s) => Number(String(s).replace(/,/g, ""));
const sum = (a) => a.reduce((x, v) => x + num(v), 0);
for (const r of D.stopOnly) {
  const gap = sum(r.m) - num(r.pnl);
  if (r.k === "base" || r.k === "cut") eq(gap, 371, `stopOnly ${r.k}: months minus total (positions still open at the window end)`);
  else near(gap, 0, 5, `stopOnly ${r.k}: months vs total`);
}
for (const r of D.combo) {
  const gap = sum(r.m) - num(r.pnl);
  if (r.k === "base") eq(gap, 371, "combo base: months minus total (open at window end)");
  else if (r.k === "cap") eq(gap, 55, "combo cap: months minus total (open at window end)");
  else near(gap, 0, 5, `combo ${r.k}: months vs total`);
}
eq(D.capBlocked.win + D.capBlocked.loss, D.capBlocked.n, "cap blocked entries add up");
near(num(D.capBlocked.winPnl) + num(D.capBlocked.lossPnl), -171, 0.5, "cap blocked net (info)");
eq(D.trapped.filter((r) => r[2] >= 20).length, Number(D.combo[0].trap), "underwater cycles (>=20% of balance) in the diagnosis table");
near(Math.round((1 - D.kpi.testedReturn / D.kpi.baselineReturn) * 100), 47, 0, "the reported -47% (tested return vs old rules)");
eq(D.combo.find((r) => r.k === "capL2").ret, "+" + D.kpi.testedReturn.toFixed(1) + "%", "tested return matches the combination row");
eq(D.combo.filter((r) => r.m.every((v) => num(v) > 0)).map((r) => r.k).join(), "cap,capL2,capL3,capL4", "rows with all four months in profit");
eq(D.trapped.filter((r) => r[2] >= 20 && /^\+/.test(r[6])).length, 5, "underwater cycles that later closed in profit");
eq(D.trapped.filter((r) => r[2] >= 20 && /^\+/.test(r[6])).reduce((a, r) => a + num(r[6]), 0), 69, "their combined profit");

// 4
near(D.lsk.rows.reduce((a, r) => a + num(r.real), 0), -305.92, 0.01, "LSK real sum");
near(D.lsk.rows.reduce((a, r) => a + num(r.rep), 0), -72.43, 0.01, "LSK replay sum");
eq(Math.round(D.lsk.rows.reduce((a, r) => a + num(r.real), 0)), num(D.lsk.sum.real), "LSK real sum (rounded)");
eq(Math.round(D.lsk.rows.reduce((a, r) => a + num(r.rep), 0)), num(D.lsk.sum.rep), "LSK replay sum (rounded)");
eq(D.lsk.rows.filter((r) => r.o === "blocked").length, D.lsk.sum.blocked, "LSK blocked count");
near(D.lsk.rows.filter((r) => r.o === "blocked").reduce((a, r) => a + num(r.real), 0), 4.17, 0.01, "forgone real profit on blocked entries");
eq(D.engine.reduce((a, r) => a + r.n, 0), D.engineSum.trades, "engine replay trade total");

// 5 — hidden parameters must not appear as numbers in the data or any language file
const LEAKS = [
  [/1\.54\s?[×x]|[×x]\s?1\.54/, "split multiple"], [/(?<![\d.])8\.2\s?%/, "entry threshold"], [/(?<![\d.])75\s?%/, "emergency-close threshold"],
  [/(?<![\d.])25\s?%/, "stop level"], [/\b24[- ]?(h|hr|hour)/i, "re-entry window"], [/\b48[- ]?(h|hr|hour)/i, "lockout"],
  [/\b90[- ]?day/i, "listing-age gate"], [/(?<![\d.])60\s?%/, "preset stop"], [/×\s?1\.25|1\.25\s?×/, "stop line"],
  [/\b3 (entries|re-entries) (per|in|within)/i, "cap size"],
];
const files = [["src/study/data.json", fs.readFileSync(path.join(ROOT, "src/study/data.json"), "utf8").replace(/"_comment"[^\n]*\n/, "")]];
for (const f of fs.readdirSync(path.join(ROOT, "src/study"))) if (/^[a-z]{2}\.json$/.test(f)) files.push([`src/study/${f}`, fs.readFileSync(path.join(ROOT, "src/study", f), "utf8")]);
for (const [name, s] of files) for (const [re, what] of LEAKS) { const m = s.match(re); if (m) errors.push(`${name}: hidden value leaked (${what}): “${m[0]}”`); }

const years = [pts.filter((p) => p[1] < D.period.boundary).length, pts.filter((p) => p[1] >= D.period.boundary).length];
console.log(`pumps ${pts.length} (7x+: ${D.expect.major}), year 1: ${years[0]}, year 2: ${years[1]}, languages checked: ${files.length - 1}`);
if (errors.length) { console.log(errors.join("\n")); console.log(`FAIL: ${errors.length} problem(s)`); process.exit(1); }
console.log("PASS");
