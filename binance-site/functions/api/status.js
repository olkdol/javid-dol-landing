// GET  /api/status  -> public, returns the operator's latest live account snapshot
// POST /api/status  -> requires header x-status-key: <STATUS_PUSH_KEY>, upserts the snapshot
//
// Pushed periodically by the operator's own local bot (see the Python snippet
// provided alongside this file). Powers the "Live Proof" section on index.html.
// Only ever one row (id = 1) — every POST overwrites it.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet({ env }) {
  if (!env.BOARD_DB) return json({ error: "not_configured" }, 500);

  const row = await env.BOARD_DB.prepare("SELECT * FROM live_status WHERE id = 1").first();
  if (!row) return json({ live: false });

  return json({
    live: true,
    balance: row.balance,
    cumulative_pnl: row.cumulative_pnl,
    cumulative_return_pct: row.cumulative_return_pct,
    win_rate: row.win_rate,
    trade_count: row.trade_count,
    open_positions: row.open_positions,
    updated_at: row.updated_at,
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.BOARD_DB) return json({ error: "not_configured" }, 500);

  const key = request.headers.get("x-status-key");
  if (!key || !env.STATUS_PUSH_KEY || key !== env.STATUS_PUSH_KEY) {
    return json({ error: "forbidden" }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_request" }, 400);
  }

  const balance = Number(body.balance);
  const cumulativePnl = Number(body.cumulative_pnl);
  const cumulativeReturnPct = Number(body.cumulative_return_pct);
  const winRate = Number(body.win_rate);
  const tradeCount = Number.isFinite(Number(body.trade_count)) ? Number(body.trade_count) : null;
  const openPositions = Number.isFinite(Number(body.open_positions)) ? Number(body.open_positions) : null;

  if (![balance, cumulativePnl, cumulativeReturnPct, winRate].every(Number.isFinite)) {
    return json({ error: "missing_fields" }, 400);
  }

  const updatedAt = new Date().toISOString();

  await env.BOARD_DB.prepare(
    `INSERT INTO live_status (id, balance, cumulative_pnl, cumulative_return_pct, win_rate, trade_count, open_positions, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       balance = excluded.balance,
       cumulative_pnl = excluded.cumulative_pnl,
       cumulative_return_pct = excluded.cumulative_return_pct,
       win_rate = excluded.win_rate,
       trade_count = excluded.trade_count,
       open_positions = excluded.open_positions,
       updated_at = excluded.updated_at`
  )
    .bind(balance, cumulativePnl, cumulativeReturnPct, winRate, tradeCount, openPositions, updatedAt)
    .run();

  return json({ ok: true, updated_at: updatedAt });
}
