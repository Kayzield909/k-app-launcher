/* Aatrox V2 price chart: a big price with the period's change, a gradient line (green up, red down),
   range tabs, touch scrub, and the scorecard's levels as labelled dashed lines.
   window.PriceChart(host, opts) — opts: rows [{d, c}] oldest→newest, ccy, money(v, ccy), levels {...}, onPref */
"use strict";
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const C = { up: "#5fbf7a", down: "#e5604a", grid: "#2b2421", text: "#8c7f77", gold: "#e4b550", white: "#e9e2da", cost: "#8fb3ff", bg: "#191514" };
  const RANGES = [["1M", 21], ["3M", 63], ["6M", 126], ["1Y", 252], ["2Y", 504], ["5Y", 99999]];
  const RANGE_LABEL = { "1M": "Past month", "3M": "Past 3 months", "6M": "Past 6 months", "1Y": "Past year", "2Y": "Past 2 years", "5Y": "Past 5 years" };
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dLong = d => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  let uid = 0;

  function el(tag, attrs, ...kids) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
    kids.forEach(k => e.append(k));
    return e;
  }
  function div(cls, text) { const d = document.createElement("div"); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; }
  function sma(vals, n) {
    const out = new Array(vals.length).fill(null); let s = 0;
    for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  }
  function pref(k, dflt) { try { const v = localStorage.getItem("aatrox-chart-" + k); return v == null ? dflt : v; } catch (e) { return dflt; } }
  function setPref(k, v) { try { localStorage.setItem("aatrox-chart-" + k, v); } catch (e) {} }

  window.PriceChart = function (host, o) {
    const rows = o.rows, closes = rows.map(r => r.c);
    const ma50 = sma(closes, 50), ma200 = sma(closes, 200);
    const fmt = v => o.money(v, o.ccy);
    let range = pref("range", "1Y");
    const on = {
      levels: pref("levels", "1") === "1", value: pref("value", "1") === "1",
      cost: pref("cost", "1") === "1", avgs: pref("avgs", "0") === "1"
    };
    const id = ++uid;

    host.textContent = "";
    host.classList.add("pc");
    const head = div("pc-head");
    const priceEl = div("pc-price"), chgEl = div("pc-chg");
    head.append(priceEl, chgEl);
    const box = div("pc-box");
    const tabs = div("pc-tabs");
    const chips = div("pc-chips");
    host.append(head, box, tabs, chips);

    for (const [k] of RANGES) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = k; b.setAttribute("aria-pressed", String(k === range));
      b.addEventListener("click", () => { range = k; setPref("range", k); tabs.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); draw(true); });
      tabs.append(b);
    }
    const chipDefs = [["levels", "Support · stop · target"], ["value", "Sticker · buy below"], ["cost", "Your cost"], ["avgs", "50/200-day"]];
    for (const [k, label] of chipDefs) {
      if (k === "cost" && o.levels.cost == null) continue;
      if (k === "levels" && o.levels.support == null && o.levels.stop == null && o.levels.target == null) continue;
      if (k === "value" && o.levels.sticker == null) continue;
      const b = document.createElement("button");
      b.type = "button"; b.className = "pc-chip pc-chip-" + k; b.setAttribute("aria-pressed", String(on[k]));
      const dot = document.createElement("i"); b.append(dot, label);
      b.addEventListener("click", () => { on[k] = !on[k]; setPref(k, on[k] ? "1" : "0"); b.setAttribute("aria-pressed", String(on[k])); draw(false); });
      chips.append(b);
    }

    let view = null;
    function header(i) {
      const v = view; if (!v) return;
      const idx = i == null ? v.n - 1 : i;
      const c = v.c[idx], base = v.c[0], ch = c - base, pct = base ? ch / base * 100 : 0;
      priceEl.textContent = fmt(c);
      chgEl.textContent = "";
      const s = document.createElement("span");
      s.className = ch >= 0 ? "up" : "down";
      s.textContent = `${ch >= 0 ? "+" : "−"}${fmt(Math.abs(ch))} (${ch >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%)`;
      const when = document.createElement("span"); when.className = "pc-when";
      when.textContent = i == null ? RANGE_LABEL[range] : dLong(v.d[idx]);
      chgEl.append(s, " ", when);
    }

    function draw(animate) {
      const n0 = (RANGES.find(r => r[0] === range) || RANGES[3])[1];
      const start = Math.max(0, rows.length - 1 - n0);
      const d = rows.slice(start).map(r => r.d), c = closes.slice(start);
      const m50 = ma50.slice(start), m200 = ma200.slice(start);
      const W = Math.max(280, box.clientWidth || host.clientWidth || 360), H = 230, padT = 14, padB = 14, padR = 4;
      const n = c.length;
      const up = c[n - 1] >= c[0];
      const col = up ? C.up : C.down;
      let lo = Math.min(...c), hi = Math.max(...c);
      if (on.avgs) for (const a of [m50, m200]) for (const v of a) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const span0 = (hi - lo) || hi * 0.05;
      // levels: include those reasonably near the price range; the rest become edge pills
      const L = [];
      const lv = o.levels;
      if (on.levels) {
        if (lv.target != null) L.push({ k: "Target", v: lv.target, color: C.up });
        if (lv.support != null) L.push({ k: "Support", v: lv.support, color: C.up, zoneTop: lv.buyZoneTop });
        if (lv.stop != null) L.push({ k: "Stop", v: lv.stop, color: C.down });
      }
      if (on.value) {
        if (lv.sticker != null) L.push({ k: "Sticker", v: lv.sticker, color: C.white });
        if (lv.mos != null) L.push({ k: "Buy below", v: lv.mos, color: C.gold });
      }
      if (on.cost && lv.cost != null) L.push({ k: "Your cost", v: lv.cost, color: C.cost });
      for (const l of L) if (l.v >= lo - span0 * 0.35 && l.v <= hi + span0 * 0.35) { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); }
      const pad = (hi - lo) * 0.08 || hi * 0.02; lo -= pad; hi += pad;
      const x = i => (n === 1 ? 0 : i / (n - 1)) * (W - padR);
      const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
      view = { n, c, d, x, y, W, H };

      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "pc-svg", role: "img", "aria-label": "Price chart" });
      const gid = `pcg${id}`;
      svg.append(el("defs", null, el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
        el("stop", { offset: "0%", "stop-color": col, "stop-opacity": 0.32 }),
        el("stop", { offset: "100%", "stop-color": col, "stop-opacity": 0 }))));
      // faint price guides on the right
      for (let k = 1; k <= 3; k++) {
        const v = lo + (hi - lo) * k / 4;
        svg.append(el("line", { x1: 0, x2: W, y1: y(v), y2: y(v), stroke: C.grid, "stroke-width": 1 }));
        svg.append(el("text", { x: 6, y: y(v) - 4, "text-anchor": "start", class: "pc-axis" }, fmt(v)));
      }
      // buy zone band
      const sup = L.find(l => l.k === "Support");
      if (sup && sup.zoneTop != null && sup.v >= lo && sup.zoneTop <= hi)
        svg.append(el("rect", { x: 0, width: W, y: y(sup.zoneTop), height: Math.max(1, y(sup.v) - y(sup.zoneTop)), fill: C.up, opacity: 0.08 }));
      // averages
      if (on.avgs) for (const [a, cc] of [[m50, C.gold], [m200, C.white]]) {
        const pts = a.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean);
        if (pts.length > 1) svg.append(el("polyline", { points: pts.join(" "), fill: "none", stroke: cc, "stroke-width": 1.3, opacity: 0.55 }));
      }
      // area + line
      const line = c.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
      svg.append(el("path", { d: `${line}L${x(n - 1).toFixed(1)},${H}L0,${H}Z`, fill: `url(#${gid})`, class: animate ? "pc-fade" : null }));
      svg.append(el("path", { d: line, fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
        pathLength: 1, class: animate ? "pc-draw" : null }));
      // level lines and right-edge pills (nudged apart so labels never overlap)
      const pills = [];
      for (const l of L) {
        const inside = l.v >= lo && l.v <= hi;
        if (inside) svg.append(el("line", { x1: 0, x2: W, y1: y(l.v), y2: y(l.v), stroke: l.color, "stroke-width": 1, "stroke-dasharray": "4 4", opacity: 0.8 }));
        pills.push({ ...l, py: inside ? y(l.v) : (l.v > hi ? padT : H - padB), edge: inside ? "" : (l.v > hi ? "↑ " : "↓ ") });
      }
      pills.sort((a, b) => a.py - b.py);
      for (let i = 1; i < pills.length; i++) if (pills[i].py - pills[i - 1].py < 19) pills[i].py = pills[i - 1].py + 19;
      const over = pills.length ? Math.max(0, pills[pills.length - 1].py - (H - 10)) : 0;
      for (const p of pills) p.py -= over;
      for (const p of pills) {
        const label = `${p.edge}${p.k} ${fmt(p.v)}`;
        const tw = label.length * 6.1 + 12;
        const g = el("g", { transform: `translate(${W - tw - 2},${p.py - 9})` });
        g.append(el("rect", { width: tw, height: 18, rx: 9, fill: C.bg, stroke: p.color, "stroke-width": 1 }));
        g.append(el("text", { x: tw / 2, y: 12.5, "text-anchor": "middle", class: "pc-pill", fill: p.color }, label));
        svg.append(g);
      }
      // scrub layer
      const cross = el("line", { y1: 0, y2: H, stroke: "#a89a91", "stroke-width": 1, opacity: 0, "stroke-dasharray": "2 3" });
      const dot = el("circle", { r: 5, fill: col, stroke: C.bg, "stroke-width": 2, opacity: 0 });
      const last = el("circle", { cx: x(n - 1), cy: y(c[n - 1]), r: 3.5, fill: col });
      svg.append(last, cross, dot);
      const move = ev => {
        const r = svg.getBoundingClientRect();
        const px = (ev.clientX - r.left) / r.width * W;
        const i = Math.max(0, Math.min(n - 1, Math.round(px / (W - padR) * (n - 1))));
        cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("opacity", 1);
        dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(c[i])); dot.setAttribute("opacity", 1);
        last.setAttribute("opacity", 0);
        header(i);
      };
      const end = () => { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); last.setAttribute("opacity", 1); header(null); };
      svg.addEventListener("pointerdown", e => { move(e); try { navigator.vibrate && navigator.vibrate(4); } catch (x) {} });
      svg.addEventListener("pointermove", e => { if (e.pointerType === "mouse" || e.buttons || e.pressure > 0) move(e); });
      svg.addEventListener("pointerup", end); svg.addEventListener("pointerleave", end); svg.addEventListener("pointercancel", end);

      box.textContent = ""; box.append(svg);
      header(null);
    }
    draw(true);
    let rt; const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => draw(false), 120); });
    ro.observe(box);
  };

  window.Sparkline = function (closes, w = 72, h = 30) {
    const lo = Math.min(...closes), hi = Math.max(...closes), n = closes.length;
    const col = closes[n - 1] >= closes[0] ? C.up : C.down;
    const pts = closes.map((v, i) => `${(i / (n - 1) * w).toFixed(1)},${(2 + (1 - (v - lo) / ((hi - lo) || 1)) * (h - 4)).toFixed(1)}`).join(" ");
    return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: "spark", "aria-hidden": "true" },
      el("polyline", { points: pts, fill: "none", stroke: col, "stroke-width": 1.6, "stroke-linejoin": "round" }));
  };

  window.PeBand = function (vals, now, median, w = 300) {
    const all = vals.concat(now != null ? [now] : []);
    if (all.length < 2) return null;
    const lo = Math.min(...all), hi = Math.max(...all), h = 46, pl = 8, pr = 8;
    const x = v => pl + (v - lo) / ((hi - lo) || 1) * (w - pl - pr);
    const s = el("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", class: "peband", role: "img", "aria-label": "P/E today against the last five years" });
    s.append(el("rect", { x: pl, y: 18, width: w - pl - pr, height: 6, rx: 3, fill: C.grid }));
    for (const v of vals) s.append(el("circle", { cx: x(v), cy: 21, r: 3, fill: C.text }));
    if (median != null) {
      s.append(el("line", { x1: x(median), x2: x(median), y1: 12, y2: 30, stroke: C.white, "stroke-width": 1.5 }));
      s.append(el("text", { x: x(median), y: 42, "text-anchor": "middle", class: "pc-axis" }, `5-yr median ${median.toFixed(1)}`));
    }
    if (now != null) {
      s.append(el("circle", { cx: x(now), cy: 21, r: 6, fill: C.gold, stroke: C.bg, "stroke-width": 2 }));
      s.append(el("text", { x: Math.min(w - 30, Math.max(30, x(now))), y: 9, "text-anchor": "middle", class: "pc-axis gold" }, `today ${now.toFixed(1)}`));
    }
    return s;
  };
})();
