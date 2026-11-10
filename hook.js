// Runs in the page itself, before Artificial Analysis's own code. AA decrypts its chart data in the
// browser and hands it to JSON.parse; this wraps JSON.parse so the model rows can be read (for the
// charts AA Plus adds) and, with Subscription pricing on, repriced before AA's charts ever see them.
// AA then draws its own charts, tooltips and tables from the repriced rows, in its own style.
(() => {
  if (window.__aaPlusHook) return;
  window.__aaPlusHook = true;
  const KEY = "aaplus:v1", parse = JSON.parse;
  let last = null, flight = 0;

  const state = () => { try { return parse(localStorage.getItem(KEY) || "null") || {}; } catch { return {}; } };
  const scale = (v, r) => typeof v === "number" ? (Number.isFinite(v) ? v * r : v)
    : Array.isArray(v) ? v.map((x) => scale(x, r))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scale(x, r)])) : v;
  // Dollar costs of running something (a task, an index, an evaluation). Token list prices are left as published.
  const isCost = (key) => /cost/i.test(key) && !/^price|token/i.test(key);
  const total = (c) => c == null ? null : typeof c === "number" ? c : typeof c.total === "number" ? c.total : typeof c.cost?.total === "number" ? c.cost.total : null;

  /** The share of API price a subscriber pays for this AA model, on the plan picked for its lab. */
  function share(slug, s) {
    const id = s.prices?.slugs?.[slug], m = id && s.prices.models?.[id];
    if (!m) return null;
    const picked = s.settings?.plans?.[m.lab], r = (picked && m.plans?.[picked]) ?? m.r;
    return r > 0 && r < 1 ? r : null;
  }

  function rows(list, s) {
    const on = (s.settings?.pricing ?? "plan") === "plan";
    const out = [];
    let applied = 0;
    for (const m of list) {
      if (!m || typeof m.slug !== "string") continue;
      const api = total(m.intelligenceIndexCostPerTask), r = share(m.slug, s);
      if (m.creator) out.push({ slug: m.slug, name: m.shortName ?? m.name, creator: m.creator.name, color: m.creator.color, logo: m.creator.logo, ii: m.intelligenceIndex ?? null, sel: !!m.chartDefaultSelected, api });
      if (!on || r == null) continue;
      let touched = false;
      for (const key of Object.keys(m)) if (isCost(key) && m[key] != null) { m[key] = scale(m[key], r); touched = true; }
      if (touched) applied++;
    }
    return { out, applied };
  }

  function visit(root) {
    const s = state();
    const lists = (Array.isArray(root) ? [root] : Object.values(root)).filter((v) => Array.isArray(v) && v.length > 5 && v[0] && typeof v[0] === "object" && typeof v[0].slug === "string");
    for (const list of lists) {
      const { out, applied } = rows(list, s);
      if (out.length < 20) continue;
      last = { aaplus: "rows", rows: out, applied, served: flight, pricing: s.settings?.pricing ?? "plan", path: location.pathname };
      window.postMessage(last, location.origin);
    }
  }

  const wrapped = function (text, reviver) {
    const out = parse.call(this, text, reviver);
    try { if (typeof text === "string" && text.length > 50000 && out && typeof out === "object" && !out.$$typeof) visit(out); } catch { /* never break the page over a chart */ }
    return out;
  };
  Object.defineProperty(wrapped, "name", { value: "parse" });
  JSON.parse = wrapped;

  /* ---- Server-rendered charts ----
   * The headline cards (and a few others) do not use the decrypted table: the server sends each one a
   * ready-made list of bars inside Next.js's page data (`self.__next_f.push([1, "…"])`). A cost chart's
   * list is repriced here, before Next reads it, and put back in order so the cheapest still comes first. */
  const money = (v) => `$$${v >= 0.01 ? v.toFixed(2) : v >= 0.001 ? v.toFixed(3) : v.toFixed(4)}`;
  const BARS = /\[\{"id":"[0-9a-f-]{36}","label":/g;

  /** Index of the bracket that closes the array opening at `from`, or -1 when the text stops first. */
  function closing(text, from) {
    let depth = 0, quoted = false;
    for (let i = from; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === "[" || c === "{") depth++;
      else if ((c === "]" || c === "}") && --depth === 0) return i;
    }
    return -1;
  }

  function reprice(text, s) {
    let out = "", done = 0, changed = 0, m;
    BARS.lastIndex = 0;
    while ((m = BARS.exec(text))) {
      const end = closing(text, m.index);
      if (end < 0) break;
      BARS.lastIndex = end;
      let bars;
      try { bars = parse(text.slice(m.index, end + 1)); } catch { continue; }
      // A cost chart: every bar is in dollars and the card's own title says cost. Token-price charts are left alone.
      const titles = [...text.slice(Math.max(0, m.index - 3000), m.index).matchAll(/"children":"([^"]{3,80})"/g)].map((t) => t[1]).filter((t) => !/publicly available/i.test(t));
      if (!bars.every((b) => typeof b?.value === "number" && typeof b.displayValue === "string" && b.displayValue.startsWith("$$")) || !/\bcost\b/i.test(titles.at(-1) ?? "")) continue;
      const rising = bars.every((b, i) => !i || bars[i - 1].value <= b.value), falling = bars.every((b, i) => !i || bars[i - 1].value >= b.value);
      let touched = 0;
      for (const b of bars) {
        const r = share(String(b.url ?? "").match(/^\/models\/([^/?#]+)/)?.[1] ?? "", s);
        if (r == null) continue;
        b.value *= r; b.displayValue = money(b.value); touched++;
      }
      if (!touched) continue;
      if (rising) bars.sort((a, b) => a.value - b.value); else if (falling) bars.sort((a, b) => b.value - a.value);
      out += text.slice(done, m.index) + JSON.stringify(bars);
      done = end + 1; changed += touched;
    }
    if (changed) flight += changed;
    return changed ? out + text.slice(done) : text;
  }

  /* The charts further down start from a short list of model rows the server sends the same way
   * (`initialData`, `initialModels`), in the same shape as the decrypted table. Each line of page data
   * is one value; a line that mentions a cost is read, its model rows repriced, and written back. */
  const COST_KEY = /Cost(PerTask)?"/;
  function walk(node, s, depth) {
    if (!node || typeof node !== "object" || depth > 80) return 0;
    if (Array.isArray(node) && node.length > 2 && node[0] && typeof node[0] === "object" && !Array.isArray(node[0]) && typeof node[0].slug === "string") return rows(node, s).applied;
    let n = 0;
    for (const child of Array.isArray(node) ? node : Object.values(node)) n += walk(child, s, depth + 1);
    return n;
  }
  function served(text, s) {
    if (!COST_KEY.test(text)) return text;
    return text.split("\n").map((line) => {
      const head = /^[0-9a-f]+:(?=[[{])/.exec(line);
      if (!head || !COST_KEY.test(line)) return line;
      let tree;
      try { tree = parse(line.slice(head[0].length)); } catch { return line; }
      const n = walk(tree, s, 0);
      flight += n;
      return n ? head[0] + JSON.stringify(tree) : line;
    }).join("\n");
  }

  const feed = [];
  let deliver = Array.prototype.push;
  const push = (...items) => {
    let n = feed.length;
    for (const item of items) {
      try {
        if (Array.isArray(item) && item[0] === 1 && typeof item[1] === "string" && (item[1].includes('"displayValue":"$$') || COST_KEY.test(item[1]))) {
          const s = state();
          if ((s.settings?.pricing ?? "plan") === "plan" && s.prices) item[1] = served(reprice(item[1], s), s);
        }
      } catch { /* hand the page its data untouched */ }
      n = deliver.call(feed, item);
    }
    return n;
  };
  // Next's client takes the list over by assigning its own `push`; keep ours in front of it.
  Object.defineProperty(feed, "push", { configurable: true, get: () => push, set: (fn) => { if (typeof fn === "function") deliver = fn; } });
  if (Array.isArray(self.__next_f)) for (const item of self.__next_f) push(item);
  self.__next_f = feed;

  // The panel may start listening after the data went by.
  window.addEventListener("message", (e) => { if (e.source === window && e.data?.aaplus === "ask" && last) window.postMessage(last, location.origin); });
})();
