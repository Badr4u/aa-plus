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
  /** A name on at most two lines, broken at the space nearest its middle (AA writes "Claude Fable" over "5.2 (max)"). */
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

  return { Bars, pct, usd, esc };
})();
