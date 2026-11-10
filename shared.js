// Logic both halves of the extension need: the page-side bridge (page.js) and the UI (content.js, popup.js).
// Loaded into each world separately; nothing here touches the DOM.
// eslint-disable-next-line no-unused-vars
var __aaPlusShared = (() => {
  /** Reasoning efforts, lowest first. `default` is a model with a single configuration: it is always shown. */
  const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const RANK = { none: 0, minimal: 1, low: 2, medium: 3, default: 3.5, high: 4, xhigh: 5, max: 6 };
  const EFFORT_LABEL = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max" };
  const DEFAULTS = { pricing: "plan", plans: {}, efforts: { mode: "highest", list: [] }, chart: true };

  /** AA names a model's configuration in its `suffix`: "Max, Default Fallback", "Non-reasoning", "Reasoning", none at all. */
  function effortOf(suffix) {
    const first = String(suffix ?? "").toLowerCase().split(",")[0].trim();
    if (first in RANK && first !== "default") return first;
    return first === "non-reasoning" ? "none" : "default";
  }

  /**
   * Which of one model's configurations to show. `rows`: [{ id, eff, ii }] for a single model.
   * - highest: its highest effort (what AA calls Max).
   * - default: the one AA marks as the API default, when it marks one; otherwise as highest.
   * - pick: every configuration at a picked effort.
   * A configuration AA has not scored (`ii` null) is never chosen over one it has.
   */
  function choose(rows, efforts, defaultIds) {
    const scored = rows.filter((r) => r.ii != null), pool = scored.length ? scored : rows;
    const top = () => pool.reduce((a, b) => (RANK[b.eff] - RANK[a.eff] || (b.ii ?? -1) - (a.ii ?? -1)) > 0 ? b : a);
    if (!pool.length) return [];
    if (efforts?.mode === "pick" && efforts.list?.length) return pool.filter((r) => r.eff === "default" || efforts.list.includes(r.eff));
    if (efforts?.mode === "default") { const marked = pool.find((r) => defaultIds?.has(r.id)); return [marked ?? top()]; }
    return [top()];
  }

  /** The share of API price a subscriber pays for this model, on the plan picked for its lab; null when no plan sells it. */
  function share(prices, plans, slug) {
    const id = prices?.slugs?.[slug], m = id && prices.models?.[id];
    if (!m) return null;
    const picked = plans?.[m.lab], r = (picked && m.plans?.[picked]) ?? m.r;
    return r > 0 && r < 1 ? r : null;
  }

  /** Keep only the shapes the UI reads from Priors' `/api/plan-prices`. A free tier is not a price: a free model uses its paid plan. */
  function adoptPrices(data, at) {
    const models = {}, slugs = {};
    for (const m of Array.isArray(data?.models) ? data.models : []) {
      const p = m.free ? m.paid : m;
      if (!p || !(p.ratio > 0)) continue;
      models[m.id] = { name: String(m.name), lab: String(m.lab), r: p.ratio, plan: String(p.plan), fee: Number.isFinite(p.feeUsd) ? p.feeUsd : undefined, conf: String(p.confidence), plans: m.plans ? Object.fromEntries(Object.entries(m.plans).filter(([, v]) => v?.ratio > 0).map(([k, v]) => [k, v.ratio])) : undefined };
      for (const slug of m.aa ?? []) slugs[String(slug)] = m.id;
    }
    const labs = (Array.isArray(data?.labs) ? data.labs : []).map((l) => ({ id: String(l.id), name: String(l.name), plans: (Array.isArray(l.plans) ? l.plans : []).map((p) => ({ plan: String(p.plan), ...(Number.isFinite(p.feeUsd) ? { feeUsd: p.feeUsd } : {}) })) }));
    return { date: String(data?.date ?? ""), at, labs, models, slugs };
  }

  const settingsOf = (stored) => ({ ...DEFAULTS, ...stored, plans: { ...stored?.plans }, efforts: { ...DEFAULTS.efforts, ...stored?.efforts, list: [...(stored?.efforts?.list ?? [])].filter((e) => EFFORTS.includes(e)) } });

  /** The effort setting after a click on one control of the picker. */
  function toggleEffort(efforts, what) {
    if (what === "highest" || what === "default") return { mode: what, list: [] };
    const list = efforts.mode === "pick" ? (efforts.list.includes(what) ? efforts.list.filter((e) => e !== what) : [...efforts.list, what]) : [what];
    return list.length ? { mode: "pick", list: EFFORTS.filter((e) => list.includes(e)) } : { mode: "highest", list: [] };
  }

  return { EFFORTS, RANK, EFFORT_LABEL, DEFAULTS, effortOf, choose, share, adoptPrices, settingsOf, toggleEffort };
})();
