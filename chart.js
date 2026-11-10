// Bar charts in Artificial Analysis's look, drawn as SVG and animated between states: bars keep their
// identity (one per model), so a change of pricing, plan or effort slides and resizes them and counts
// their values up or down instead of redrawing the chart. Used for the headline cards AA Plus takes
// over and for the chart it adds.
// eslint-disable-next-line no-unused-vars
const AAPlusChart = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (r) => { const v = r * 100; return `${v < 10 ? v.toFixed(1) : v.toFixed(0)}%`; };
  const usd = (v) => v == null ? "" : `$${v >= 100 ? v.toFixed(0) : v >= 0.01 ? v.toFixed(2) : v.toFixed(3)}`;
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const el = (name, attrs = {}) => { const node = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; };
  /** A name on at most two lines, broken at the space nearest its middle, as AA writes the names under its own bars. */
  function twoLines(name, limit = 13) {
    if (name.length <= limit) return [name];
    const spaces = [...name.matchAll(/ /g)].map((m) => m.index);
    if (!spaces.length) return [name];
    const cut = spaces.reduce((a, b) => Math.abs(b - name.length / 2) < Math.abs(a - name.length / 2) ? b : a);
    return [name.slice(0, cut), name.slice(cut + 1)];
  }

  let patternId = 0;
  /**
   * new Bars(host, { height, format, label: "inside" | "top", ariaLabel })
   * .update(items, { width })  items: [{ key, name, color, logo, value, title, pattern }] in drawing order.
   * The first update draws at once; later ones animate from what is on screen.
   */
  class Bars {
    constructor(host, { height = 288, format = String, label = "top", ariaLabel = "" } = {}) {
      this.host = host; this.height = height; this.format = format; this.labelAt = label;
      this.bars = new Map(); this.max = null; this.width = 0; this.raf = 0;
      this.pid = `aaplus-check-${++patternId}`;
      this.svg = el("svg", { role: "img", "aria-label": ariaLabel, style: "display:block;max-width:none;font-family:inherit;overflow:visible" });
      const defs = el("defs");
      defs.innerHTML = `<pattern id="${this.pid}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#fff" fill-opacity=".55"/><rect x="4" y="4" width="4" height="4" fill="#fff" fill-opacity=".55"/></pattern>`;
      this.grid = el("g"); this.layer = el("g");
      this.svg.append(defs, this.grid, this.layer);
      host.replaceChildren(this.svg);
    }

    layout(items, width) {
      const fs = 10.5, slant = 52 * Math.PI / 180, logo = 14, top = 16, lh = 12;
      const lines = items.map((i) => twoLines(i.name)), longest = Math.max(1, ...lines.flat().map((l) => l.length)) * fs * 0.54;
      const labelH = Math.ceil(longest * Math.sin(slant)) + (lines.some((l) => l.length > 1) ? lh : 0) + 10;
      const padL = Math.max(6, Math.ceil(longest * Math.cos(slant)) - 14), padR = 6;
      const W = Math.max(width, items.length * 26 + padL + padR), plotH = Math.max(60, this.height - top - 8 - logo - labelH);
      const band = (W - padL - padR) / Math.max(1, items.length);
      return { fs, slant, logo, top, lh, lines, W, plotH, band, bw: Math.max(8, Math.min(38, band * 0.76)), padL, padR, base: top + plotH };
    }

    update(items, { width }) {
      const L = this.layout(items, Math.max(120, width)), first = this.max == null || this.width !== L.W;
      // No axis is drawn, so the tallest bar fills the plot, as on AA's own cards.
      const max = Math.max(1e-9, ...items.map((i) => i.value));
      this.L = L; this.width = L.W;
      this.svg.setAttribute("width", L.W); this.svg.setAttribute("height", this.height); this.svg.setAttribute("viewBox", `0 0 ${L.W} ${this.height}`);
      this.grid.innerHTML = [1, 2, 3].map((k) => { const y = (L.base - L.plotH * k / 3).toFixed(1); return `<line x1="${L.padL}" x2="${L.W - L.padR}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity=".22" stroke-dasharray="1.5 4" stroke-linecap="round"/>`; }).join("");
      const seen = new Set();
      items.forEach((item, i) => {
        seen.add(item.key);
        const x = L.padL + L.band * (i + 0.5);
        let bar = this.bars.get(item.key);
        if (!bar) {
          const g = el("g"), rect = el("path"), check = el("path", { fill: `url(#${this.pid})` }), value = el("text", { "text-anchor": "middle", "font-size": 11, "font-weight": 500 }), img = el("image", { width: L.logo, height: L.logo, preserveAspectRatio: "xMidYMid meet" }), name = el("text", { "text-anchor": "end", "font-size": L.fs, fill: "currentColor" }), tip = el("title");
          g.append(tip, rect, check, value, img, name);
          this.layer.append(g);
          // A new bar grows from the baseline where it will stand.
          bar = { g, rect, check, value, img, name, tip, from: { x, v: 0, o: first ? 1 : 0 }, now: { x, v: first ? item.value : 0, o: first ? 1 : 0 } };
          this.bars.set(item.key, bar);
        } else bar.from = { ...bar.now };
        bar.to = { x, v: item.value, o: 1 };
        bar.item = item; bar.gone = false;
        bar.tip.textContent = item.title ?? `${item.name}: ${this.format(item.value)}`;
        bar.rect.setAttribute("fill", item.color || "#888");
        bar.check.style.display = item.pattern ? "" : "none";
        if (item.logo) bar.img.setAttribute("href", item.logo); else bar.img.removeAttribute("href");
        const lines = L.lines[i];
        bar.name.replaceChildren(...lines.map((line, k) => { const t = el("tspan", { x: 0, dy: k ? L.lh : 0 }); t.textContent = line; return t; }));
      });
      for (const [key, bar] of this.bars) if (!seen.has(key)) { bar.from = { ...bar.now }; bar.to = { x: bar.now.x, v: 0, o: 0 }; bar.gone = true; }
      const fromMax = this.max ?? max;
      this.maxFrom = first ? max : fromMax; this.maxTo = max;
      cancelAnimationFrame(this.raf);
      if (first || matchMedia("(prefers-reduced-motion: reduce)").matches) return this.frame(1);
      const t0 = performance.now(), run = (t) => { const k = Math.min(1, (t - t0) / 520); this.frame(ease(k)); if (k < 1) this.raf = requestAnimationFrame(run); };
      this.raf = requestAnimationFrame(run);
    }

    frame(t) {
      const L = this.L, max = lerp(this.maxFrom, this.maxTo, t);
      this.max = max;
      for (const [key, bar] of this.bars) {
        const x = lerp(bar.from.x, bar.to.x, t), v = lerp(bar.from.v, bar.to.v, t), o = lerp(bar.from.o, bar.to.o, t);
        bar.now = { x, v, o };
        if (bar.gone && t >= 1) { bar.g.remove(); this.bars.delete(key); continue; }
        const h = Math.max(1, (v / max) * L.plotH), y = L.base - h, r = Math.min(3, h), left = -L.bw / 2;
        const d = `M${left},${L.base}V${(y + r).toFixed(1)}q0,-${r} ${r},-${r}h${(L.bw - 2 * r).toFixed(1)}q${r},0 ${r},${r}V${L.base}Z`;
        bar.g.setAttribute("transform", `translate(${x.toFixed(1)},0)`);
        bar.g.setAttribute("opacity", o.toFixed(2));
        bar.rect.setAttribute("d", d); bar.check.setAttribute("d", d);
        const inside = this.labelAt === "inside" && h > 22;
        bar.value.textContent = this.format(v);
        bar.value.setAttribute("y", (inside ? y + h / 2 + 4 : y - 5).toFixed(1));
        bar.value.setAttribute("fill", inside ? "#fff" : "currentColor");
        bar.img.setAttribute("x", -L.logo / 2); bar.img.setAttribute("y", L.base + 8);
        bar.name.setAttribute("transform", `translate(4,${L.base + 8 + L.logo + 11}) rotate(-52)`);
      }
    }
  }

  /* ---------------- radar ---------------- */

  const NARROW = new Set("iIjl.,:;'|!· "), SLIM = new Set("ftr-()[]/"), WIDE = new Set("mwMW@%");
  /** Rough advance width of sans text in px; errs wide so a label is never laid out too small. */
  function textWidth(text, px) {
    let em = 0;
    for (const ch of text) em += NARROW.has(ch) ? 0.3 : SLIM.has(ch) ? 0.42 : WIDE.has(ch) ? 0.92 : /[A-Z]/.test(ch) ? 0.71 : /[0-9]/.test(ch) ? 0.64 : /[a-z]/.test(ch) ? 0.6 : 0.66;
    return em * px;
  }
  /** A name on as many lines as it needs, broken at spaces. Nothing is cut. */
  function wrap(text, px, maxW) {
    const lines = [];
    let line = "";
    for (const word of text.trim().split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (!line || textWidth(next, px) <= maxW) line = next; else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }

  /**
   * new Radar(host, { size, tip })   tip(axisIndex) returns the HTML of the card shown when a spoke's name is hovered.
   * .update({ axes: [{ key, name }], series: [{ key, name, color, dash, points: [0..1 | null] }], ghost: [0..1 | null] })
   * .focus(seriesKey | null)         dims every other shape.
   * One spoke per axis, evenly spaced from the top. A model with no score on a spoke skips it. Shapes keep their
   * identity (one per model), so a change of selection or effort morphs them.
   */
  class Radar {
    constructor(host, { size = 360, tip } = {}) {
      this.host = host; this.size = size; this.tip = tip; this.shapes = new Map(); this.axesKey = ""; this.raf = 0; this.focused = null;
      host.style.position = "relative";
      this.svg = el("svg", { role: "img", style: "display:block;max-width:100%;height:auto;font-family:inherit;overflow:visible;margin:0 auto" });
      this.back = el("g"); this.ghostPath = el("path", { fill: "currentColor", "fill-opacity": ".06", stroke: "currentColor", "stroke-opacity": ".45", "stroke-width": 1, "stroke-dasharray": "2 3" }); this.layer = el("g"); this.labels = el("g");
      this.svg.append(this.back, this.ghostPath, this.layer, this.labels);
      this.card = document.createElement("div"); this.card.className = "aap-tip"; this.card.hidden = true;
      host.replaceChildren(this.svg, this.card);
    }

    layout(axes) {
      const R = this.size / 2, px = 12, lh = 14.6, gap = 12, n = axes.length;
      const labels = axes.map((axis, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
        const anchor = Math.abs(c) < 0.2 ? "middle" : c > 0 ? "start" : "end";
        const lines = wrap(axis.name, px, anchor === "middle" ? 230 : 130), w = Math.max(...lines.map((l) => textWidth(l, px))), extra = (lines.length - 1) * lh;
        const x = c * (R + gap), ay = s * (R + gap), y = s < -0.6 ? ay - 4 - extra : s > 0.6 ? ay + 12 : ay + 4 - extra / 2;
        return { a, x, y, anchor, lines, w, h: extra + px * 1.3, left: anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2 };
      });
      const minX = Math.min(-R, ...labels.map((l) => l.left)), maxX = Math.max(R, ...labels.map((l) => l.left + l.w)), minY = Math.min(-R, ...labels.map((l) => l.y - px)), maxY = Math.max(R, ...labels.map((l) => l.y - px + l.h));
      const pad = 8, side = Math.max(-minX, maxX) + pad;
      return { R, px, lh, labels, W: Math.ceil(side * 2), H: Math.ceil(maxY - minY + pad * 2), cx: Math.ceil(side), cy: Math.ceil(-minY + pad) };
    }

    update({ axes, series, ghost }) {
      const key = JSON.stringify(axes.map((a) => [a.key, a.name])), first = key !== this.axesKey;
      if (first) {
        this.axesKey = key;
        const L = this.L = this.layout(axes);
        this.svg.setAttribute("width", L.W); this.svg.setAttribute("height", L.H); this.svg.setAttribute("viewBox", `0 0 ${L.W} ${L.H}`);
        this.back.innerHTML = [0.25, 0.5, 0.75, 1].map((t) => `<circle cx="${L.cx}" cy="${L.cy}" r="${(L.R * t).toFixed(1)}" fill="none" stroke="currentColor" stroke-opacity="${t === 1 ? 0.3 : 0.14}"/>`).join("") + L.labels.map((l) => `<line x1="${L.cx}" y1="${L.cy}" x2="${(L.cx + Math.cos(l.a) * L.R).toFixed(1)}" y2="${(L.cy + Math.sin(l.a) * L.R).toFixed(1)}" stroke="currentColor" stroke-opacity=".14"/>`).join("");
        this.labels.replaceChildren(...L.labels.map((l, i) => {
          const g = el("g", { style: "cursor:help" }), hit = el("rect", { x: (L.cx + l.left - 4).toFixed(1), y: (L.cy + l.y - L.px - 2).toFixed(1), width: (l.w + 8).toFixed(1), height: (l.h + 6).toFixed(1), fill: "transparent" }), text = el("text", { x: (L.cx + l.x).toFixed(1), y: (L.cy + l.y).toFixed(1), "text-anchor": l.anchor, "font-size": L.px, fill: "currentColor" });
          text.append(...l.lines.map((line, k) => { const t = el("tspan", { x: (L.cx + l.x).toFixed(1), dy: k ? L.lh : 0 }); t.textContent = line; return t; }));
          g.append(hit, text);
          g.addEventListener("mouseenter", () => this.showTip(i, text));
          g.addEventListener("mouseleave", () => this.showTip(null));
          return g;
        }));
        for (const shape of this.shapes.values()) shape.g.remove();
        this.shapes.clear();
      }
      const seen = new Set();
      for (const s of series) {
        seen.add(s.key);
        let shape = this.shapes.get(s.key);
        if (!shape) {
          const g = el("g"), path = el("path", { "stroke-width": 2, "stroke-linejoin": "round", "fill-opacity": ".07" }), dots = el("g");
          g.append(path, dots); this.layer.append(g);
          shape = { g, path, dots, now: { points: s.points.map((p) => (p == null ? null : first ? p : 0.1)), o: first ? 1 : 0 } };
          this.shapes.set(s.key, shape);
        }
        shape.from = { points: [...shape.now.points], o: shape.now.o }; shape.to = { points: s.points, o: 1 }; shape.gone = false; shape.series = s;
        shape.path.setAttribute("stroke", s.color); shape.path.setAttribute("fill", s.color);
        if (s.dash) shape.path.setAttribute("stroke-dasharray", s.dash); else shape.path.removeAttribute("stroke-dasharray");
      }
      for (const [k, shape] of this.shapes) if (!seen.has(k)) { shape.from = { points: [...shape.now.points], o: shape.now.o }; shape.to = { points: shape.now.points, o: 0 }; shape.gone = true; }
      this.ghostFrom = this.ghostNow ?? ghost; this.ghostTo = ghost;
      cancelAnimationFrame(this.raf);
      if (first || matchMedia("(prefers-reduced-motion: reduce)").matches) return this.frame(1);
      const t0 = performance.now(), run = (t) => { const k = Math.min(1, (t - t0) / 560); this.frame(ease(k)); if (k < 1) this.raf = requestAnimationFrame(run); };
      this.raf = requestAnimationFrame(run);
    }

    /** Points between two states: a spoke gaining a score grows from the centre, one losing it holds until the end. */
    between(from, to, t) { return to.map((b, i) => { const a = from?.[i] ?? null; return b == null ? (t < 1 ? a : null) : lerp(a ?? 0.1, b, t); }); }
    path(points) {
      const L = this.L, xy = points.flatMap((r, i) => r == null ? [] : [`${(L.cx + Math.cos(L.labels[i].a) * L.R * r).toFixed(1)},${(L.cy + Math.sin(L.labels[i].a) * L.R * r).toFixed(1)}`]);
      return xy.length > 1 ? `M${xy.join("L")}Z` : "";
    }
    frame(t) {
      const L = this.L;
      this.ghostNow = this.ghostTo ? this.between(this.ghostFrom, this.ghostTo, t) : null;
      this.ghostPath.setAttribute("d", this.ghostNow ? this.path(this.ghostNow) : "");
      for (const [key, shape] of this.shapes) {
        if (shape.gone && t >= 1) { shape.g.remove(); this.shapes.delete(key); continue; }
        const points = this.between(shape.from.points, shape.to.points, t), o = lerp(shape.from.o, shape.to.o, t);
        shape.now = { points, o };
        shape.path.setAttribute("d", this.path(points));
        shape.dots.innerHTML = points.map((r, i) => r == null ? "" : `<circle cx="${(L.cx + Math.cos(L.labels[i].a) * L.R * r).toFixed(1)}" cy="${(L.cy + Math.sin(L.labels[i].a) * L.R * r).toFixed(1)}" r="3.2" fill="${esc(shape.series.color)}" stroke="#fff" stroke-width="1.5"/>`).join("");
        shape.g.setAttribute("opacity", (o * (this.focused && this.focused !== key ? 0.15 : 1)).toFixed(2));
      }
    }
    focus(key) { this.focused = key; for (const [k, shape] of this.shapes) shape.g.setAttribute("opacity", (shape.now.o * (key && key !== k ? 0.15 : 1)).toFixed(2)); }

    showTip(i, anchor) {
      if (i == null || !this.tip) { this.card.hidden = true; return; }
      this.card.innerHTML = this.tip(i);
      this.card.hidden = false;
      // Under the name, held inside the chart.
      const host = this.host.getBoundingClientRect(), a = anchor.getBoundingClientRect(), w = this.card.offsetWidth;
      this.card.style.left = `${Math.max(0, Math.min(host.width - w, a.left - host.left + a.width / 2 - w / 2))}px`;
      this.card.style.top = `${a.bottom - host.top + 8}px`;
    }
  }

  return { Bars, Radar, pct, usd, esc };
})();
