/* JaviD Future Bot — site script. No framework, no tracking library.
   Page strings come from window.JFB (written by the build per language). */
(function () {
  "use strict";
  var J = window.JFB || { lang: "en", t: {} };
  function t(k, vars) {
    var s = (J.t && J.t[k]) || k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split("{" + n + "}").join(vars[n]); });
    return s;
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ── 1. download attribution ─────────────────────────────────────────────
     Download buttons point at each exchange worker's /api/download. That worker
     logs r/us/um/uc/lp (referrer host, utm source/medium/campaign, landing path).
     The first-visit source is captured in <head> (sessionStorage "jfb_src");
     here we append it at click time, in the capture phase, so links filled in
     later are covered too. The href is only rewritten, never prevented. */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[data-dl]") : null;
    if (!a) return;
    try {
      var s = JSON.parse(sessionStorage.getItem("jfb_src") || "{}");
      var u = new URL(a.getAttribute("href"), location.href);
      if (s.r) u.searchParams.set("r", s.r);
      if (s.us) u.searchParams.set("us", s.us);
      if (s.um) u.searchParams.set("um", s.um);
      if (s.uc) u.searchParams.set("uc", s.uc);
      u.searchParams.set("lp", (s.lp || location.pathname).slice(0, 64));
      a.setAttribute("href", u.toString());
    } catch (err) { /* never block the download */ }
  }, true);

  /* ── 2. header: mobile menu + language ───────────────────────────────── */
  var mb = $(".menu-btn"), mnav = $("#mnav");
  if (mb && mnav) {
    mb.addEventListener("click", function () {
      var open = mnav.classList.toggle("open");
      mb.setAttribute("aria-expanded", open ? "true" : "false");
      mb.setAttribute("aria-label", open ? t("nav_close") : t("nav_menu"));
    });
  }
  $$("select[data-lang-switch]").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var opt = sel.options[sel.selectedIndex];
      var href = opt && opt.getAttribute("data-href");
      if (href) location.href = href + location.search + location.hash;
    });
  });

  /* ── 3. exchange tabs (download / exchange pages) ─────────────────────── */
  function params() { try { return new URLSearchParams(location.search); } catch (e) { return null; } }
  $$("[data-tabs]").forEach(function (box) {
    var tabs = $$("[role=tab]", box);
    var root = box.closest("[data-tabroot]") || document;
    function select(id, push) {
      var found = false;
      tabs.forEach(function (tb) {
        var on = tb.getAttribute("data-ex") === id;
        if (on) found = true;
        tb.setAttribute("aria-selected", on ? "true" : "false");
        tb.setAttribute("tabindex", on ? "0" : "-1");
      });
      if (!found) return false;
      $$("[data-panel]", root).forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== id; });
      if (push) {
        try { var q = params(); q.set("exchange", id); history.replaceState(null, "", location.pathname + "?" + q.toString() + location.hash); } catch (e) {}
      }
      document.dispatchEvent(new CustomEvent("jfb:exchange", { detail: id }));
      return true;
    }
    tabs.forEach(function (tb, i) {
      tb.addEventListener("click", function (e) { e.preventDefault(); select(tb.getAttribute("data-ex"), true); });
      tb.addEventListener("keydown", function (e) {
        var k = e.key, j = -1;
        if (k === "ArrowRight") j = (i + 1) % tabs.length;
        else if (k === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
        if (j >= 0) { e.preventDefault(); tabs[j].focus(); select(tabs[j].getAttribute("data-ex"), true); }
      });
    });
    var q = params(), want = q && q.get("exchange");
    if (!(want && select(want, false))) select(box.getAttribute("data-default"), false);
  });

  /* visitors redirected from an exchange subdomain (bg./bn./bb./okx.) arrive with ?exchange= :
     mark that exchange's card on the home page */
  (function () {
    var q = params(), ex = q && q.get("exchange");
    var card = ex && document.querySelector('[data-ex-card="' + ex.replace(/[^a-z]/g, "") + '"]');
    if (card) card.classList.add("picked");
  })();

  /* ── 4. time helpers ──────────────────────────────────────────────────── */
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    var abs;
    try { abs = new Intl.DateTimeFormat(J.lang, { dateStyle: "medium", timeStyle: "short" }).format(d); }
    catch (e) { abs = d.toISOString().replace("T", " ").slice(0, 16) + " UTC"; }
    var mins = Math.round((Date.now() - d.getTime()) / 60000), rel;
    if (mins < 2) rel = t("time_now");
    else if (mins < 60) rel = t("ago_min", { n: mins });
    else if (mins < 60 * 48) rel = t("ago_h", { n: Math.round(mins / 60) });
    else rel = t("ago_d", { n: Math.round(mins / 1440) });
    return abs + " (" + rel + ")";
  }
  function num(v, dp) {
    try { return new Intl.NumberFormat(J.lang, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v); }
    catch (e) { return v.toFixed(dp); }
  }
  function signed(v, dp) { return (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v), dp); }

  /* ── 5. live captures + metrics ───────────────────────────────────────── */
  var liveBoxes = $$("[data-live]");
  if (liveBoxes.length) {
    fetch("/api/live-capture/latest", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (m) { liveBoxes.forEach(function (box) { renderLive(box, m); }); })
      .catch(function () { liveBoxes.forEach(function (box) { renderLive(box, { error: true }); }); });
  }

  function placeholder(box, msg) {
    $$("[data-shot]", box).forEach(function (s) { s.innerHTML = '<div class="ph">' + esc(msg) + "</div>"; });
  }

  var DIV = { MAX: 100, HIGH: 200, AGGRESSIVE: 300, NORMAL: 500, STABLE: 700 };
  function renderLive(box, m) {
    var status = $("[data-live-status]", box);
    if (m.error) { placeholder(box, t("perf_error")); if (status) status.textContent = ""; hideMetrics(box); return; }
    if (!m.available) { placeholder(box, t("perf_none")); if (status) status.textContent = ""; hideMetrics(box); return; }
    var views = m.views || {};
    $$("[data-shot]", box).forEach(function (s) {
      var v = s.getAttribute("data-shot") || "dashboard", info = views[v];
      if (!info) { s.innerHTML = '<div class="ph">' + esc(t("perf_none")) + "</div>"; return; }
      var alt = t("hero_shot_alt") + " — " + t(v === "positions" ? "view_positions" : "view_dashboard");
      s.innerHTML = '<a href="' + esc(info.url) + '" target="_blank" rel="noopener" title="' + esc(t("perf_zoom")) + '"><img src="' + esc(info.url) +
        '" alt="' + esc(alt) + '" width="' + (info.width || 1600) + '" height="' + (info.height || 1000) + '" decoding="async"></a>';
    });
    if (status) status.textContent = t("perf_captured", { time: fmtTime(m.captured_at) });
    var st = $("[data-live-stale]", box);
    if (st) { st.hidden = !m.stale; if (m.stale) st.textContent = t("perf_stale", { time: fmtTime(m.captured_at) }); }
    var op = $("[data-open-count]", box);
    if (op) { var k = m.account && m.account.open_positions; op.hidden = k == null; if (k != null) op.textContent = t("m_open", { k: num(k, 0) }); }
    var se = $("[data-settings]", box), cfg = m.account && m.account.settings;
    if (se) {
      se.hidden = !cfg;
      if (cfg) {
        var mode = String(cfg.investment_mode || "").toUpperCase();
        var div = cfg.investment_divisor || DIV[mode] || "?";
        se.textContent = t("m_settings", { mode: mode.charAt(0) + mode.slice(1).toLowerCase(), div: div, lev: cfg.leverage,
          hs: t(cfg.hard_stop ? "hs_on" : "hs_off"), entry: cfg.entry_mode || "-" });
      }
    }
    if ($("[data-metrics]", box)) renderMetrics(box, m.metrics);
    if ($("[data-trades]", box)) renderTrades(box, m.metrics);
  }

  function hideMetrics(box) {
    $$("[data-metrics-wrap]", box).forEach(function (w) { w.hidden = true; });
  }

  function aggregate(days) {
    var a = { trades: 0, wins: 0, losses: 0, flat: 0, realized: 0, funding: 0, worst: null, down: 0, n: days.length };
    days.forEach(function (d) {
      a.trades += d.trades || 0; a.wins += d.wins || 0; a.losses += d.losses || 0; a.flat += d.flat || 0;
      a.realized += (d.pnl || 0) + (d.funding || 0); a.funding += d.funding || 0;
      if (d.worst != null && (a.worst == null || d.worst < a.worst)) a.worst = d.worst;
      if ((d.pnl || 0) + (d.funding || 0) < 0) a.down++;
    });
    return a;
  }

  function renderMetrics(box, mt) {
    var wrap = $("[data-metrics-wrap]", box);
    if (!mt || !mt.daily || !mt.daily.length) {
      if (wrap) { wrap.hidden = false; wrap.innerHTML = '<p class="muted small">' + esc(t("m_unavailable")) + "</p>"; }
      return;
    }
    if (wrap) wrap.hidden = false;
    var all = mt.daily.slice().sort(function (x, y) { return x.d < y.d ? -1 : 1; });
    var period = "all";
    function slice(p) {
      if (p === "all") return all;
      var n = { "7": 7, "30": 30, "90": 90 }[p];
      var last = all[all.length - 1].d;
      var cut = new Date(last + "T00:00:00Z"); cut.setUTCDate(cut.getUTCDate() - (n - 1));
      var c = cut.toISOString().slice(0, 10);
      return all.filter(function (d) { return d.d >= c; });
    }
    function draw() {
      var days = slice(period), a = aggregate(days);
      var el = $("[data-metrics]", box);
      var cards = [
        [t("m_trades"), num(a.trades, 0), ""],
        [t("m_wins"), t("m_wins_val", { w: num(a.wins, 0), n: num(a.trades, 0) }), ""],
        [t("m_realized"), signed(a.realized, 2) + "<small>USDT</small>", a.realized >= 0 ? "gain" : "loss"],
        [t("m_worst"), a.worst == null ? "—" : signed(a.worst, 2) + "<small>USDT</small>", a.worst != null && a.worst < 0 ? "loss" : ""],
        [t("m_down"), t("m_down_val", { d: num(a.down, 0), n: num(a.n, 0) }), ""],
        [t("m_funding"), signed(a.funding, 2) + "<small>USDT</small>", a.funding < 0 ? "loss" : ""]
      ];
      el.innerHTML = cards.map(function (c) {
        return '<div class="metric"><div class="k">' + esc(c[0]) + '</div><div class="v ' + c[2] + '">' + c[1] + "</div></div>";
      }).join("");
      var pl = $("[data-period-label]", box);
      if (pl && days.length) pl.textContent = t("m_period", { from: days[0].d, to: days[days.length - 1].d });
      drawChart($("[data-chart]", box), days);
    }
    $$("[data-period]", box).forEach(function (b) {
      b.addEventListener("click", function () {
        period = b.getAttribute("data-period");
        $$("[data-period]", box).forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        draw();
      });
    });
    draw();
  }

  function drawChart(el, days) {
    if (!el) return;
    if (!days.length) { el.innerHTML = ""; return; }
    var pts = [], cum = 0;
    days.forEach(function (d) { cum += (d.pnl || 0) + (d.funding || 0); pts.push({ d: d.d, v: cum }); });
    var W = 800, H = 260, L = 56, R = 12, T = 12, B = 28;
    var vals = pts.map(function (p) { return p.v; }).concat([0]);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.08; hi += pad; lo = Math.min(lo, 0) - (lo < 0 ? pad : 0);
    function x(i) { return L + (pts.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (pts.length - 1)); }
    function y(v) { return T + (hi - v) * (H - T - B) / (hi - lo); }
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1); }).join(" ");
    var area = line + " L" + x(pts.length - 1).toFixed(1) + " " + y(Math.max(lo, 0)).toFixed(1) + " L" + x(0).toFixed(1) + " " + y(Math.max(lo, 0)).toFixed(1) + " Z";
    var grid = "", ticks = 4;
    for (var k = 0; k <= ticks; k++) {
      var v = lo + (hi - lo) * k / ticks, yy = y(v);
      grid += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>' +
        '<text class="axis" x="' + (L - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + esc(num(v, 0)) + "</text>";
    }
    var lab = "", step = Math.max(1, Math.ceil(pts.length / 6));
    for (var i = 0; i < pts.length; i += step) lab += '<text class="axis" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(pts[i].d.slice(5)) + "</text>";
    var last = pts[pts.length - 1];
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(t("chart_aria")) + '">' +
      '<defs><linearGradient id="jfbA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10b981" stop-opacity=".22"/><stop offset="1" stop-color="#10b981" stop-opacity="0"/></linearGradient></defs>' +
      grid + '<path d="' + area + '" fill="url(#jfbA)"/><path d="' + line + '" fill="none" stroke="#059669" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' +
      '<circle cx="' + x(pts.length - 1).toFixed(1) + '" cy="' + y(last.v).toFixed(1) + '" r="3.5" fill="#047857"/>' + lab + "</svg>";
  }

  function renderTrades(box, mt) {
    var el = $("[data-trades]", box);
    var rows = (mt && mt.recent_trades) || [];
    if (!rows.length) { el.closest("[data-trades-wrap]").hidden = true; return; }
    el.closest("[data-trades-wrap]").hidden = false;
    el.innerHTML = rows.map(function (r) {
      var cls = r.pnl > 0 ? "gain" : r.pnl < 0 ? "loss" : "";
      return "<tr><td>" + esc(r.t) + "</td><td>" + esc(r.s) + "</td><td>" + esc(r.side) + '</td><td class="num ' + cls + '">' + signed(r.pnl, 2) +
        '</td><td class="num ' + cls + '">' + (r.roe == null ? "—" : signed(r.roe, 2) + "%") + "</td></tr>";
    }).join("");
  }

  /* ── 6. community board ───────────────────────────────────────────────── */
  var board = $("[data-board]");
  if (board) {
    var list = $("[data-board-list]", board);
    var ua = { Accept: "application/json" };
    function postHtml(p) {
      var when = p.created_at ? fmtTime(p.created_at) : "";
      var body = p.is_secret && p.content == null
        ? '<div class="body muted">🔒 ' + esc(t("bd_secret_label")) + '</div><form class="row mt-8" data-open="' + p.id + '"><input type="password" required aria-label="' +
          esc(t("bd_password")) + '" placeholder="' + esc(t("bd_password")) + '" style="max-width:220px;font:inherit;border:1px solid var(--line-2);border-radius:8px;padding:7px 10px"><button class="btn btn-ghost btn-sm" type="submit">' + esc(t("bd_open")) + "</button></form>"
        : '<div class="body">' + esc(p.content) + "</div>";
      var reply = p.reply ? '<div class="reply"><b>' + esc(t("bd_reply")) + "</b>\n" + esc(p.reply) + "</div>" : "";
      return '<article class="card post" id="post-' + p.id + '"><div class="hd"><b>' + esc(p.name) + "</b><span>" + esc(when) + "</span></div>" + body + reply + "</article>";
    }
    function load() {
      list.innerHTML = '<p class="muted">' + esc(t("bd_loading")) + "</p>";
      fetch("/api/board/posts", { headers: ua }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
        var posts = (d && (d.posts || d.items || d)) || [];
        if (!Array.isArray(posts) || !posts.length) { list.innerHTML = '<p class="empty">' + esc(t("bd_empty")) + "</p>"; return; }
        list.innerHTML = posts.map(postHtml).join("");
      }).catch(function () { list.innerHTML = '<p class="muted">' + esc(t("bd_error")) + "</p>"; });
    }
    list.addEventListener("submit", function (e) {
      var f = e.target.closest("form[data-open]");
      if (!f) return;
      e.preventDefault();
      var id = f.getAttribute("data-open"), pw = $("input", f).value;
      fetch("/api/board/posts/" + encodeURIComponent(id) + "?password=" + encodeURIComponent(pw), { headers: ua })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (d) { var p = d.post || d; if (p.content == null) throw 0; var art = $("#post-" + id); if (art) art.outerHTML = postHtml(p); })
        .catch(function () { alert(t("bd_wrong_pw")); });
    });
    var form = $("[data-board-form]", board);
    if (form) {
      var secret = $("[name=is_secret]", form), pwRow = $("[data-pw-row]", form);
      if (secret && pwRow) secret.addEventListener("change", function () { pwRow.hidden = !secret.checked; });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var msg = $("[data-board-msg]", form);
        var body = { name: form.name.value.trim(), content: form.content.value.trim(), secret: !!(secret && secret.checked), password: form.password ? form.password.value : "" };
        fetch("/api/board/posts", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) })
          .then(function (r) { if (!r.ok) throw 0; return r.json(); })
          .then(function () { msg.textContent = t("bd_posted"); msg.style.color = "var(--green-700)"; form.reset(); if (pwRow) pwRow.hidden = true; load(); })
          .catch(function () { msg.textContent = t("bd_post_error"); msg.style.color = "var(--loss)"; });
      });
    }
    load();
  }
})();
