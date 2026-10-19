// Unit test for the backtest validator (synthetic data only, never written to published.json).
//   node tools/test_backtest_publish.mjs
import { validateRun } from "./backtest_publish.mjs";

const base = () => ({
  id: "synthetic-test", is_live: false, engine_build: "V19.7",
  period: { from: "2025-01-01", to: "2025-02-01" },
  universe: { description: "synthetic test universe", includes_delisted: false },
  data_source: "synthetic 1m candles",
  costs: { fees: { included: true }, funding: { included: false }, slippage: { included: false } },
  verification: { verified_by: "test", verified_at: "2026-10-19" },
  trades: [
    { id: "t1", symbol: "AAAUSDT", side: "SHORT", entry_time: "2025-01-02T00:00:00Z", exit_time: "2025-01-03T00:00:00Z", pnl_usdt: 5 },
    { id: "t2", symbol: "AAAUSDT", side: "SHORT", entry_time: "2025-01-04T00:00:00Z", exit_time: "2025-01-05T00:00:00Z", pnl_usdt: -2 },
    { id: "t3", symbol: "BBBUSDT", side: "LONG", entry_time: "2025-01-02T00:00:00Z", exit_time: "2025-01-06T00:00:00Z", pnl_usdt: 1.5 },
  ],
  headline: { trades: 3, wins: 2, net_pnl_usdt: 4.5, liquidations: 0, max_drawdown_pct: null, net_return_pct: null },
});
const cases = [
  ["valid run passes", base(), 0],
  ["live record rejected", { ...base(), is_live: true }, 1],
  ["duplicate position rejected", (() => { const r = base(); r.trades.push({ ...r.trades[0], id: "t1b" }); r.headline = { ...r.headline, trades: 4, wins: 3, net_pnl_usdt: 9.5 }; return r; })(), 1],
  ["overlapping position rejected", (() => { const r = base(); r.trades[1].entry_time = "2025-01-02T12:00:00Z"; return r; })(), 1],
  ["headline mismatch rejected", (() => { const r = base(); r.headline.net_pnl_usdt = 99; return r; })(), 1],
  ["missing cost flags rejected", (() => { const r = base(); delete r.costs.slippage; return r; })(), 1],
  ["missing survivorship flag rejected", (() => { const r = base(); delete r.universe.includes_delisted; return r; })(), 1],
  ["return without equity curve rejected", (() => { const r = base(); r.headline.net_return_pct = 12; return r; })(), 1],
];
let fail = 0;
for (const [name, run, wantErr] of cases) {
  const errs = validateRun(run);
  const ok = wantErr ? errs.length > 0 : errs.length === 0;
  if (!ok) { fail++; console.log("FAIL", name, errs); }
}
console.log(`${cases.length - fail}/${cases.length} backtest validator cases pass`);
process.exit(fail ? 1 : 0);
