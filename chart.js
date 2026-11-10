// Charts AA Plus adds to the page, drawn as plain SVG in Artificial Analysis's own look: creator-coloured
// bars with the value on top, dotted gridlines, a creator logo and a slanted name under each bar.
// eslint-disable-next-line no-unused-vars
const AAPlusChart = (() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (r) => { const v = r * 100; return `${v < 10 ? v.toFixed(1) : v.toFixed(0)}%`; };
  const usd = (v) => v == null ? "" : `$${v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)}`;
  /** A round top for the scale: 1, 2, 2.5 or 5 times a power of ten, at or above the largest bar. */
  function niceMax(v) {
    const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  /**
   * items: [{ name, color, logo, ratio, title }], drawn left to right in the order given.
   * `width` is the room on the page; a chart with many bars grows past it and its wrapper scrolls.
   */
  function bars(items, { width, ink = "currentColor" }) {
    const n = items.length, padR = 6, top = 22, plotH = 200, logo = 16, slant = 50 * Math.PI / 180, fs = 11;
    const longest = Math.max(...items.map((i) => i.name.length)) * fs * 0.56;
    const labelH = Math.ceil(longest * Math.sin(slant)) + 14;
    // The first name slants down to the left of its bar, so the left margin has to hold it.
    const padX = Math.max(6, Math.ceil(longest * Math.cos(slant)) - 10);
    const W = Math.max(width, n * 30 + padX + padR), H = top + plotH + 8 + logo + labelH;
    const band = (W - padX - padR) / n, bw = Math.max(10, Math.min(36, band * 0.74));
    const max = niceMax(Math.max(...items.map((i) => i.ratio))), y = (r) => top + plotH - (r / max) * plotH;
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Plan price as a share of API price, by model" style="display:block;max-width:none;font-family:inherit">`];
    for (let k = 1; k <= 4; k++) out.push(`<line x1="${padX}" x2="${W - padR}" y1="${y(max * k / 4).toFixed(1)}" y2="${y(max * k / 4).toFixed(1)}" stroke="${ink}" stroke-opacity="0.22" stroke-dasharray="1.5 4" stroke-linecap="round"/>`);
    out.push(`<line x1="${padX}" x2="${W - padR}" y1="${top + plotH}" y2="${top + plotH}" stroke="${ink}" stroke-opacity="0.18"/>`);
    items.forEach((it, i) => {
      const cx = padX + band * (i + 0.5), x = cx - bw / 2, yy = y(it.ratio), h = Math.max(1, top + plotH - yy), r = Math.min(3, h);
      out.push(`<g><title>${esc(it.title)}</title>`);
      out.push(`<path d="M${x.toFixed(1)},${top + plotH}V${(yy + r).toFixed(1)}q0,-${r} ${r},-${r}h${(bw - 2 * r).toFixed(1)}q${r},0 ${r},${r}V${top + plotH}Z" fill="${esc(it.color || "#888")}"/>`);
      out.push(`<text x="${cx.toFixed(1)}" y="${(yy - 5).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="500" fill="${ink}">${pct(it.ratio)}</text>`);
      if (it.logo) out.push(`<image href="${esc(it.logo)}" x="${(cx - logo / 2).toFixed(1)}" y="${top + plotH + 8}" width="${logo}" height="${logo}" preserveAspectRatio="xMidYMid meet"/>`);
      const ly = top + plotH + 8 + logo + 10;
      out.push(`<text transform="translate(${(cx + 4).toFixed(1)},${ly}) rotate(-50)" text-anchor="end" font-size="${fs}" fill="${ink}">${esc(it.name)}</text>`);
      out.push("</g>");
    });
    out.push("</svg>");
    return out.join("");
  }

  return { bars, pct, usd, esc };
})();
