// Read-only public API (GET only). Every response says where the numbers come from, which period
// they cover, when they were updated, how they were calculated and what is missing. When data is
// missing the fields are null (never 0) and "available": false. No secrets, no order endpoints.
import EX from "../../src/config/exchanges.json";
import CT from "../../src/config/copy_trading.json";
import BT from "../../src/data/backtest/published.json";
import { readLatest, publicManifest } from "./live_capture.js";

const CALC = {
  realized_pnl: "sum of closed-trade P&L plus funding fees from the program's trade records (USDT)",
  wins: "closed trades with P&L > 0; trades closed at exactly 0 count as neither win nor loss",
  excluded: "open positions (unrealized P&L), shadow (virtual) trades",
  curve: "cumulative realized P&L by day; NOT an account equity curve and NOT a drawdown measure",
  timezone: "Asia/Seoul (UTC+9), as recorded by the program",
  sample: "one real account; the whole sample",
};

function json(data, status = 200, maxAge = 60) {
  return new Response(JSON.stringify(data, null, 1), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${maxAge}`, "Access-Control-Allow-Origin": "*" },
  });
}

function exchangeSummary(id) {
  const e = EX.exchanges[id];
  const ct = CT.profiles[id] || {};
  return {
    id, name: e.name, download_status: e.status, version: e.version, release_date: e.release_date,
    platforms: Object.keys(e.downloads || {}),
    live_data: !!e.live_data,
    copy_trading: { status: ct.status || "coming_soon", url: ct.status === "live" ? ct.profile_url : null, contains_invite_code: !!ct.contains_invite_code },
  };
}

function period(days, p) {
  if (!days.length || p === "all") return days;
  const n = { "7d": 7, "30d": 30, "90d": 90 }[p];
  if (!n) return null;
  const last = new Date(days[days.length - 1].d + "T00:00:00Z"); last.setUTCDate(last.getUTCDate() - (n - 1));
  const cut = last.toISOString().slice(0, 10);
  return days.filter((d) => d.d >= cut);
}

function noData(id, what) {
  return { exchange: id, available: false, reason: "no live account data for this exchange is connected to this site", data: null, what };
}

export async function v1(request, env, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405, 0);
  const url = new URL(request.url);
  if (pathname === "/api/v1/exchanges") return json({ exchanges: EX.order.map(exchangeSummary) }, 200, 300);
  if (pathname === "/api/v1/backtest/latest") {
    return json({ available: !!BT.published, published: BT.published || null, history: BT.history || [],
      note: "only the latest verified run is published; backtests are never combined with live records" }, 200, 300);
  }
  const m = pathname.match(/^\/api\/v1\/exchanges\/([a-z]+)\/(performance|equity-curve|trades|status)$/);
  if (!m) return json({ error: "not_found" }, 404, 0);
  const [, id, kind] = m;
  if (!EX.exchanges[id]) return json({ error: "unknown_exchange" }, 404, 0);
  if (!EX.exchanges[id].live_data) return json(noData(id, kind));

  const man = publicManifest(await readLatest(env));
  const base = { exchange: id, source: man.available ? man.source : null, updated_at: man.available ? man.captured_at : null,
    stale: man.available ? man.stale : null, calculation: CALC };
  if (kind === "status") {
    return json({ ...base, available: man.available, age_seconds: man.available ? man.age_seconds : null,
      open_positions: man.available ? man.account.open_positions : null, program_version: man.available ? man.account.program_version : null,
      views: man.available ? man.views : null });
  }
  const daily = (man.available && man.metrics && man.metrics.daily) || [];
  if (!daily.length) return json({ ...base, available: false, reason: "no trade-record figures in the latest capture", data: null });
  const p = url.searchParams.get("period") || "all";
  const days = period(daily, p);
  if (!days) return json({ error: "period must be 7d, 30d, 90d or all" }, 400, 0);
  const range = { from: days.length ? days[0].d : null, to: days.length ? days[days.length - 1].d : null, period: p };
  if (kind === "performance") {
    let trades = 0, wins = 0, losses = 0, flat = 0, pnl = 0, funding = 0, worst = null, down = 0;
    for (const d of days) {
      trades += d.trades; wins += d.wins; losses += d.losses; flat += d.flat; pnl += d.pnl; funding += d.funding;
      if (d.worst != null && (worst == null || d.worst < worst)) worst = d.worst;
      if (d.pnl + d.funding < 0) down++;
    }
    return json({ ...base, available: true, range, data: {
      closed_trades: trades, wins, losses, flat, wins_fraction: `${wins}/${trades}`,
      realized_pnl_usdt: Math.round((pnl + funding) * 100) / 100, funding_usdt: Math.round(funding * 100) / 100,
      worst_closed_trade_usdt: worst, days: days.length, days_with_net_realized_loss: down,
      return_pct: null, return_pct_note: "not computed: account balance history is not published",
      max_drawdown: null, max_drawdown_note: "not computed: a curve of realized P&L is not an account drawdown",
      open_positions: man.account.open_positions, open_positions_note: "excluded from the figures; visible on the positions screenshot" } });
  }
  if (kind === "equity-curve") {
    let c = 0;
    const points = days.map((d) => { c += d.pnl + d.funding; return { date: d.d, cumulative_realized_usdt: Math.round(c * 100) / 100 }; });
    return json({ ...base, available: true, range, kind: "cumulative_realized_pnl_by_day", data: points });
  }
  // trades
  return json({ ...base, available: true, data: (man.metrics.recent_trades || []), note: "latest closed trades only; funding entries and open positions are not listed; times Korea time" });
}
