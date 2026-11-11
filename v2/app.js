/* Aatrox — phone app for the Aatrox Capital scorecard.
   Reads the engine's output files from the private repo through GitHub's API with a read-only
   token that lives only on this device. Nothing in this public code contains data. */
"use strict";

const APP_VERSION = "v2";   // V2 beta; V1 lives one folder up
const REPO = "Kayzield909/aatrox-capital";
const API = `https://api.github.com/repos/${REPO}`;
const FILES = {
  scores: "output/watchlist_scores.json",
  setups: "output/swing_setups.json",
  holdings: "output/holdings_scan_dash.json",
  log: "SIGNAL_LOG.md",
  sync: "data/t212_sync.md",
  sparks: "output/sparklines.json",
  alerts: "output/alerts.json",
  mood: "output/mood.json",
  notes: "output/mood_notes.json",
  logos: "output/logos.json",
  cleanup: "output/pie_cleanup.json",
  reviews: "output/review_scores.json"
};
const LINKS = {
  sync: "https://github.com/Kayzield909/aatrox-capital/actions/workflows/t212-sync.yml",
  dashboard: "https://claude.ai/artifact/TcP9PAnqqYBuxmdXHWeQTT",
  t212: "https://app.trading212.com/",
  repo: "https://github.com/Kayzield909/aatrox-capital",
  secret: "https://github.com/Kayzield909/aatrox-capital/settings/secrets/actions/new",
  testPush: "https://github.com/Kayzield909/aatrox-capital/actions/workflows/test-push.yml",
  newToken: "https://github.com/settings/personal-access-tokens/new"
};
const TABS = { signals: "Signals", swing: "Swing", holdings: "Holdings", alerts: "Alerts", log: "Log" };

// ---------- tiny DOM helpers (textContent only: no data ever goes through innerHTML) ----------
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

// ---------- formatting ----------
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dShort = d => d ? `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}` : "";
const dLong = d => d ? `${dShort(d)} ${d.slice(0, 4)}` : "";
function money(v, ccy) {
  if (v == null) return "n/a";
  const n = Math.abs(v) >= 1000 ? v.toLocaleString("en-GB", { maximumFractionDigits: 0 }) : v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (ccy === "GBX" || ccy === "GBp") return n + "p";
  if (ccy === "GBP") return "£" + n;
  if (ccy === "EUR") return "€" + n;
  return "$" + n;
}
const num = (v, d = 1) => v == null ? "n/a" : Number(v).toFixed(d);
const pct = (v, d = 1) => v == null ? "" : (v > 0 ? "+" : "") + Number(v).toFixed(d) + "%";
const GROUP = {
  "BUY WINDOW": "buy", "WATCH": "watch", "HOLD": "hold", "WAIT": "hold",
  "TRIM REVIEW": "trim", "OVERPRICED": "trim", "SELL WARNING": "sell", "AVOID": "sell"
};
const COL = { buy: "#5fbf7a", watch: "#e9e2da", hold: "#8c7f77", trim: "#e4b550", sell: "#e5604a" };
const GROUP_LABEL = { buy: "Buy window", watch: "Watch", hold: "Hold / wait", trim: "Trim / overpriced", sell: "Sell / avoid" };
const GROUP_ORDER = ["buy", "watch", "hold", "trim", "sell"];
const SIG_LABEL = s => ({ "BUY WINDOW": "Buy window", "WATCH": "Watch", "HOLD": "Hold", "WAIT": "Wait", "TRIM REVIEW": "Trim review",
  "OVERPRICED": "Overpriced", "SELL WARNING": "Sell warning", "AVOID": "Avoid" }[s] || s);
const pill = (signal) => h("span", { class: "pill g-" + (GROUP[signal] || "hold") }, SIG_LABEL(signal));
const SCAN_GROUP = { "SELL WARNING": "sell", "ONE FLAG": "trim", "CLEAR": "buy", "NO DATA": "hold", "WATCHLIST": "watch" };
const SCAN_LABEL = { "SELL WARNING": "Sell warning", "ONE FLAG": "One flag", "CLEAR": "Clear", "NO DATA": "No data", "WATCHLIST": "On watchlist" };

// ---------- state ----------
const state = {
  token: store.get("aatrox-token"),
  data: null, fetchedAt: null, loading: false,
  tab: "signals", sigGroup: null, theme: "all", holdFilter: "flagged", holdQuery: "", pie: null
};
try {
  const c = JSON.parse(store.get("aatrox-data") || "null");
  if (c && c.files) { state.data = c.files; state.fetchedAt = c.fetchedAt; }
} catch (e) {}

// ---------- shortcuts that leave the app, and the V1/V2 switch ----------
(function () {
  const q = new URLSearchParams(location.search);
  const go = q.get("go");
  if (go && LINKS[go]) { location.replace(LINKS[go]); return; }
  const want = store.get("aatrox-version") || "v1";
  if (want !== APP_VERSION) location.replace((APP_VERSION === "v1" ? "v2/" : "../") + location.search + location.hash);
})();
function switchVersion(v) {
  store.set("aatrox-version", v);
  if (v !== APP_VERSION) location.href = (APP_VERSION === "v1" ? "v2/" : "../") + "#log";
}

// ---------- data ----------
async function gh(path, token) {
  const r = await fetch(`${API}/contents/${path}?ref=main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store", referrerPolicy: "no-referrer"
  });
  if (r.status === 401) throw Object.assign(new Error("The token was refused. It may have expired or been revoked."), { auth: true });
  if (r.status === 403 || r.status === 404) throw Object.assign(new Error("The token can't read aatrox-capital. Check it has this repo and Contents: Read-only."), { auth: true });
  if (!r.ok) throw new Error(`GitHub returned ${r.status}`);
  return r.text();
}
async function loadAll(token) {
  const out = {};
  await Promise.all(Object.entries(FILES).map(async ([k, p]) => {
    try { out[k] = await gh(p, token); }
    catch (e) { if (e.auth || k === "scores") throw e; out[k] = null; }
  }));
  return {
    scores: JSON.parse(out.scores),
    setups: out.setups ? JSON.parse(out.setups) : [],
    holdings: out.holdings ? JSON.parse(out.holdings) : [],
    log: out.log || "", sync: out.sync || "",
    sparks: out.sparks ? JSON.parse(out.sparks) : {},
    alerts: out.alerts ? JSON.parse(out.alerts) : [],
    mood: out.mood ? JSON.parse(out.mood) : null,
    notes: out.notes ? JSON.parse(out.notes) : null,
    logos: out.logos ? JSON.parse(out.logos) : {},
    cleanup: out.cleanup ? JSON.parse(out.cleanup) : { pies: [] },
    reviews: out.reviews ? JSON.parse(out.reviews) : { scores: {} }
  };
}
async function refresh(manual) {
  if (state.loading || !state.token) return;
  state.loading = true; $("#refresh").classList.add("spin");
  try {
    const before = unreadCount();
    const files = await loadAll(state.token);
    state.data = files; state.fetchedAt = new Date().toISOString();
    const after = unreadCount();
    if (after > before && before >= 0) playAlert(files.alerts.slice(0, after));
    store.set("aatrox-data", JSON.stringify({ files, fetchedAt: state.fetchedAt }));
    banner(null);
    render(false);
  } catch (e) {
    if (e.auth) { banner(e.message + " Open Log → Connection to replace it."); }
    else banner(state.data ? `Offline: showing data from ${fmtFetched()}.` : "Couldn't reach GitHub. Check your connection and pull down to retry.");
    if (!state.data) render(false);
  } finally {
    state.loading = false; $("#refresh").classList.remove("spin");
  }
}
function fmtFetched() {
  if (!state.fetchedAt) return "earlier";
  const d = new Date(state.fetchedAt);
  return `${dShort(state.fetchedAt.slice(0, 10))}, ${d.toTimeString().slice(0, 5)}`;
}
// Daily closes for one stock (5 years), fetched when its sheet opens; cached on the phone.
const seriesMem = {};
async function loadSeries(ticker) {
  const asof = state.data && state.data.scores[0] ? state.data.scores[0].as_of : "";
  if (seriesMem[ticker] && seriesMem[ticker].asof === asof) return seriesMem[ticker].rows;
  try {
    const c = JSON.parse(store.get("aatrox-series-" + ticker) || "null");
    if (c && c.asof === asof) { seriesMem[ticker] = c; return c.rows; }
  } catch (e) {}
  const txt = await gh(`data/daily/${ticker}.csv`, state.token);
  const rows = txt.trim().split("\n").map(l => l.split(",")).filter(p => p.length === 2)
    .map(([d, c]) => ({ d, c: Number(c) })).reverse();
  const entry = { asof, rows };
  seriesMem[ticker] = entry;
  store.set("aatrox-series-" + ticker, JSON.stringify(entry));
  return rows;
}
function banner(msg) { const b = $("#banner"); b.textContent = msg || ""; b.classList.toggle("hidden", !msg); }

// ---------- onboarding ----------
function showOnboarding(err) {
  $("#app").classList.add("hidden");
  const o = $("#onboard"); o.classList.remove("hidden"); o.textContent = "";
  const input = h("input", { type: "password", placeholder: "github_pat_…", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "GitHub token" });
  const msg = h("div", { class: "err", role: "alert" }, err || "");
  const go = h("button", { class: "btn primary", type: "button" }, "Connect");
  go.addEventListener("click", async () => {
    const t = input.value.trim();
    if (!t) { msg.textContent = "Paste the token first."; return; }
    go.textContent = "Checking…"; go.disabled = true; msg.textContent = "";
    try {
      const files = await loadAll(t);
      state.token = t; store.set("aatrox-token", t);
      state.data = files; state.fetchedAt = new Date().toISOString();
      store.set("aatrox-data", JSON.stringify({ files, fetchedAt: state.fetchedAt }));
      o.classList.add("hidden"); showApp();
    } catch (e) { msg.textContent = e.message; go.textContent = "Connect"; go.disabled = false; }
  });
  o.append(
    markSvg("big"),
    h("h1", null, "Connect Aatrox"),
    h("p", null, "The app reads your scorecard straight from the private aatrox-capital repo. It needs a GitHub token that can only read that one repo."),
    h("ol", null,
      h("li", null, "Open ", h("a", { href: LINKS.newToken, target: "_blank", rel: "noopener" }, "GitHub → new fine-grained token"), "."),
      h("li", null, "Name ", h("b", null, "Aatrox phone"), ", expiry ", h("b", null, "1 year"), "."),
      h("li", null, "Repository access: ", h("b", null, "Only select repositories → aatrox-capital"), "."),
      h("li", null, "Permissions → Repository → ", h("b", null, "Contents: Read-only"), ". Nothing else."),
      h("li", null, "Generate, copy, paste below.")),
    input, msg, go,
    h("p", { class: "fine" }, "The token is stored only on this phone. It can't change anything, and you can revoke it on GitHub at any time. Not financial advice.")
  );
}

// ---------- shell ----------
function showApp() {
  $("#onboard").classList.add("hidden");
  $("#app").classList.remove("hidden");
  const t = (location.hash || "").slice(1);
  if (TABS[t]) state.tab = t;
  render(true);
  if (!state.fetchedAt || Date.now() - new Date(state.fetchedAt) > 60_000) refresh();
}
function setTab(t) {
  if (!TABS[t] || t === state.tab) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  state.tab = t; history.replaceState(null, "", "#" + t);
  render(true); window.scrollTo(0, 0);
}
function render(animate) {
  document.querySelectorAll("nav#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  $("#title").textContent = TABS[state.tab];
  const v = $("#view"); v.textContent = "";
  const d = state.data;
  const asof = d && d.scores && d.scores[0] ? d.scores[0].as_of : null;
  $("#asof").textContent = "";
  if (asof) $("#asof").append("Run " + dShort(asof), h("br"), h("span", { class: "faint" }, "Synced " + fmtFetched()));
  if (!d) { for (let i = 0; i < 6; i++) v.append(h("div", { class: "skel" })); return; }
  ({ signals: viewSignals, swing: viewSwing, holdings: viewHoldings, alerts: viewAlerts, log: viewLog })[state.tab](v, d);
  const n = unreadCount(), badge = $("#alert-badge");
  if (badge) { badge.textContent = n > 9 ? "9+" : String(n); badge.classList.toggle("hidden", !n); }
  if (animate) { v.classList.remove("view-enter"); void v.offsetWidth; v.classList.add("view-enter"); }
}

// ---------- Signals ----------
function viewSignals(v, d) {
  const rows = d.scores;
  const inTheme = r => state.theme === "all" || (state.theme === "held" ? r.held : r.theme === state.theme);
  const themed = rows.filter(inTheme);
  const counts = h("div", { class: "counts" });
  for (const g of GROUP_ORDER) {
    const n = themed.filter(r => GROUP[r.signal] === g).length;
    counts.append(h("button", { class: "count", "aria-pressed": String(state.sigGroup === g),
      onclick: () => { state.sigGroup = state.sigGroup === g ? null : g; render(false); } },
      h("div", { class: "bar bg-" + g }), h("b", null, n), h("span", null, GROUP_LABEL[g])));
  }
  const chips = h("div", { class: "chips" });
  for (const [k, label] of [["all", "All"], ["held", "Holdings"], ["Compulsory products", "Compulsory"], ["AI supply chain", "AI supply chain"]])
    chips.append(h("button", { class: "chip", "aria-pressed": String(state.theme === k), onclick: () => { state.theme = k; render(false); } }, label));
  const mm = marketMoodCard(d.mood && d.mood.market);
  if (mm) v.append(mm);
  v.append(counts, chips);

  const list = themed.filter(r => !state.sigGroup || GROUP[r.signal] === state.sigGroup)
    .sort((a, b) => GROUP_ORDER.indexOf(GROUP[a.signal]) - GROUP_ORDER.indexOf(GROUP[b.signal]) || b.score - a.score);

  v.append(h("div", { class: "h2" }, "Price vs sticker"));
  const card = h("div", { class: "card" });
  v.append(card);
  card.append(stickerChart(list.filter(r => r.price_to_sticker != null), card));
  card.append(h("div", { class: "legend" },
    h("span", null, h("i", { class: "bg-buy" }), "≤ 0.5 buy window"), h("span", null, h("i", { class: "bg-watch" }), "≤ 1.0 watch"),
    h("span", null, h("i", { class: "bg-trim" }), "> 1.3 trim")));
  const missing = list.filter(r => r.price_to_sticker == null).map(r => r.ticker);
  if (missing.length) card.append(h("div", { class: "note" }, "No sticker price: " + missing.join(", ")));

  v.append(h("div", { class: "h2" }, `${list.length} stocks`));
  const L = h("div", { class: "list" });
  if (!list.length) L.append(h("div", { class: "empty" }, "Nothing in this filter."));
  for (const r of list) {
    const sp = (d.sparks || {})[r.ticker];
    L.append(h("button", { class: "row", onclick: () => openStock(r.ticker) },
      h("div", { class: "l1 tl" }, logo(r.ticker),
        h("div", { class: "who" }, h("div", null, h("span", { class: "tk" }, r.ticker), r.held ? h("span", { class: "held" }, "HELD") : null),
          h("div", { class: "nm" }, r.name)),
        sp ? Sparkline(sp.closes) : null,
        h("div", { class: "px" }, h("b", null, money(r.price, r.ccy)),
          sp ? h("span", { class: sp.chg1d_pct >= 0 ? "up" : "down" }, pct(sp.chg1d_pct, 2)) : null)),
      h("div", { class: "l2" },
        pill(r.signal),
        h("span", null, "P/sticker ", h("b", null, r.price_to_sticker == null ? "n/a" : num(r.price_to_sticker, 2) + "×")),
        r.peg != null ? h("span", null, "PEG ", h("b", null, num(r.peg, 2))) : null,
        r.vs_cost_pct != null ? h("span", { class: r.vs_cost_pct >= 0 ? "up" : "down" }, pct(r.vs_cost_pct) + " vs cost") : null,
        h("span", { class: "score" }, r.score, h("i", { style: { "--w": r.score + "%" } }))),
      r.warnings ? h("div", { class: "flags" }, r.warnings) : null,
      (() => { const mc = moodChips(r.ticker); return mc.length ? h("div", { class: "mchips" }, ...mc) : null; })()));
  }
  v.append(L);
}

function stickerChart(rows, host) {
  const data = rows.slice().sort((a, b) => a.price_to_sticker - b.price_to_sticker);
  const W = Math.max(300, (host.clientWidth || 340) - 28), rowH = 24, top = 24, left = 50, right = 46;
  const H = top + rowH * Math.max(1, data.length) + 6;
  const lo = Math.log(0.15), hi = Math.log(8);
  const x = v => left + (Math.log(Math.min(8, Math.max(0.15, v))) - lo) / (hi - lo) * (W - left - right);
  const g = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Price divided by sticker price" });
  g.append(s("rect", { x: x(0.15), y: top - 6, width: x(0.5) - x(0.15), height: H - top, fill: COL.buy, opacity: .08 }));
  g.append(s("rect", { x: x(1.3), y: top - 6, width: x(8) - x(1.3), height: H - top, fill: COL.trim, opacity: .07 }));
  for (const [v, l, anchor, dx] of [[0.5, "0.5×", "middle", 0], [1, "1.0×", "end", -3], [1.3, "1.3×", "start", 3]]) {
    g.append(s("line", { class: "ref", x1: x(v), x2: x(v), y1: top - 8, y2: H }));
    g.append(s("text", { x: x(v) + dx, y: 12, "text-anchor": anchor }, l));
  }
  data.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2, grp = GROUP[r.signal] || "hold";
    g.append(s("line", { class: "grid", x1: left, x2: x(r.price_to_sticker), y1: y, y2: y }));
    g.append(s("text", { class: "tk", x: left - 8, y: y + 4, "text-anchor": "end" }, r.ticker));
    g.append(s("circle", { cx: x(r.price_to_sticker), cy: y, r: 5.5, fill: COL[grp] }));
    g.append(s("text", { x: W - 2, y: y + 4, "text-anchor": "end" }, num(r.price_to_sticker, 2) + "×"));
    const hit = s("rect", { class: "hit", x: 0, y: y - rowH / 2, width: W, height: rowH });
    hit.addEventListener("click", () => openStock(r.ticker));
    g.append(hit);
  });
  return g;
}

// ---------- Swing ----------
const SETUP_ORDER = ["AT SUPPORT", "APPROACHING", "EXTENDED", "NO SUPPORT NEAR", "SUPPORT BROKEN", "NO DATA"];
function viewSwing(v, d) {
  const rows = d.setups;
  const enter = rows.filter(r => r.swing === "ENTER").length, ready = rows.filter(r => r.swing === "READY").length;
  const at = rows.filter(r => r.setup === "AT SUPPORT").length;
  v.append(h("div", { class: "counts four" },
    countTile("buy", enter, "Enter"), countTile("watch", ready, "Ready"), countTile("trim", at, "At support"),
    countTile("hold", rows.length - enter - ready, "No trade")));
  v.append(h("p", { class: "sub" }, "A trade needs quality 25+, no sell warning, no downtrend, price at support and reward ÷ risk of 3 or more."));
  const list = rows.filter(r => r.support != null || r.target != null)
    .sort((a, b) => (a.dist_support_pct ?? 999) - (b.dist_support_pct ?? 999));
  v.append(h("div", { class: "h2" }, "Distance to stop, support and target"));
  const card = h("div", { class: "card" }); v.append(card);
  card.append(ladder(list, card));
  card.append(h("div", { class: "legend" },
    h("span", null, h("i", { class: "bg-sell" }), "stop"), h("span", null, h("i", { class: "bg-buy" }), "buy zone / target"),
    h("span", null, h("i", { class: "bg-watch" }), "price today")));
  v.append(h("div", { class: "h2" }, "Setups"));
  const L = h("div", { class: "list" });
  for (const r of rows.slice().sort((a, b) => SETUP_ORDER.indexOf(a.setup) - SETUP_ORDER.indexOf(b.setup) || (a.dist_support_pct ?? 999) - (b.dist_support_pct ?? 999))) {
    L.append(h("button", { class: "row", onclick: () => openStock(r.ticker) },
      h("div", { class: "l1" }, logo(r.ticker), h("span", { class: "tk" }, r.ticker), h("span", { class: "nm" }, r.name),
        h("span", { class: "pill " + (r.swing === "ENTER" ? "g-buy" : r.swing === "READY" ? "g-watch" : "g-hold") }, r.swing === "NO TRADE" ? "No trade" : r.swing)),
      h("div", { class: "l2" }, h("span", null, h("b", null, setupLabel(r.setup))),
        r.support != null ? h("span", null, "support ", h("b", null, money(r.support, r.ccy)), r.support_touches ? ` ×${r.support_touches}` : "") : null,
        r.rr != null ? h("span", null, "R:R ", h("b", null, num(r.rr, 1))) : null),
      r.swing_reason ? h("div", { class: "note" }, r.swing_reason) : null));
  }
  v.append(L);
}
const setupLabel = s => ({ "AT SUPPORT": "At support", "APPROACHING": "Approaching", "EXTENDED": "Extended", "NO SUPPORT NEAR": "No support near",
  "SUPPORT BROKEN": "Support broken", "NO DATA": "No data" }[s] || s);
function countTile(g, n, label) { return h("div", { class: "count" }, h("div", { class: "bar bg-" + g }), h("b", null, n), h("span", null, label)); }

function ladder(rows, host) {
  const W = Math.max(300, (host.clientWidth || 340) - 28), rowH = 26, top = 22, left = 50, right = 36;
  const H = top + rowH * Math.max(1, rows.length) + 4, lim = 40;
  const x = p => left + (Math.max(-lim, Math.min(lim, p)) + lim) / (2 * lim) * (W - left - right);
  const rel = (v, p) => v == null ? null : (v - p) / p * 100;
  const g = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Swing ladder" });
  for (const p of [-30, -15, 0, 15, 30]) {
    g.append(s("line", { class: p ? "grid" : "ref", x1: x(p), x2: x(p), y1: top - 6, y2: H }));
    g.append(s("text", { x: x(p), y: 12, "text-anchor": "middle" }, (p > 0 ? "+" : "") + p + "%"));
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2, P = r.price;
    const st = rel(r.stop, P), su = rel(r.support, P), bz = rel(r.buy_zone_top, P), tg = rel(r.target, P);
    g.append(s("text", { class: "tk", x: left - 8, y: y + 4, "text-anchor": "end" }, r.ticker));
    if (su != null && bz != null) g.append(s("rect", { x: Math.min(x(su), x(bz)), y: y - 5, width: Math.max(2, Math.abs(x(bz) - x(su))), height: 10, rx: 3, fill: COL.buy, opacity: .35 }));
    if (st != null) g.append(s("rect", { x: x(st) - 1.5, y: y - 7, width: 3, height: 14, rx: 1, fill: COL.sell }));
    if (tg != null) g.append(s("rect", { x: x(tg) - 1.5, y: y - 7, width: 3, height: 14, rx: 1, fill: COL.buy }));
    g.append(s("circle", { cx: x(0), cy: y, r: 3.5, fill: COL.watch }));
    g.append(s("text", { x: W - 2, y: y + 4, "text-anchor": "end", class: r.rr >= 3 ? "good" : null }, r.rr == null ? "–" : num(r.rr, 1)));
    const hit = s("rect", { class: "hit", x: 0, y: y - rowH / 2, width: W, height: rowH });
    hit.addEventListener("click", () => openStock(r.ticker));
    g.append(hit);
  });
  return g;
}

// ---------- Holdings ----------
function viewHoldings(v, d) {
  const rows = d.holdings;
  const n = k => rows.filter(r => r.scan === k).length;
  const tile = (k, g, label) => h("button", { class: "count", "aria-pressed": String(state.holdFilter === k),
    onclick: () => { state.holdFilter = state.holdFilter === k ? "flagged" : k; render(false); } },
    h("div", { class: "bar bg-" + g }), h("b", null, n(k)), h("span", null, label));
  v.append(h("div", { class: "counts four" },
    tile("SELL WARNING", "sell", "Sell warning"), tile("ONE FLAG", "trim", "One flag"), tile("CLEAR", "buy", "Clear"), tile("WATCHLIST", "watch", "Watchlist")));
  const chips = h("div", { class: "chips" });
  for (const [k, label] of [["flagged", "Flagged"], ["all", "All " + rows.length]])
    chips.append(h("button", { class: "chip", "aria-pressed": String(state.holdFilter === k), onclick: () => { state.holdFilter = k; render(false); } }, label));
  v.append(chips);
  const pies = (d.cleanup && d.cleanup.pies) || [];
  if (pies.length) {
    const pc = h("div", { class: "chips" });
    const short = n => n.replace(/\s*-\s*custom$/i, "").replace(/^\(Almost\) /, "");
    for (const [k, label] of [[null, "All holdings"], ...pies.map(p => [p.name, "🥧 " + short(p.name)]), ["__none", "Not in a pie"]])
      pc.append(h("button", { class: "chip", "aria-pressed": String(state.pie === k), onclick: () => { state.pie = k; if (k) state.holdFilter = "all"; render(false); } }, label));
    v.append(pc);
    const pie = pies.find(p => p.name === state.pie);
    if (pie) v.append(...pieCleanup(pie));
  }
  const search = h("input", { class: "search", type: "search", placeholder: "Search ticker, company, flag", value: state.holdQuery, "aria-label": "Search holdings" });
  v.append(search);
  const L = h("div", { class: "list", style: { "margin-top": "12px" } });
  v.append(L);
  const order = { "SELL WARNING": 0, "ONE FLAG": 1, "NO DATA": 2, "WATCHLIST": 3, "CLEAR": 4 };
  const draw = () => {
    L.textContent = "";
    const q = state.holdQuery.toLowerCase();
    const list = rows.filter(r => state.holdFilter === "all" ? true : state.holdFilter === "flagged" ? (r.scan === "SELL WARNING" || r.scan === "ONE FLAG") : r.scan === state.holdFilter)
      .filter(r => !state.pie || (state.pie === "__none" ? !(r.pies || []).length : (r.pies || []).includes(state.pie)))
      .filter(r => !q || [r.ticker, r.name, r.flags, r.sector].join(" ").toLowerCase().includes(q))
      .sort((a, b) => order[a.scan] - order[b.scan] || (b.n_flags || 0) - (a.n_flags || 0) || a.ticker.localeCompare(b.ticker));
    if (!list.length) L.append(h("div", { class: "empty" }, "No holdings match."));
    for (const r of list.slice(0, 150)) {
      L.append(h("button", { class: "row", onclick: () => r.scan === "WATCHLIST" ? openStock(r.ticker) : openHolding(r) },
        h("div", { class: "l1" }, logo(r.ticker), h("span", { class: "tk" }, r.ticker), h("span", { class: "nm" }, r.name || ""),
          h("span", { class: "pill g-" + SCAN_GROUP[r.scan] }, SCAN_LABEL[r.scan])),
        h("div", { class: "l2" }, r.sector ? h("span", null, r.sector) : null, r.first_buy ? h("span", null, "since " + dShort(r.first_buy) + " " + r.first_buy.slice(0, 4)) : null,
          r.vs_cost_pct != null ? h("span", { class: r.vs_cost_pct >= 0 ? "up" : "down" }, pct(r.vs_cost_pct) + " vs cost") : null,
          r.scan === "WATCHLIST" ? h("span", null, r.checks.replace("full scorer: ", "")) : null),
        r.flags ? h("div", { class: "flags" }, r.flags) : null));
    }
  };
  search.addEventListener("input", () => { state.holdQuery = search.value; draw(); });
  draw();
}

// ---------- Logos (company site icons from the private repo; monogram when there's none) ----------
function logo(t, big) {
  const src = state.data && state.data.logos ? state.data.logos[t] : null;
  if (src && /^data:image\/(png|x-icon);base64,/.test(src)) return h("img", { class: "logo" + (big ? " big" : ""), src, alt: "", loading: "lazy" });
  let hash = 0; for (const ch of t) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return h("span", { class: "logo mono" + (big ? " big" : ""), style: { "--hue": String(hash) } }, t.replace(/[^A-Z]/g, "").slice(0, 2));
}

// ---------- Pie cleanup ----------
const ACT = { sell: ["Sell: red flags", "sell"], sell_score: ["Sell: scorecard wouldn't buy", "sell"], yield_trap: ["Review: yield trap?", "trim"],
  write_off: ["Write off: delisted", "hold"], review: ["Review: couldn't score", "trim"], trim: ["Trim to target", "watch"],
  review_keep: ["Keep: scorecard would buy", "buy"], small: ["Top up or remove", "hold"] };
function cleanupDone() { try { return JSON.parse(store.get("aatrox-cleanup") || "{}"); } catch (e) { return {}; } }
function pieCleanup(pie) {
  const done = cleanupDone();
  const todo = pie.rows.filter(r => r.action !== "keep");
  const key = r => `${pie.name}|${r.ticker}|${r.action}`;
  const n = todo.filter(r => done[key(r)]).length;
  const verdict = { close: ["Close this pie", "sell"], prune: ["Prune", "trim"], keep: ["Keep", "buy"] }[pie.verdict] || ["", "hold"];
  const sum = h("div", { class: "card pie-sum" },
    h("div", { class: "pie-top" }, h("b", null, pie.name), h("span", { class: "pill g-" + verdict[1] }, verdict[0])),
    h("div", { class: "kpis" },
      kpi("Pie return", pie.return_pct == null ? "n/a" : pct(pie.return_pct), pie.source || ""),
      kpi("Median slice", pie.median_return_pct == null ? "n/a" : pct(pie.median_return_pct), `${pie.up} up · ${pie.down} down of ${pie.slices}`),
      kpi("Sell warnings", String(pie.sell_warnings), "slices with 2+ red flags"),
      kpi("Top 2 slices", pie.top2_share_pct + "%", "of the pie's value")),
    h("div", { class: "prog" }, h("i", { style: { width: (todo.length ? n / todo.length * 100 : 100) + "%" } })),
    h("div", { class: "note" }, todo.length ? `${n} of ${todo.length} cleanup steps done. Tick them off as you go; this phone remembers.` : "Nothing to clean up."));
  const groups = [];
  for (const a of ["sell", "sell_score", "yield_trap", "write_off", "review", "trim", "review_keep", "small"]) {
    const items = todo.filter(r => r.action === a);
    if (!items.length) continue;
    const box = h("div", { class: "card ck" }, h("div", { class: "ckh" }, h("span", { class: "pill g-" + ACT[a][1] }, ACT[a][0]), h("span", { class: "faint" }, `${items.length}`)));
    for (const r of items) {
      const k = key(r);
      const cb = h("input", { type: "checkbox", "aria-label": `Done: ${r.label} ${r.ticker}` }); cb.checked = !!done[k];
      const row = h("div", { class: "ckrow" + (done[k] ? " done" : "") }, cb, logo(r.ticker),
        h("button", { class: "ckt", type: "button", onclick: () => {
          const w = state.data.scores.find(x => x.ticker === r.ticker);
          if (w) openStock(r.ticker); else { const hh = state.data.holdings.find(x => x.ticker === r.ticker); if (hh) openHolding(hh); } } },
          h("span", null, h("b", null, r.ticker), " ", h("span", { class: r.return_pct >= 0 ? "up" : "down" }, r.return_pct == null ? "" : pct(r.return_pct, 0)), h("span", { class: "faint" }, ` · ${Number(r.share_pct).toFixed(1)}% of pie`)),
          h("small", null, r.why)));
      cb.addEventListener("change", () => {
        const dd = cleanupDone(); if (cb.checked) dd[k] = new Date().toISOString().slice(0, 10); else delete dd[k];
        store.set("aatrox-cleanup", JSON.stringify(dd)); row.classList.toggle("done", cb.checked); render(false);
      });
      box.append(row);
    }
    groups.push(box);
  }
  return [h("div", { class: "h2" }, "Pie cleanup"), sum, ...groups,
    h("div", { class: "note" }, "Rules: sell warnings go; 3%+ yield on a falling price is a trap; anything down 50%+ and off the watchlist is run through the scorecard: sell if it wouldn't buy today, watch it if it would; trim anything over 2× its target weight or on Trim review; slices under 1% are noise. Your rules, not financial advice."),
    h("div", { class: "h2" }, "Slices")];
}

// ---------- Mood ----------
const CAT = { management: "Management", legal: "Legal / regulatory", earnings: "Earnings", analyst: "Analyst",
  competition: "Competition", deals: "Deals", capital: "Capital" };
const LENS = { management: "Management", legal: "Management", competition: "Moat", deals: "Meaning", earnings: "Numbers", analyst: "Numbers", capital: "Numbers" };
const SUBS = [
  ["wallstreetbets", "Retail euphoria and panic", "Contrarian at extremes only"],
  ["stocks", "Mainstream retail reaction to news", "Medium: is the crowd scared?"],
  ["StockMarket", "News-driven reactions", "Medium"],
  ["investing", "Buy-and-hold crowd mood", "Slow; useful when it turns"],
  ["ValueInvesting", "Value cases and bear cases", "Closest to Rule 1"],
  ["SecurityAnalysis", "Deep fundamental write-ups", "Quality over quantity"],
  ["options", "Positioning and squeeze talk", "Early warning of options-driven moves"],
  ["semiconductors", "AI supply chain news", "Industry context"],
  ["UKInvesting", "UK stocks: Aviva, Domino's, Admiral", "UK context"],
  ["dividends", "Income crowd", "Dividend context"],
  ["NVDA_Stock", "Nvidia holders", "Echo chamber: read contrarian"],
  ["AMD_Stock", "AMD holders", "Echo chamber: read contrarian"]
];
function moodOf(t) { return state.data && state.data.mood && state.data.mood.stocks ? state.data.mood.stocks[t] : null; }
function moodChips(t) {
  const m = moodOf(t); if (!m) return [];
  const out = [];
  if ((m.event_3d || []).length) out.push(h("span", { class: "mchip ev" }, "⚑ " + m.event_3d.map(x => CAT[x]).join(" · ")));
  const a = m.attention || {};
  if ((a.spike_x || 0) >= 2 && (a.mentions || 0) >= 20) out.push(h("span", { class: "mchip at" }, `Reddit ×${a.spike_x}`));
  if (m.tone_7d != null && m.tone_28d != null && Math.abs(m.tone_7d - m.tone_28d) >= 0.3)
    out.push(h("span", { class: "mchip " + (m.tone_7d < m.tone_28d ? "dn" : "upc") }, `Tone ${m.tone_7d < m.tone_28d ? "↓" : "↑"}`));
  return out;
}
function marketMoodCard(mk) {
  if (!mk) return null;
  const f = mk.facts || {};
  const col = mk.score < 25 ? "var(--sell)" : mk.score < 45 ? "#e98b5a" : mk.score <= 55 ? "var(--hold)" : mk.score <= 75 ? "#9fcf7a" : "var(--buy)";
  return h("div", { class: "card mood-mk" },
    h("div", { class: "mk-top" }, h("span", { class: "sub" }, "Market mood"), h("b", { style: { color: col } }, `${mk.score} · ${mk.label}`)),
    h("div", { class: "mk-bar" }, h("i", { style: { left: Math.max(1, Math.min(99, mk.score)) + "%" } })),
    h("div", { class: "mk-scale" }, h("span", null, "Extreme fear"), h("span", null, "Neutral"), h("span", null, "Extreme greed")),
    h("div", { class: "note" }, `VIX ${f.vix} (higher than ${f.vix_1y_percentile}% of the past year) · S&P ${f.spx_vs_200d_pct > 0 ? "+" : ""}${f.spx_vs_200d_pct}% vs 200-day · ${f.spx_1m_pct > 0 ? "+" : ""}${f.spx_1m_pct}% in a month · ${f.sectors_above_200d} sectors above 200-day`));
}
function moodSection(r) {
  const m = moodOf(r.ticker);
  if (!m) return [];
  const notes = state.data.notes && state.data.notes.notes ? state.data.notes.notes[r.ticker] : null;
  const card = h("div", { class: "card" });
  const ev = m.event_3d || [];
  if (ev.length) card.append(h("div", { class: "lens" }, h("b", null, "Rule 1 lens: Management. "),
    `${Math.round((m.event_share || 0) * 100)}% of this week's ${m.news_7d} headlines are about ${ev.map(x => CAT[x].toLowerCase()).join(" and ")}. That's one of the four Ms, so check it before acting on the price.`));
  if (notes && notes.text) {
    card.append(h("div", { class: "mnote" }, h("div", { class: "faint" }, "Friday note · " + dShort(state.data.notes.as_of)), notes.text));
    if ((notes.sources || []).length) card.append(h("div", { class: "msrc" }, ...notes.sources.slice(0, 3).map(s => h("a", { href: s.url, target: "_blank", rel: "noopener" }, s.title))));
  }
  const a = m.attention || {}, c = m.crowd || {};
  const toneTxt = m.tone_7d == null ? "n/a" : (m.tone_7d > 0 ? "+" : "") + m.tone_7d.toFixed(2);
  const shift = m.tone_7d != null && m.tone_28d != null ? m.tone_7d - m.tone_28d : null;
  card.append(h("div", { class: "kpis mk-kpis" },
    kpi("Headline tone (week)", toneTxt, shift == null ? "no 3-week baseline" : `${shift >= 0 ? "▲" : "▼"} ${Math.abs(shift).toFixed(2)} vs prior 3 weeks`),
    kpi("News volume", `${m.news_7d} this week`, m.news_spike_x ? `×${m.news_spike_x} the usual` : "busy week, no baseline"),
    kpi("Reddit", a.rank ? `#${a.rank}` : "not ranked", a.rank ? `${a.mentions} mentions · ×${a.spike_x} vs ${a.baseline}` : "few or no mentions"),
    kpi("Stocktwits crowd", c.bull_pct == null ? "n/a" : `${c.bull_pct}% bullish`, c.posts ? `${c.bull + c.bear} tagged of ${c.posts} posts` : "US listings only")));
  const hl = m.headlines || [];
  if (hl.length) {
    const ul = h("div", { class: "hl" });
    for (const x of hl) ul.append(h("a", { class: "hli", href: x.url, target: "_blank", rel: "noopener" },
      h("i", { class: "tdot " + (x.tone > 0.2 ? "bg-buy" : x.tone < -0.2 ? "bg-sell" : "bg-hold") }),
      h("span", null, h("span", { class: "hlt" }, x.title),
        h("span", { class: "hlm" }, `${x.source} · ${dShort(x.date)}`, ...(x.types || []).map(ty => h("span", { class: "tchip" + (ty === "management" || ty === "legal" ? " ev" : "") }, CAT[ty] + (LENS[ty] ? "" : ""))))))); 
    card.append(ul);
  } else card.append(h("div", { class: "note" }, "No headlines this week."));
  card.append(h("div", { class: "note" }, "Context, not a signal: following Reddit picks hasn't beaten the market since GameStop. Mood matters most at extremes, when it lines up with a level your rules already flag."));
  return section("Catalysts & mood", card);
}
function subredditCard() {
  return h("div", { class: "card links" }, ...SUBS.map(([s, what, q]) => h("a", { href: `https://www.reddit.com/r/${s}/`, target: "_blank", rel: "noopener" },
    h("span", { class: "sr" }, h("b", null, "r/" + s), h("small", null, `${what} · ${q}`)), h("span", null, "↗"))));
}

// ---------- Alerts ----------
const SOUND = { chime: "../sounds/aatrox-chime.mp3", warn: "../sounds/aatrox-warn.mp3" };
function playSound(which) {
  if (store.get("aatrox-sound") === "off") return;
  try { const a = new Audio(SOUND[which] || SOUND.chime); a.volume = 0.9; a.play().catch(() => {}); } catch (e) {}
}
function playAlert(list) { playSound((list || []).some(a => a.kind === "warn") && !(list || []).some(a => a.kind === "buy") ? "warn" : "chime"); }
function unreadCount() {
  const list = (state.data && state.data.alerts) || [];
  const seen = store.get("aatrox-alerts-seen");
  if (!seen) return Math.min(list.length, 99);
  const i = list.findIndex(a => a.id === seen);
  return i < 0 ? list.length : i;
}
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

async function pushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub && store.get("aatrox-vapid") ? "on" : "off";
}
async function pushConfig() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications weren't allowed. Allow them for Aatrox in Android settings, then try again.");
  const reg = await navigator.serviceWorker.ready;
  let keys = null;
  try { keys = JSON.parse(store.get("aatrox-vapid") || "null"); } catch (e) {}
  if (!keys) {
    // this phone's own signing key: it leaves the phone only inside the code you paste into GitHub
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    keys = { d: jwk.d, x: jwk.x, y: jwk.y, pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)) };
    store.set("aatrox-vapid", JSON.stringify(keys));
  }
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options && sub.options.applicationServerKey && b64u(sub.options.applicationServerKey) !== keys.pub) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(keys.pub) });
  return JSON.stringify({ v: 1, vapid: { d: keys.d, x: keys.x, y: keys.y }, subs: [sub.toJSON()] });
}

function viewAlerts(v, d) {
  const list = d.alerts || [];
  const unread = unreadCount();
  const nc = h("div", { class: "card" });
  v.append(h("div", { class: "h2" }, "Notifications"), nc);
  (async () => {
    const st = await pushStatus().catch(() => "unsupported");
    if (st === "unsupported") { nc.append(h("div", { class: "sub" }, "This browser can't receive notifications. Open Aatrox from its home-screen icon in Chrome.")); return; }
    if (st === "denied") { nc.append(h("div", { class: "sub" }, "Notifications are blocked for Aatrox. Allow them in Android Settings → Apps → Aatrox → Notifications, then come back.")); return; }
    const dot = h("i", { class: st === "on" ? "bg-buy" : "bg-hold" }), label = h("span", null, st === "on" ? "On for this phone" : "Off");
    nc.append(h("div", { class: "nstate" }, dot, label),
      h("div", { class: "note" }, "Alerts are checked after every weekday close and on Friday nights. Busy days arrive as one summary."));
    const out = h("div");
    const btn = h("button", { class: "btn primary", type: "button" }, st === "on" ? "Show set-up code again" : "Turn on notifications");
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "Setting up…"; out.textContent = "";
      try {
        const cfg = await pushConfig();
        const ta = h("textarea", { class: "code", readonly: true, rows: 5, "aria-label": "Set-up code" }); ta.value = cfg;
        const copy = h("button", { class: "btn", type: "button" }, "Copy set-up code");
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(cfg); copy.textContent = "Copied ✓"; } catch (e) { ta.select(); copy.textContent = "Select and copy the text above"; }
        });
        out.append(
          h("ol", { class: "steps" },
            h("li", null, "Copy the set-up code."),
            h("li", null, "Open ", h("a", { href: LINKS.secret, target: "_blank", rel: "noopener" }, "GitHub → new repository secret"), ", name it ", h("b", null, "PUSH_CONFIG"), ", paste, save."),
            h("li", null, "Run ", h("a", { href: LINKS.testPush, target: "_blank", rel: "noopener" }, "Test push"), " to check it arrives.")),
          ta, copy,
          h("div", { class: "note" }, "The code holds this phone's push address and a signing key the phone just made. Keep it in GitHub's secret only; paste it nowhere else."));
        dot.className = "bg-buy"; label.textContent = "On for this phone";
        btn.textContent = "Show set-up code again"; btn.disabled = false;
      } catch (e) { out.append(h("div", { class: "warn note" }, e.message)); btn.textContent = "Try again"; btn.disabled = false; }
    });
    nc.append(btn, out);
  })();

  const sc = h("div", { class: "card" });
  const tog = h("input", { type: "checkbox", "aria-label": "Play the Aatrox chime in the app" }); tog.checked = store.get("aatrox-sound") !== "off";
  tog.addEventListener("change", () => store.set("aatrox-sound", tog.checked ? "on" : "off"));
  const playBtn = (cls, which, name, sub) => h("button", { class: "play " + cls, type: "button", onclick: () => { store.set("aatrox-sound", "on"); tog.checked = true; playSound(which); } },
    "▶", h("span", null, h("b", null, name), h("small", null, sub)));
  sc.append(
    h("div", { class: "sounds" }, playBtn("", "chime", "Aatrox chime", "Buy-side alerts · touch, bounce, peak"), playBtn("warnc", "warn", "Aatrox warning", "Stops broken, sell warnings")),
    h("label", { class: "toggle" }, h("span", null, "Play the chime when alerts arrive with the app open"), tog),
    h("a", { class: "btn", href: "../sounds/aatrox-chime.ogg", download: "Aatrox chime.ogg" }, "Download chime for Android notifications"),
    h("div", { class: "note" }, "Android picks the sound for app notifications, not the app. To hear the chime on your lock screen: download it, then Settings → Apps → Aatrox → Notifications → tap the alerts category → Sound → choose “Aatrox chime”. If it isn't listed, move the file into your phone's Notifications folder with the Files app first. Menus vary a little by phone."));
  v.append(h("div", { class: "h2" }, "Sound"), sc);

  v.append(h("div", { class: "h2" }, list.length ? `Alerts · ${unread ? unread + " new" : "all read"}` : "Alerts"));
  const L = h("div", { class: "list" });
  if (!list.length) L.append(h("div", { class: "empty" }, "No alerts yet. The first ones arrive after tonight's close."));
  let day = null;
  list.slice(0, 120).forEach((a, i) => {
    if (a.date !== day) { day = a.date; L.append(h("div", { class: "aday" }, dLong(day))); }
    const inScores = d.scores.some(r => r.ticker === a.ticker);
    L.append(h("button", { class: "row alert" + (i < unread ? " unread" : ""), onclick: () => {
      if (inScores) openStock(a.ticker); else { const hh = d.holdings.find(x => x.ticker === a.ticker); if (hh) openHolding(hh); } } },
      h("div", { class: "l1" }, a.ticker === "MARKET" ? null : logo(a.ticker), h("i", { class: "kdot bg-" + (a.kind === "buy" ? "buy" : a.kind === "warn" ? "sell" : "hold") }), h("span", { class: "atitle" }, a.title)),
      h("div", { class: "note" }, a.body)));
  });
  v.append(L);
  if (list.length) store.set("aatrox-alerts-seen", list[0].id);
  const badge = $("#alert-badge"); if (badge) badge.classList.add("hidden");
}

// ---------- Log ----------
function viewLog(v, d) {
  const sync = parseMd(d.sync);
  v.append(h("div", { class: "h2" }, "Trading 212 sync"));
  const sc = h("div", { class: "card" });
  if (sync.title) sc.append(h("div", { style: { "font-weight": "650" } }, "Last sync " + dLong(sync.title.replace("Last Trading 212 sync: ", "").trim())));
  const ul = h("ul", { class: "note", style: { "padding-left": "18px", "margin": "6px 0 0" } });
  for (const l of sync.items.filter(l => !l.startsWith("Trading 212 sync using"))) ul.append(h("li", null, ...inline(l.replace(/ \(see data\/[^)]+\)/, ""))));
  sc.append(ul);
  sc.append(h("a", { class: "btn", href: LINKS.sync, target: "_blank", rel: "noopener" }, "Run sync now"));
  v.append(sc);

  v.append(h("div", { class: "h2" }, "Signal changes"));
  const lc = h("div", { class: "card" });
  const days = (d.log || "").split("\n## ").slice(1);
  if (!days.length) lc.append(h("div", { class: "sub" }, "No runs logged yet."));
  for (const day of days.slice(0, 12)) {
    const [head, ...rest] = day.split("\n");
    const items = rest.filter(l => l.startsWith("- ")).map(l => l.slice(2));
    const plain = rest.filter(l => l.trim() && !l.startsWith("- ")).join(" ");
    const box = h("div", { class: "logday" }, h("h3", null, dLong(head.trim())));
    if (items.length) { const u = h("ul"); items.forEach(i => u.append(h("li", null, ...inline(i)))); box.append(u); }
    else box.append(h("div", { class: "sub" }, plain || "No changes."));
    lc.append(box);
  }
  v.append(lc);

  v.append(h("div", { class: "h2" }, "Where to read the crowd"), subredditCard());
  v.append(h("div", { class: "h2" }, "Shortcuts"));
  v.append(h("div", { class: "card links" },
    ...[["Trading 212", LINKS.t212], ["Dashboard on claude.ai", LINKS.dashboard], ["Repository", LINKS.repo]]
      .map(([t, u]) => h("a", { href: u, target: "_blank", rel: "noopener" }, t, h("span", null, "↗")))));

  v.append(h("div", { class: "h2" }, "App version"));
  const vc = h("div", { class: "card" });
  const seg = h("div", { class: "chips", style: { margin: "0" } });
  for (const [k, label] of [["v1", "V1 · stable"], ["v2", "V2 · beta"]])
    seg.append(h("button", { class: "chip", "aria-pressed": String(APP_VERSION === k), onclick: () => switchVersion(k) }, label));
  vc.append(seg, h("div", { class: "note" }, APP_VERSION === "v1"
    ? "V2 is where new features land first. Switch back any time; both use the same token and data."
    : "You're on the V2 beta. The home-screen icon opens V2 until you switch back."));
  v.append(vc);

  v.append(h("div", { class: "h2" }, "Connection"));
  const cc = h("div", { class: "card" });
  cc.append(h("div", { class: "sub" }, `Reading ${REPO} with a read-only token stored on this phone. Last synced ${fmtFetched()}.`));
  cc.append(h("button", { class: "btn", type: "button", onclick: () => { showOnboarding(); } }, "Replace token"));
  cc.append(h("button", { class: "btn ghost", type: "button", onclick: () => {
    store.del("aatrox-token"); store.del("aatrox-data"); state.token = null; state.data = null; showOnboarding("Token removed from this phone. Revoke it on GitHub too if you're done with it.");
  } }, "Forget token and data on this phone"));
  v.append(cc);
  v.append(h("p", { class: "note", style: { "text-align": "center", "margin-top": "18px" } }, "Applying your own rules, not financial advice."));
}
function parseMd(md) {
  const lines = (md || "").split("\n");
  return { title: (lines.find(l => l.startsWith("# ")) || "").slice(2), items: lines.filter(l => l.startsWith("- ")).map(l => l.slice(2)) };
}
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(p => p.startsWith("**") ? h("b", null, p.slice(2, -2)) : p);
}

// ---------- sheets ----------
let sheetOpen = false;
function openSheet(build) {
  const sh = $("#sheet"), sc = $("#scrim");
  sh.textContent = ""; sh.append(h("div", { class: "grab" })); build(sh);
  sh.classList.remove("hidden"); sc.classList.remove("hidden"); sh.scrollTop = 0;
  requestAnimationFrame(() => { sh.classList.add("open"); sc.classList.add("open"); });
  if (!sheetOpen) history.pushState({ sheet: 1 }, "");
  sheetOpen = true;
}
function closeSheet(fromPop) {
  if (!sheetOpen) return;
  sheetOpen = false;
  const sh = $("#sheet"), sc = $("#scrim");
  sh.classList.remove("open"); sc.classList.remove("open");
  setTimeout(() => { if (!sheetOpen) { sh.classList.add("hidden"); sc.classList.add("hidden"); } }, 320);
  if (!fromPop) history.back();
}
window.addEventListener("popstate", () => closeSheet(true));

function section(title, ...kids) { return [h("div", { class: "h2" }, title), ...kids]; }
function kv(pairs) {
  const dl = h("dl", { class: "kv" });
  for (const [k, val] of pairs) if (val != null && val !== "") dl.append(h("dt", null, k), h("dd", null, val));
  return h("div", { class: "card" }, dl);
}
function saUrl(r) {
  const t = r.ticker;
  if (r.ccy === "GBX" || r.ccy === "GBp" || r.ccy === "GBP") return `https://stockanalysis.com/quote/lon/${t}/`;
  if (r.ccy === "EUR") return `https://stockanalysis.com/quote/epa/${t}/`;
  return `https://stockanalysis.com/stocks/${t.toLowerCase()}/`;
}

function openStock(ticker) {
  const d = state.data, r = d.scores.find(x => x.ticker === ticker);
  if (!r) return;
  const w = d.setups.find(x => x.ticker === ticker);
  openSheet(sh => {
    sh.append(h("div", { class: "sh-head" }, logo(r.ticker, true),
      h("div", null, h("h2", null, r.ticker), h("div", { class: "nm" }, `${r.name} · ${r.theme}`)), pill(r.signal)));
    const chartHost = h("div", { class: "pc" }, h("div", { class: "skel", style: { height: "300px" } }));
    sh.append(chartHost);
    loadSeries(r.ticker).then(rows => {
      if (!chartHost.isConnected) return;
      PriceChart(chartHost, { rows, ccy: r.ccy, money, levels: {
        support: w ? w.support : null, buyZoneTop: w ? w.buy_zone_top : null, stop: w ? w.stop : null, target: w ? w.target : null,
        sticker: r.sticker, mos: r.mos, cost: r.avg_cost } });
    }).catch(e => { chartHost.textContent = ""; chartHost.append(h("div", { class: "note" }, "Chart unavailable: " + e.message)); });
    sh.append(h("div", { class: "kpis" },
      kpi("Score", `${r.score}/100`),
      kpi("52-week", r.chg52 == null ? "n/a" : pct(r.chg52), r.price_date ? "to " + dShort(r.price_date) : null),
      kpi("Sticker", money(r.sticker, r.ccy)),
      kpi("Buy below", money(r.mos, r.ccy)),
      kpi("Price ÷ sticker", r.price_to_sticker == null ? "n/a" : num(r.price_to_sticker, 2) + "×"),
      kpi("PEG", r.peg == null ? "n/a" : `${num(r.peg, 2)} · ${r.pe_signal}`)));
    if (r.warnings || r.alerts) sh.append(h("div", { class: "card", style: { "margin-top": "10px" } },
      r.warnings ? h("div", { class: "warn" }, "⚠ " + r.warnings) : null, r.alerts ? h("div", { class: "note" }, r.alerts) : null));
    sh.append(...moodSection(r));
    if (r.avg_cost != null) sh.append(...section("Your position", kv([
      ["Average cost", money(r.avg_cost, r.ccy)], ["vs cost", pct(r.vs_cost_pct)], ["Entry", r.entry_grade],
      ["Cost ÷ today's sticker", r.cost_to_sticker == null ? null : num(r.cost_to_sticker, 2) + "×"], ["First bought", dLong(r.first_buy)]])));
    sh.append(...section("Score breakdown", h("div", { class: "card bars" },
      sbar("Quality", r.quality, 40), sbar("Value", r.value, 35), sbar("Timing", r.timing, 15), sbar("Physics", r.physics, 10))));
    sh.append(...section("Valuation", kv([
      ["Trailing P/E", r.pe == null ? "loss" : num(r.pe)], ["Forward P/E", num(r.fwd_pe)], ["EPS growth forecast", r.eps_g3y == null ? null : num(r.eps_g3y) + "%"],
      ["5-yr median P/E", r.hist_pe == null ? "n/a" : num(r.hist_pe)], ["P/E vs history", r.pe_vs_hist == null ? r.pe_hist_signal : `${r.pe_hist_signal} (${num(r.pe_vs_hist, 2)}×)`],
      ["Earnings trend", r.earnings_trend], ["Sticker basis", r.sticker_basis]])));
    if (r.pe_note) sh.append(h("div", { class: "note" }, "PEG caution: " + r.pe_note));
    const vals = (r.pe_hist_vals || []).filter(v => v > 0);
    if (vals.length >= 2) {
      const band = PeBand(vals, r.pe && r.pe > 0 ? r.pe : null, r.hist_pe);
      if (band) sh.append(...section("P/E against its last 5 years", h("div", { class: "card" }, band,
        h("div", { class: "note" }, r.pe && r.pe > 0 ? `Grey dots are the last five fiscal-year P/Es. Today's ${num(r.pe)} is ${r.pe_hist_signal.toLowerCase()}.` : "Loss-making now, so no current P/E."))));
    }
    const rsiTxt = r.rsi == null ? null : `${num(r.rsi, 0)}${r.rsi >= 70 ? " · overbought" : r.rsi <= 30 ? " · oversold" : ""}`;
    sh.append(...section("Technicals", kv([
      ["Trend (10-month average)", w ? w.trend : null],
      ["50-day average", r.ma50 == null ? null : money(r.ma50, r.ccy)],
      ["200-day average", r.ma200 == null ? null : money(r.ma200, r.ccy)],
      ["Price vs 200-day", r.ma200 ? pct((r.price / r.ma200 - 1) * 100) : null],
      ["50-day vs 200-day", r.ma50 && r.ma200 ? (r.ma50 > r.ma200 ? "Above (uptrend)" : "Below (downtrend)") : null],
      ["RSI (14-day)", rsiTxt]])));
    sh.append(...section("Quality", kv([
      ["ROIC", r.roic == null ? null : num(r.roic) + "%"], ["FCF margin", r.fcf_margin == null ? null : num(r.fcf_margin) + "%"],
      ["Debt ÷ FCF", r.debt_fcf == null ? "n/a" : num(r.debt_fcf) + " yrs"], ["Piotroski", r.piotroski == null ? null : r.piotroski + "/9"],
      ["Gross margin", r.gross_margin == null ? null : num(r.gross_margin) + "%"], ["Need", r.need]])));
    if (w) sh.append(...section("Swing setup", kv([
      ["Verdict", w.swing === "NO TRADE" ? "No trade" : w.swing], ["Setup", setupLabel(w.setup)], ["Trend", w.trend],
      ["Support", w.support == null ? null : `${money(w.support, w.ccy)}${w.support_touches ? " · " + w.support_touches + " touches" : ""}`],
      ["Buy zone up to", w.buy_zone_top == null ? null : money(w.buy_zone_top, w.ccy)],
      ["Stop", w.stop == null ? null : `${money(w.stop, w.ccy)} (−${num(w.risk_pct)}%)`],
      ["Target", w.target == null ? null : `${money(w.target, w.ccy)} (+${num(w.reward_pct)}%)`],
      ["Reward ÷ risk", w.rr == null ? null : num(w.rr, 1)]])),
      w.swing_reason ? h("div", { class: "note" }, w.swing_reason) : null);
    sh.append(...section("Dates", kv([["Next earnings", dLong(r.next_earnings)], ["Scored", dLong(r.as_of)]])));
    if (r.note) sh.append(h("div", { class: "note" }, r.note));
    sh.append(h("a", { class: "btn", href: saUrl(r), target: "_blank", rel: "noopener" }, "Open on stockanalysis.com ↗"));
  });
}
function openHolding(r) {
  openSheet(sh => {
    sh.append(h("div", { class: "sh-head" }, logo(r.ticker, true),
      h("div", null, h("h2", null, r.ticker), h("div", { class: "nm" }, [r.name, r.sector].filter(Boolean).join(" · "))),
      h("span", { class: "pill g-" + SCAN_GROUP[r.scan] }, SCAN_LABEL[r.scan])));
    // why it's in the pie cleanup, if it is
    for (const p of (state.data.cleanup && state.data.cleanup.pies) || []) {
      const c = p.rows.find(x => x.ticker === r.ticker && x.action !== "keep");
      if (c) sh.append(...section("Pie cleanup · " + p.name.replace(/\s*-\s*custom$/i, ""), h("div", { class: "card" },
        h("span", { class: "pill g-" + (ACT[c.action] || ["", "hold"])[1] }, (ACT[c.action] || [c.label])[0]),
        h("div", { class: "mnote", style: { "margin-top": "8px" } }, c.why),
        h("div", { class: "faint" }, `${pct(c.return_pct, 0)} since bought · ${Number(c.share_pct).toFixed(1)}% of the pie`))));
    }
    const q = state.data.reviews && state.data.reviews.scores ? state.data.reviews.scores[r.ticker] : null;
    if (q && !q.error) sh.append(...section("Would the scorecard buy it today?", h("div", { class: "card" },
      h("div", { class: "sh-q" }, pill(q.signal), h("b", null, q.verdict === "buy" ? "Yes" : "No")),
      h("div", { class: "kpis" },
        kpi("Quality", `${q.quality}/40`, "25+ needed to buy"),
        kpi("Price ÷ sticker", q.price_to_sticker == null ? "n/a" : q.price_to_sticker + "×", "1.0 or less to buy"),
        kpi("Sticker", q.sticker == null ? "n/a" : money(q.sticker, "USD"), "buy below " + (q.mos == null ? "n/a" : money(q.mos, "USD"))),
        kpi("PEG", q.peg == null ? "n/a" : `${num(q.peg, 2)} · ${q.pe_signal}`)),
      h("div", { class: "note" }, q.why + ". " + (q.sticker_basis ? "Sticker: " + q.sticker_basis + "." : "")),
      h("div", { class: "note" }, "Scored with the same Rule 1 maths as the watchlist, from this week's stockanalysis data. One-off profits can flatten the picture; without a 5-year P/E history the sticker uses a P/E cap of 20."))));
    const flags = (r.flags || "").split("; ").filter(Boolean);
    sh.append(...section("Red flags", h("div", { class: "card" },
      flags.length ? h("ul", { style: { margin: "0", "padding-left": "18px" } }, flags.map(f => h("li", { class: "warn" }, f))) : h("div", { class: "sub" }, "Clear: the business checks pass. This is about price and growth, not a failing business."),
      h("div", { class: "note" }, r.checks === "full" ? "Full checks: ROIC, free cash flow, debt, Piotroski, Altman Z, gross margin. Two or more flags = sell warning." : "Checks " + r.checks + "."))));
    sh.append(...section("Your position", kv([["First bought", dLong(r.first_buy)], ["vs cost", r.vs_cost_pct == null ? "after next sync" : pct(r.vs_cost_pct)]])));
    if (!q) sh.append(h("p", { class: "note" }, "Not on the watchlist, so there's no sticker price or swing setup. Add it to the watchlist for the full score."));
    sh.append(h("a", { class: "btn", href: `https://stockanalysis.com/stocks/${r.ticker.toLowerCase()}/statistics/`, target: "_blank", rel: "noopener" }, "Open statistics ↗"));
  });
}
function kpi(label, value, sub) { return h("div", { class: "kpi" }, h("span", null, label), h("b", null, value), sub ? h("span", null, sub) : null); }
function sbar(label, v, max) {
  return h("div", { class: "sbar" }, h("span", null, label), h("i", { style: { "--w": Math.max(0, Math.min(100, v / max * 100)) + "%" } }), h("b", null, `${num(v, v % 1 ? 1 : 0)}/${max}`));
}

// ---------- marks ----------
function markSvg(cls) {
  return s("svg", { class: cls, viewBox: "0 0 100 100", "aria-hidden": "true" },
    s("line", { class: "mk-sup", x1: 15, y1: 63, x2: 85, y2: 63 }),
    s("polyline", { class: "mk-chart", points: "26,78 37,50 43,63 50,22 74,78" }),
    s("circle", { class: "mk-dot", cx: 43, cy: 63, r: 4.6 }));
}

// ---------- gestures ----------
function setupPullToRefresh() {
  const ptr = $("#ptr"); let y0 = null, dy = 0;
  window.addEventListener("touchstart", e => { y0 = (window.scrollY <= 0 && !sheetOpen && !$("#app").classList.contains("hidden")) ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    const p = Math.min(1, dy / 80);
    ptr.style.transform = `translateY(${-80 + p * 90}px) rotate(${p * 180}deg)`; ptr.style.opacity = String(p);
  }, { passive: true });
  window.addEventListener("touchend", () => {
    if (y0 != null && dy > 80) refresh(true);
    ptr.style.transform = ""; ptr.style.opacity = ""; y0 = null;
  });
  // swipe the sheet down to close
  const sh = $("#sheet"); let sy = null;
  sh.addEventListener("touchstart", e => { sy = sh.scrollTop <= 0 && !e.target.closest(".pc") ? e.touches[0].clientY : null; }, { passive: true });
  sh.addEventListener("touchmove", e => { if (sy != null) { const d = Math.max(0, e.touches[0].clientY - sy); sh.style.transform = d ? `translateY(${d}px)` : ""; } }, { passive: true });
  sh.addEventListener("touchend", e => {
    if (sy == null) return;
    const d = e.changedTouches[0].clientY - sy; sh.style.transform = ""; sy = null;
    if (d > 110) closeSheet(false);
  });
}

// ---------- boot ----------
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("nav#tabs button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#refresh").addEventListener("click", () => refresh(true));
  $("#scrim").addEventListener("click", () => closeSheet(false));
  window.addEventListener("scroll", () => $("#top").classList.toggle("scrolled", window.scrollY > 4), { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.token && (!state.fetchedAt || Date.now() - new Date(state.fetchedAt) > 10 * 60_000)) refresh();
  });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => state.data && !$("#app").classList.contains("hidden") && render(false), 200); });
  setupPullToRefresh();
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => {
    if (e.data && e.data.type === "aatrox-alert") refresh(true);
  });
  if (new URLSearchParams(location.search).get("from") === "push") setTimeout(() => playSound("chime"), 1400);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("../sw.js").catch(() => {});

  const start = () => (state.token ? showApp() : showOnboarding());
  const intro = $("#intro");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { intro.remove(); start(); return; }
  setTimeout(() => {
    start();
    const target = state.token ? $("#top .brand") : $("#onboard svg.big");
    const svg = intro.querySelector("svg");
    if (target) {
      const a = svg.getBoundingClientRect(), b = target.getBoundingClientRect();
      svg.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${b.width / a.width})`;
    }
    setTimeout(() => intro.classList.add("done"), 280);
    setTimeout(() => intro.remove(), 760);
  }, 1250);
});
