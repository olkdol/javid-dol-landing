// Backtest-study page: static SVG charts + tables, rendered at build time (no client script).
// Data: src/study/data.json (numbers only). Copy: src/study/<lang>.json. Defense parameters are never stored;
// copy shows them as {m} -> "**" chips. Checked by tools/test_study.mjs and tools/test_site.mjs.
import fs from "node:fs";
import path from "node:path";

const MASK = '<span class="mask">**</span>';
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const strip = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const fill = (s, v = {}) => Object.entries(v).reduce((a, [k, x]) => a.split("{" + k + "}").join(x), s);
const tokens = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const sgn = (s) => String(s).replace(/(^|[\s(/])-(?=[\d.])/g, "$1−").replace(/<=/g, "≤").replace(/ to /g, " … ");
const fmtX = (v) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));

export function loadStudy(SRC, langs, errors) {
  const D = JSON.parse(fs.readFileSync(path.join(SRC, "study/data.json"), "utf8"));
  const dict = {};
  for (const l of langs) {
    const p = path.join(SRC, "study", l + ".json");
    if (!fs.existsSync(p)) { errors.push(`study: missing src/study/${l}.json`); continue; }
    dict[l] = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  const en = dict.en;
  for (const l of langs) {
    if (!dict[l] || l === "en") continue;
    for (const k of Object.keys(en)) {
      if (!(k in dict[l])) { errors.push(`study ${l}: missing key ${k}`); continue; }
      if (tokens(en[k]) !== tokens(dict[l][k])) errors.push(`study ${l}: placeholders differ in ${k} (${tokens(en[k])} vs ${tokens(dict[l][k])})`);
      if (k.endsWith("_cols") && en[k].split("|").length !== dict[l][k].split("|").length) errors.push(`study ${l}: column count differs in ${k}`);
    }
    for (const k of Object.keys(dict[l])) if (!(k in en)) errors.push(`study ${l}: extra key ${k}`);
  }
  return { D, dict };
}

function T(dict, lang) {
  const d = dict[lang];
  const f = (k, v) => { if (!(k in d)) throw new Error(`missing study ${lang}.${k}`); return fill(d[k], { m: MASK, ...v }); };
  f.txt = (k, v) => esc(strip(f(k, v)));
  f.cols = (k) => d[k].split("|");
  return f;
}

// ── small table helpers ───────────────────────────────────────────────────
const tone = (v) => (/^\+/.test(String(v)) ? " gain" : /^-/.test(String(v)) ? " loss" : "");
const numCell = (v, signed = false) => `<td class="num${signed ? tone(v) : ""}">${esc(sgn(v))}</td>`;
const head = (cols, numFrom = 1) => `<thead><tr>${cols.map((c, i) => `<th${i >= numFrom ? ' class="num"' : ""}>${esc(c)}</th>`).join("")}</tr></thead>`;
const wrapTbl = (inner, cls = "") => `<div class="tbl-wrap"><table class="tbl st-tbl ${cls}">${inner}</table></div>`;

// ── charts ────────────────────────────────────────────────────────────────
function timeline(t, D) {
  const W = 760, H = 400, m = { l: 44, r: 12, t: 34, b: 30 };
  const T0 = Date.UTC(2024, 8, 15), T1 = Date.UTC(2026, 8, 15), TB = Date.UTC(2025, 8, 15);
  const ts = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const X = (v) => m.l + ((v - T0) / (T1 - T0)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - Math.log10(v) / Math.log10(80)) * (H - m.t - m.b);
  let s = `<svg class="st-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t.txt("f1_h")}" style="min-width:640px">`;
  for (const v of [1, 2, 5, 10, 20, 50]) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="st-grid"/><text x="${m.l - 7}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="st-t">${v}×</text>`;
  for (let y = 2024; y <= 2026; y++) for (const mo of [0, 3, 6, 9]) {
    const v = Date.UTC(y, mo, 1); if (v <= T0 || v >= T1) continue;
    const x = X(v);
    s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${H - m.b}" y2="${H - m.b + 4}" class="st-axis"/><text x="${x.toFixed(1)}" y="${H - m.b + 17}" text-anchor="middle" class="st-t">${String(y).slice(2)}.${String(mo + 1).padStart(2, "0")}</text>`;
  }
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" class="st-axis"/>`;
  const xb = X(TB), n1 = D.pts.filter((p) => ts(p[1]) < TB).length, n2 = D.pts.length - n1;
  s += `<line x1="${xb.toFixed(1)}" x2="${xb.toFixed(1)}" y1="${m.t - 14}" y2="${H - m.b}" class="st-axis" stroke-dasharray="2 4"/>`;
  s += `<text class="st-yr" x="${(xb - 8).toFixed(1)}" y="${m.t - 16}" text-anchor="end">${t.txt("yr1")} · ${n1} ${t.txt("pumps_u")}</text><text class="st-yr" x="${(xb + 8).toFixed(1)}" y="${m.t - 16}">${t.txt("yr2")} · ${n2} ${t.txt("pumps_u")}</text>`;
  const boxes = [];
  for (const [v, cls, key] of [[D.lines.l300, "st-l300", "lg_l300"], [D.lines.l500, "st-l500", "lg_l500"]]) {
    const y = Y(v), lab = t.txt(key);
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="${cls}" stroke-dasharray="6 5"/><text x="${m.l + 6}" y="${(y - 6).toFixed(1)}" class="st-t ${cls}-t">${lab}</text>`;
    boxes.push([m.l + 4, y - 18, m.l + 6 + lab.length * 6.7, y - 2], [m.l, y - 3, W - m.r, y + 3]);
  }
  for (const p of D.pts) if (p[2] >= 7) { const x = X(ts(p[1])), y = Y(p[2]); boxes.push([x - 6, y - 6, x + 6, y + 6]); }
  let dots = "";
  for (const p of D.pts.slice().sort((a, b) => a[2] - b[2])) {
    const x = X(ts(p[1])), y = Y(Math.max(1, p[2])), big = p[2] >= 7;
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${big ? 5 : 3.2}" class="${big ? "st-dot-major" : "st-dot"}"><title>${esc(p[0])} · ${p[1]} · ${fmtX(p[2])}× ${t.txt("tip_peak")}</title></circle>`;
  }
  let labs = "";
  const over = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  for (const p of D.pts.filter((q) => q[2] >= D.lines.l300).sort((a, b) => b[2] - a[2])) {
    const cx = X(ts(p[1])), cy = Y(p[2]), txt = `${p[0]} ${fmtX(p[2])}×`, w = txt.length * 6.9 + 2;
    const cand = [[cx + 9, cy + 4, "start"], [cx - 9, cy + 4, "end"], [cx + 9, cy - 9, "start"], [cx - 9, cy - 9, "end"], [cx + 9, cy + 17, "start"], [cx - 9, cy + 17, "end"], [cx + 9, cy - 22, "start"], [cx - 9, cy - 22, "end"]];
    for (const [lx, ly, a] of cand) {
      const b = a === "start" ? [lx, ly - 11, lx + w, ly + 3] : [lx - w, ly - 11, lx, ly + 3];
      if (b[0] < m.l + 2 || b[2] > W - m.r - 2 || b[1] < m.t - 2) continue;
      if (boxes.some((o) => over(o, b))) continue;
      boxes.push(b); labs += `<text class="st-lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${a}">${esc(txt)}</text>`; break;
    }
  }
  return s + dots + labs + "</svg>";
}

function quarters(t, D) {
  const W = 520, H = 260, m = { l: 34, r: 6, t: 20, b: 28 };
  const Y = (v) => m.t + (1 - v / 100) * (H - m.t - m.b), bw = (W - m.l - m.r) / D.quarters.length;
  let s = `<svg class="st-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t.txt("f2_h")}" style="min-width:460px">`;
  for (const v of [0, 25, 50, 75, 100]) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="${v ? "st-grid" : "st-axis"}"/><text x="${m.l - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="st-t">${v}</text>`;
  D.quarters.forEach(([q, all, maj, part], i) => {
    const x = m.l + i * bw + bw * 0.18, w = bw * 0.64, base = all - maj, yb = Y(base), ya = Y(all);
    s += `<g><title>20${q.slice(0, 2)} ${q.slice(2)}${part ? "*" : ""}: ${esc(strip(t("tip_q", { all, major: maj })))}</title>`;
    if (base > 0) s += `<rect x="${x.toFixed(1)}" y="${yb.toFixed(1)}" width="${w.toFixed(1)}" height="${(Y(0) - yb).toFixed(1)}" class="st-dot-fill"/>`;
    if (maj > 0) s += `<rect x="${x.toFixed(1)}" y="${ya.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(2, yb - ya - 2).toFixed(1)}" rx="2" class="st-major-fill"/>`;
    s += `<text class="st-lbl" x="${(x + w / 2).toFixed(1)}" y="${(ya - 6).toFixed(1)}" text-anchor="middle">${all}</text><text class="st-t" x="${(x + w / 2).toFixed(1)}" y="${H - m.b + 16}" text-anchor="middle">${q}${part ? "*" : ""}</text>`;
    s += `<rect x="${(m.l + i * bw).toFixed(1)}" y="${m.t}" width="${bw.toFixed(1)}" height="${H - m.t - m.b}" fill="transparent"/></g>`;
  });
  return s + "</svg>";
}

function scenario(t, D) {
  const rows = D.scen.map((r) => {
    const two = (r.two / 16).toFixed(4), one = (r.one / 16).toFixed(4);
    return `<div class="st-srow${r.v197 ? " is-v197" : ""}">
      <div class="st-nm">${t.txt(r.k + "_n")}${r.v197 ? ` <span class="badge b-ok">${t.txt("badge_v197")}</span>` : ""}<small>${t(r.k + "_d")}</small></div>
      <div class="st-bars">
        <div class="st-track" title="${t.txt("lg_two")}: ${r.two}"><i class="st-fill two" style="--v:${two}"></i><b style="--v:${two}">${r.two}</b></div>
        <div class="st-track" title="${t.txt("lg_one")}: ${r.one}"><i class="st-fill one" style="--v:${one}"></i><b style="--v:${one}">${r.one}</b></div>
      </div>
      <div class="st-exp">${r.exp.toFixed(2)}</div></div>`;
  }).join("");
  return `<div class="st-shead"><span>${t.txt("col_set")}</span><span>${t.txt("col_bar")}</span><span>${t.txt("col_exp")}</span></div>${rows}`;
}

function caseBars(t, D) {
  return D.caseBars.map((r) => `<div class="st-crow"><div class="st-nm">${t.txt(r.k)}</div>
    <div class="st-track st-ctrack" title="${t.txt(r.k)}: ${r.val}"><i class="st-fill ${r.ok ? "one" : "mute"}" style="--v:${r.v}"></i><b class="st-cval" style="--v:${r.v}">${r.val} <em>${t.txt(r.k + "_e")}</em></b></div></div>`).join("");
}

function table16(t, D) {
  const rows = D.pts.filter((p) => p[3]).sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const pc = (v) => (v > 0 ? v.toFixed(1) + "%" : "0");
  return `<details class="st-more"><summary>${t.txt("tb1_sum")}</summary>
    <p class="tiny muted mt-8">${t.txt("tb1_cap")}</p>
    ${wrapTbl(head(t.cols("tb1_cols"), 2) + `<tbody>${rows.map((p) => `<tr><td>${p[1]}</td><td><b>${esc(p[0])}</b></td><td class="num">${fmtX(p[2])}×</td>${p[3].map((v) => `<td class="num">${pc(v)}</td>`).join("")}</tr>`).join("")}</tbody>`)}</details>`;
}

// Three-column comparison: old rules | re-entry cap only (closest to the V19.7 default) | cap + stop-loss (tested, NOT the default).
// Values come from the combination table so the two can never disagree.
function kpiTable(t, D) {
  const nn = (s) => Number(String(s).replace(/,/g, ""));
  const cols = [[D.combo[0], "kc0", "kc0_s", "", ""], [D.combo[1], "kc1", "kc1_s", "is-v197", "kc1_b"], [D.combo[2], "kc2", "kc2_s", "is-tested", "kc2_b"]];
  const th = cols.map(([, k, s, cls, bk]) => `<th class="st-kth ${cls}"><b>${t.txt(k)}</b><small>${t.txt(s)}</small>${bk ? `<span class="badge ${cls === "is-v197" ? "b-ok" : "b-wait"}">${t.txt(bk)}</span>` : ""}</th>`).join("");
  const cell = (main, sub, cls = "") => `<td class="st-kc ${cls}"><b>${main}</b>${sub ? `<small>${sub}</small>` : ""}</td>`;
  const row = (label, f) => `<tr><th scope="row">${t.txt(label)}</th>${cols.map(([r, , , cls], i) => cell(...f(r, i, cls))).join("")}</tr>`;
  const rows = [
    row("kr1", (r, i) => [esc(sgn(r.ret)), i === 2 ? t.txt("kr_cut", { cut: sgn(D.kpi.cut) }) : "", tone(r.ret)]),
    row("kr2", (r) => [esc(r.mdd), t.txt("kr_low", { v: r.low })]),
    row("kr3", (r) => [esc(r.trap), ""]),
    row("kr4", (r, i) => [D.kpi.liq[i] == null ? `<span class="muted">${t.txt("kr_na")}</span>` : esc(D.kpi.liq[i]), ""]),
    row("kr5", (r) => [`${r.m.filter((v) => nn(v) > 0).length}/4`, t.txt("kr_months", { v: sgn(r.m.join(" / ")) })]),
  ].join("");
  return `<div class="tbl-wrap"><table class="tbl st-kt"><thead><tr><th></th>${th}</tr></thead><tbody>${rows}</tbody></table></div><p class="tiny muted mt-8">${t.txt("kr_def")}</p>`;
}

function trapped(t, D) {
  const body = D.trapped.map((r) => {
    const open = r[7] === "open";
    return `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td class="num loss">${r[2]}%</td><td class="num">${r[3]}×</td><td class="num">${r[4]}</td><td class="num">${r[5] ? esc(r[5]) : "—"}</td><td class="num${tone(r[6])}">${esc(sgn(r[6]))}${open ? ` <small class="muted">(${t.txt("dg_open")})</small>` : ""}</td></tr>`;
  }).join("");
  return wrapTbl(head(t.cols("dg_cols"), 2) + `<tbody>${body}</tbody>`);
}

function ruleTable(t, rows, cols, kind) {
  const body = rows.map((r) => {
    const badges = (r.tested ? ` <span class="badge b-wait">${t.txt("badge_tested")}</span>` : "") + (r.v197 ? ` <span class="badge b-ok">${t.txt("badge_v197_row")}</span>` : "");
    const lead = `<td>${t.txt("r_" + r.k)}${badges}</td>`;
    const cells = kind === "so"
      ? numCell(r.pnl, true) + numCell(r.ret, true) + (r.vs ? numCell(r.vs, true) : '<td class="num">—</td>') + numCell(r.mdd) + numCell(r.trig) + numCell(r.trap)
      : numCell(r.pnl, true) + numCell(r.ret, true) + numCell(r.mdd) + numCell(r.low) + numCell(r.trig) + numCell(r.trap);
    return `<tr class="${r.tested ? "st-hl-t" : r.v197 ? "st-hl-v" : ""}">${lead}${cells}${r.m.map((v) => numCell(v, true)).join("")}</tr>`;
  }).join("");
  return wrapTbl(head(cols, 1) + `<tbody>${body}</tbody>`, "st-wide");
}

function sixteen(t, D) {
  const S = D.sixteen;
  const rows = S.rows.map((r) => `<tr><td><b>${r[0]}</b></td><td class="num">${r[1]}×</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td>${numCell(r[4] + "%", true)}<td class="num">${r[5]}%</td>${numCell(r[6] + "%", true)}</tr>`).join("");
  const rest = S.rest;
  const pct = (s) => s.replace(/(\d)(?=\s|$)/g, "$1%");
  const restRow = `<tr><td><b>${t.txt("sx_rest")}</b><br><small class="muted">${esc(rest.coins)}</small></td><td class="num">${esc(rest.peak.replace("-", "–"))}×</td><td class="num">${esc(rest.entries.replace("-", "–"))}</td><td class="num">${esc(rest.stops.replace("-", "–"))}</td><td class="num">${esc(sgn(pct(rest.cum300)))}</td><td class="num">${esc(sgn(rest.worst))}%</td><td class="num">${esc(sgn(pct(rest.cum500)))}</td></tr>`;
  return wrapTbl(head(t.cols("sx_cols"), 1) + `<tbody>${rows}${restRow}</tbody>`);
}

function lskChart(t, D) {
  const L = D.lsk, W = L.w, H = L.h;
  let s = `<svg class="st-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t.txt("lk_aria")}" style="min-width:760px">`;
  for (const [y, lab] of L.gridY) s += `<line x1="${L.x0}" x2="${L.x1}" y1="${y}" y2="${y}" class="st-grid"/><text x="${L.x0 - 6}" y="${y + 4}" text-anchor="end" class="st-t">${lab}</text>`;
  for (const [x, lab] of L.gridX) s += `<line x1="${x}" x2="${x}" y1="${L.y0}" y2="${L.y1}" class="st-grid"/><text x="${x}" y="${L.y1 + 16}" text-anchor="middle" class="st-t">${lab}</text>`;
  s += `<rect x="${L.shade[0]}" y="${L.y0}" width="${L.shade[1]}" height="${L.y1 - L.y0}" class="st-shade"/>`;
  s += `<path d="${L.path}" fill="none" class="st-price"/>`;
  s += `<circle cx="${L.peak[0]}" cy="${L.peak[1]}" r="4" class="st-peak"/><text x="${L.peak[0] - 8}" y="${L.peak[1] + 4}" text-anchor="end" class="st-lbl st-bad">${t.txt("lk_peak")}</text>`;
  s += `<text x="710.7" y="187.1" text-anchor="end" class="st-t st-bad">${t.txt("lk_shade")}</text>`;
  const stopRow = Object.fromEntries(L.rows.filter((r) => r.o === "stop").map((r) => [r.n, r]));
  for (const k of L.marks) {
    if (k.tp) s += `<circle cx="${k.tp[0]}" cy="${k.tp[1]}" r="3.5" class="st-gain-dot"/>`;
    if (k.split) s += `<rect x="${(k.split[0] - 3.5).toFixed(1)}" y="${(k.split[1] - 3.5).toFixed(1)}" width="7" height="7" class="st-split"/>`;
    if (k.stop) {
      const [x, y] = k.stop;
      s += `<polygon points="${x},${y - 7} ${x + 7},${y} ${x},${y + 7} ${x - 7},${y}" class="st-split"/>`;
      const r = stopRow[k.n], lab = t.txt("lk_stoplab", { t: r.at.slice(-5), v: sgn(Math.round(Number(r.rep)).toString()) });
      s += k.n === 2 ? `<text x="${x + 10}" y="${y - 16}" class="st-lbl st-splitc">${lab}</text>` : `<text x="${x - 10}" y="${y - 9}" text-anchor="end" class="st-lbl st-splitc">${lab}</text>`;
    }
    s += `<circle cx="${k.x}" cy="${k.y}" r="5" class="${k.blocked ? "st-blk" : "st-ent"}"/><text x="${k.x}" y="${(k.y + 3.5).toFixed(1)}" text-anchor="middle" class="st-num${k.blocked ? " is-blk" : ""}">${k.n}</text>`;
  }
  s += `<text x="700" y="262" text-anchor="end" class="st-t">${t.txt("lk_blk")}</text>`;
  return s + "</svg>";
}

function lskTable(t, D) {
  const outcome = (r) => (r.o === "stop" ? t("lk_stop", { at: r.at }) : r.o === "tp" ? t("lk_tp") : r.o === "half" ? t("lk_half") : t("lk_blocked"));
  const cols = t.cols("lk_cols");
  const th = cols.map((c, i) => `<th${i === 3 || i === 5 ? ' class="num"' : ""}>${esc(c)}</th>`).join("");
  const body = D.lsk.rows.map((r) => `<tr><td class="num">${r.n}</td><td>${esc(r.ein)}</td><td>${r.eout === "open" ? t.txt("lk_open") : esc(r.eout)}</td>${numCell(r.real, true)}<td class="wrap-cell">${outcome(r)}</td>${numCell(r.rep, true)}</tr>`).join("");
  return wrapTbl(`<thead><tr>${th}</tr></thead><tbody>${body}</tbody>`, "st-lsk");
}

function lskKpis(t, D) {
  const S = D.lsk.sum;
  const tile = (k, v, s) => `<div class="st-kpi"><div class="k">${t.txt(k)}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="st-kpis st-k3">
    ${tile("lk_k1", `${esc(sgn(S.real))} <span class="arr">→</span> <span class="gain">${esc(sgn(S.rep))}</span>`, t.txt("lk_k1_s", { a: sgn(S.real), b: sgn(S.rep) }))}
    ${tile("lk_k2", `${S.peakTop} <span class="arr">→</span> <span class="gain">0.503</span>`, t.txt("lk_k2_s", { p: S.peakTop }))}
    ${tile("lk_k3", `${S.blocked}`, t.txt("lk_k3_s", { f: S.forgone }))}
  </div>`;
}

function engineTable(t, D) {
  const cols = t.cols("en_cols");
  const th = cols.map((c, i) => `<th${i >= 3 && i <= 8 && i !== 5 ? ' class="num"' : i === 1 ? ' class="num"' : ""}>${esc(c)}</th>`).join("");
  const body = D.engine.map((r) => `<tr><td><b>${r.c}</b></td><td class="num">${r.peak}×</td><td>${esc(r.win.replace(" to ", " – "))}</td><td class="num">${r.n}</td><td class="num">${r.stops}</td><td>${esc(sgn(r.each.replace(/^-$/, "–")))}</td>${numCell(r.net, true)}<td class="num">${esc(r.mae)}</td><td class="num">${r.capb ?? "–"}</td><td class="wrap-cell">${t.txt(r.pk === "ake" ? "en_pk_ake" : "en_pk_none")}</td></tr>`).join("");
  return wrapTbl(`<thead><tr>${th}</tr></thead><tbody>${body}</tbody>`, "st-wide");
}

// ── page body ─────────────────────────────────────────────────────────────
export function studyBody(lang, S, h) {
  const { D } = S, t = T(S.dict, lang), { href, ico, badge } = h;
  const E = D.expect;
  const li = (k, b, ok) => `<li>${ico("check")}<div>${t(k)}</div><span class="st-vb">${badge(ok ? "b-ok" : "b-off", t.txt(b))}</span></li>`;
  const legend = (items) => `<ul class="st-legend">${items.join("")}</ul>`;
  const dash = (cls, key) => `<li><span class="st-ldash ${cls}"></span>${t.txt(key)}</li>`;
  const sq = (cls, txt) => `<li><span class="st-lsq ${cls}"></span>${txt}</li>`;
  return `<div class="wrap page-head st-head">
  <span class="kicker">${t.txt("kicker")}</span>
  <h1>${t.txt("h1")}</h1>
  <p>${t("lead")}</p>
  <div class="chips mt-16"><span class="chip">${ico("chart")}${t.txt("chip1")}</span><span class="chip">${ico("info")}${t.txt("chip2")}</span><span class="chip">${ico("shield")}${t.txt("chip3")}</span></div>
  <nav class="st-toc" aria-label="${t.txt("note_h")}"><a href="#part1">${t.txt("toc_1")}</a><a href="#part2">${t.txt("toc_2")}</a><a href="#v197">${t.txt("toc_3")}</a></nav>
</div>

<section class="section-tight"><div class="wrap"><div class="st-note" role="note">
  <h2>${ico("info")}${t.txt("note_h")}</h2>
  <p>${t("note_1")} <a href="${href(lang, "exchange")}#backtest">${t.txt("note_link")}</a></p>
  <p>${t("note_2")}</p>
  <p>${t("note_3")}</p>
</div></div></section>

<section class="section-tight" id="part1"><div class="wrap">
  <div class="section-head"><div><h2>${t.txt("p1_h2")}</h2><p>${t("p1_lead")}</p></div></div>
  <div class="st-stats">
    <div><b>${E.total}</b><span>${t.txt("s1")}</span></div><div><b>${E.major}</b><span>${t.txt("s2")}</span></div>
    <div><b>${E.over300}</b><span>${t.txt("s3")}</span></div><div><b class="hl">${E.over500}</b><span>${t.txt("s4")}</span></div>
  </div>

  <div class="card card-pad st-fig mt-24"><h3>${t.txt("f1_h")}</h3><p class="small muted">${t.txt("f1_sub")}</p>
    ${legend([sq("st-dot-fill", t.txt("lg_under")), sq("st-major-fill", t.txt("lg_over")), dash("st-l300-b", "lg_l300"), dash("st-l500-b", "lg_l500")])}
    <div class="st-scroll">${timeline(t, D)}</div></div>

  <div class="grid g2 mt-16">
    <div class="card card-pad st-fig"><h3>${t.txt("f2_h")}</h3><p class="small muted">${t.txt("f2_sub")}</p>
      ${legend([sq("st-dot-fill", t.txt("lg_under")), sq("st-major-fill", t.txt("lg_over"))])}
      <div class="st-scroll">${quarters(t, D)}</div></div>
    <div class="card card-pad st-fig"><h3>${t.txt("f4_h")}</h3><p class="small muted">${t.txt("f4_sub")}</p>
      <div class="st-case">${caseBars(t, D)}</div></div>
  </div>

  <div class="card card-pad st-fig mt-16"><h3>${t.txt("f3_h")}</h3><p class="small muted">${t.txt("f3_sub")}</p>
    ${legend([sq("st-two", t.txt("lg_two")), sq("st-one", t.txt("lg_one"))])}
    <div class="st-scen">${scenario(t, D)}</div>
    <p class="tiny muted mt-8">${t.txt("f3_exp")}</p>
    <p class="small mt-8">${t("f3_note")}</p>
    ${table16(t, D)}
  </div>

  <details class="card card-pad st-method mt-16"><summary>${t.txt("m_h")}</summary>
    <ul>${["m1", "m2", "m3", "m4", "m5"].map((k) => `<li>${t(k)}</li>`).join("")}</ul></details>
</div></section>

<section class="section-tight" id="part2"><div class="wrap">
  <div class="section-head"><div><h2>${t.txt("p2_h2")}</h2><p>${t("p2_lead")}</p></div></div>

  <div class="card card-pad prose st-find"><h3>${t.txt("fd_h")}</h3>
    <ol><li>${t("fd1")}</li><li>${t("fd2")}</li><li>${t("fd3")}</li><li>${t("fd4")}</li></ol></div>

  <h3 class="st-h3 mt-24">${t.txt("kp_h")}</h3>
  ${kpiTable(t, D)}
  <div class="st-warn mt-16" role="note">${ico("alert")}<p>${t("kp_warn")}</p></div>

  <div class="card card-pad st-fig mt-24"><h3>${t.txt("dg_h")}</h3><p class="small muted">${t.txt("dg_sub")}</p>${trapped(t, D)}
    <p class="small mt-8">${t("dg_why")}</p></div>

  <div class="card card-pad st-fig mt-16"><h3>${t.txt("so_h")}</h3><p class="small muted">${t.txt("so_sub")}</p>
    ${ruleTable(t, D.stopOnly, t.cols("so_cols"), "so")}<p class="tiny muted mt-8">${t.txt("tb_units")}</p><p class="small mt-8">${t("so_read")}</p></div>

  <div class="card card-pad st-fig mt-16" id="combo"><h3>${t.txt("cb_h")}</h3><p class="small muted">${t.txt("cb_sub")}</p>
    ${ruleTable(t, D.combo, t.cols("cb_cols"), "cb")}<p class="tiny muted mt-8">${t.txt("tb_units")}</p><p class="small mt-8">${t("cb_read")}</p></div>

  <div class="card card-pad st-fig mt-16"><h3>${t.txt("sx_h")}</h3><p class="small muted">${t("sx_sub")}</p>
    ${sixteen(t, D)}<p class="small mt-8">${t("sx_total")}</p></div>

  <div class="card card-pad st-fig mt-16"><h3>${t.txt("lk_h")}</h3><p class="small muted">${t.txt("lk_sub")}</p>
    ${legend([
      `<li><span class="st-lc st-ent"></span>${t.txt("lk_lgreal")}</li>`, `<li><span class="st-lc st-blk"></span>${t.txt("lk_lgblk")}</li>`,
      sq("st-split-b", t.txt("lk_lgsplit")), `<li><span class="st-ld st-split-b"></span>${t.txt("lk_lgstop")}</li>`, `<li><span class="st-lc st-gain-b"></span>${t.txt("lk_lgtp")}</li>`])}
    <div class="st-scroll">${lskChart(t, D)}</div>${lskTable(t, D)}${lskKpis(t, D)}</div>

  <div class="card card-pad st-fig mt-16"><h3>${t.txt("en_h")}</h3><p class="small muted">${t("en_sub")}</p>
    ${engineTable(t, D)}
    <div class="st-kpis st-k3 mt-16">
      <div class="st-kpi"><div class="k">${t.txt("en_k1")}</div><div class="v"><span class="gain">0 · 0</span></div><div class="s">${t.txt("en_k1_s")}</div></div>
      <div class="st-kpi"><div class="k">${t.txt("en_k2")}</div><div class="v">${D.engineSum.stopLoss.replace("-", "–")}%</div><div class="s">${t.txt("en_k2_s", { v: D.engineSum.stopLoss.replace("-", "–") + "%" })}</div></div>
      <div class="st-kpi"><div class="k">${t.txt("en_k3")}</div><div class="v">0–3</div><div class="s">${t.txt("en_k3_s")}</div></div>
    </div>
    <p class="small mt-16">${t("en_note")}</p><p class="small mt-8 st-ver">${t("en_v")}</p></div>

  <div class="card card-pad mt-16"><h3>${t.txt("lm_h")}</h3><ul class="st-lim">${["lm1", "lm6", "lm7", "lm2", "lm3", "lm4", "lm5"].map((k) => `<li>${t(k)}</li>`).join("")}</ul></div>
</div></section>

<section class="section-tight" id="v197"><div class="wrap"><div class="st-v197">
  <div class="st-v197-head"><span class="st-ver-tag">V19.7</span><div><h2>${t.txt("v_h")}</h2><p>${t("v_lead")}</p></div></div>
  <ul class="st-vlist">${li("v1", "b_on", true)}${li("v3", "b_on", true)}${li("v4", "b_on", true)}${li("v6", "b_on", true)}${li("v2", "b_nt", false)}${li("v5", "b_nt", false)}${li("v7", "b_opt", false)}</ul>
  <p class="small mt-16">${t.txt("v_shadow")}</p>
  <div class="acts mt-16"><a class="btn btn-primary" href="${href(lang, "download")}">${ico("download")}${t.txt("v_cta")}</a><a class="btn btn-outline" href="${href(lang, "exchange")}">${t.txt("v_cta2")}</a><a class="btn btn-ghost" href="${href(lang, "risk-disclosure")}">${t.txt("v_cta3")}</a></div>
</div></div></section>`;
}
