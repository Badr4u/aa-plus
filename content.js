// The UI half of AA Plus on artificialanalysis.ai. Everything it adds sits inline, in AA's own look:
//  - a control row (pricing, effort, plans) where AA's "Effort: Max | API Default" switch was, and
//    again above the main charts;
//  - an API | Subscription switch beside the title of every cost chart it can really reprice;
//  - the three headline cards, redrawn so they follow the same controls and animate between states;
//  - one added chart, "Plan Price vs. API Price".
// Settings live in chrome.storage (the toolbar popup edits the same ones) and nothing reloads the page:
// page.js hands AA's own chart store new rows, and the headline cards tween.
/* global AAPlusChart, __aaPlusShared, chrome */
(() => {
  const S = __aaPlusShared, C = AAPlusChart, esc = C.esc;
  let settings = S.settingsOf(), prices = null, rows = null, rowsPath = null, state = null, rev = 1, plansOpen = false, alive = true;
  try { localStorage.removeItem("aaplus:v1"); } catch { /* an older version kept its settings here */ }

  /* ---------------- settings and plan prices ---------------- */

  const effortKey = () => JSON.stringify(settings.efforts);
  function configure() {
    window.postMessage({ aaplus: "config", pricing: settings.pricing, plans: settings.plans, efforts: settings.efforts, rev, prices: prices && { models: prices.models, slugs: prices.slugs } }, location.origin);
  }
  function adopt(next) {
    const before = effortKey();
    settings = S.settingsOf(next);
    if (effortKey() !== before) rev++;
    configure(); render();
  }
  function change(patch) {
    adopt({ ...settings, ...patch });
    try { chrome.storage.local.set({ settings }); } catch { alive = false; }
  }
  try {
    chrome.storage.local.get(["settings", "cache"], (got) => {
      if (got?.cache?.data) prices = S.adoptPrices(got.cache.data, got.cache.at);
      adopt(got?.settings);
      chrome.runtime.sendMessage({ type: "prices" }, (res) => { if (!chrome.runtime.lastError && res?.ok) { prices = S.adoptPrices(res.data, res.at); configure(); render(); } });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.cache?.newValue?.data) prices = S.adoptPrices(changes.cache.newValue.data, changes.cache.newValue.at);
      if (changes.settings) adopt(changes.settings.newValue); else if (changes.cache) { configure(); render(); }
    });
  } catch { alive = false; }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || typeof e.data !== "object") return;
    if (e.data.aaplus === "rows" && Array.isArray(e.data.rows)) { rows = e.data.rows; rowsPath = e.data.path; render(); }
    else if (e.data.aaplus === "state") { state = e.data; render(); }
  });

  const share = (slug) => S.share(prices, settings.plans, slug);
  const plan = () => settings.pricing === "plan";

  /* ---------------- styles ---------------- */

  const STYLE = `
[data-aaplus-off="row"]{display:none!important}
[data-aaplus-off="chart"]{position:absolute!important;left:16px;right:16px;opacity:0!important;pointer-events:none!important}
[data-aaplus-bar]{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px 14px;font:12px/1.2 suisseIntl,ui-sans-serif,system-ui,sans-serif;color:inherit;position:relative;z-index:5}
[data-aaplus-bar][data-at="scope"]{justify-content:flex-start;margin:0 0 20px;padding:8px 12px;border:1px solid rgba(128,128,128,.32);border-radius:8px;position:sticky;top:118px;z-index:20;background:#fff}
.dark [data-aaplus-bar][data-at="scope"]{background:rgb(10,10,10)}
@media (min-width:768px){[data-aaplus-bar][data-at="head"]{position:absolute;bottom:100%;right:0;margin-bottom:4px;max-width:calc(100% - 440px)}}
@media (max-width:767px){[data-aaplus-bar][data-at="head"]{align-self:flex-end;margin-bottom:8px}}
[data-aaplus-bar][data-at="head"][data-flow]{position:static;max-width:none;margin:0 0 8px}
.aap-group{display:inline-flex;align-items:center;gap:8px}
.aap-brand{display:inline-flex;align-items:center;gap:6px;font-weight:500;white-space:nowrap}
.aap-brand svg{width:18px;height:18px;border-radius:4px;display:block}
.aap-lbl{color:rgb(82,82,82);white-space:nowrap}
.dark .aap-lbl{color:rgb(163,163,163)}
.aap-seg{display:inline-flex;align-items:center;gap:4px;border-radius:4px;background:rgb(241,242,244);padding:2px}
.aap-seg button,.aap-plans>summary{height:28px;padding:0 11px;border:1px solid transparent;border-radius:4px;background:transparent;font:500 12px/1 suisseIntl,ui-sans-serif,system-ui,sans-serif;color:inherit;cursor:pointer;white-space:nowrap}
.aap-seg button[aria-pressed="true"]{background:#fff;border-color:rgb(231,231,231)}
.aap-seg i{width:1px;height:16px;background:rgba(128,128,128,.4);margin:0 2px}
.dark .aap-seg{background:rgb(38,38,38)}
.dark .aap-seg button[aria-pressed="true"]{background:rgb(10,10,10);border-color:rgb(64,64,64)}
.aap-plans{position:relative}
.aap-plans>summary{display:inline-flex;align-items:center;gap:5px;list-style:none;border-color:rgb(231,231,231)}
.aap-plans>summary::-webkit-details-marker{display:none}
.aap-plans>summary::after{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg)}
.aap-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:290px;max-height:360px;overflow:auto;background:#fff;color:#000;border:1px solid rgb(217,217,217);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.14);padding:10px 12px}
[data-at="scope"] .aap-pop{right:auto;left:0}
.dark .aap-pop{background:rgb(10,10,10);color:#fff;border-color:rgb(64,64,64)}
.aap-pop p{margin:0 0 8px;font-size:11.5px;line-height:1.4;opacity:.65}
.aap-pop label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px;font-size:12.5px}
.aap-pop select{max-width:170px;height:28px;border:1px solid rgb(217,217,217);border-radius:4px;background:transparent;color:inherit;padding:0 6px;font:12px suisseIntl,ui-sans-serif,system-ui,sans-serif}
.aap-mini{display:inline-flex;vertical-align:middle;margin-left:10px;position:relative;top:-2px}
.aap-mini button{height:22px;padding:0 8px;font-size:11px}
[data-aaplus-plot]{width:100%;overflow-x:auto;overflow-y:hidden}
[data-aaplus-card]{border:1px solid rgba(128,128,128,.32);border-radius:8px;padding:16px;margin-top:16px;position:relative}
[data-aaplus-card] .ap-head{display:flex;align-items:baseline;gap:8px;margin-bottom:12px}
[data-aaplus-card] .ap-sq{width:16px;height:16px;flex:none;background:#8841FD}
[data-aaplus-card] h3{font-family:victorSerifBasic,Georgia,Cambria,serif;font-size:24px;line-height:32px;font-weight:500;margin:0}
[data-aaplus-card] .ap-sub,[data-aaplus-card] .ap-foot{font-size:12px;line-height:16px;opacity:.6}
[data-aaplus-card] .ap-sub{margin-bottom:16px}
[data-aaplus-card] .ap-foot{margin-top:10px}
[data-aaplus-card] a{text-decoration:underline;text-underline-offset:2px}`;
  const LOGO = '<svg viewBox="0 0 200 200" aria-hidden="true"><rect width="200" height="200" rx="40" fill="#8841FD"/><g fill="#fff"><g transform="translate(-9 9)"><path d="M100 43h28.5v28.5H118L89.5 100H43V71.5h28.5z"/><rect x="128.5" y="71.5" width="28.5" height="28.5"/><path d="M100 100h28.5v28.5H118L89.5 157H43v-28.5h28.5z"/><rect x="128.5" y="128.5" width="28.5" height="28.5"/></g><path d="M149.5 29h11v12.5H173v11h-12.5V65h-11V52.5H137v-11h12.5z"/></g></svg>';

  /* ---------------- the control row ---------------- */

  const textOf = (h) => [...h.childNodes].filter((n) => !(n.nodeType === 1 && n.hasAttribute("data-aaplus-ui"))).map((n) => n.textContent).join("").trim();
  const pricingSeg = (cls = "") => `<span class="aap-seg ${cls}" role="group" aria-label="Cost pricing"><button type="button" data-aaplus-pricing="api" aria-pressed="${!plan()}" title="Artificial Analysis's own costs, at API prices">API</button><button type="button" data-aaplus-pricing="plan" aria-pressed="${plan()}" title="Each model at its plan's share of API price (data: Priors). Models with no plan stay at API price.">Subscription</button></span>`;

  function barHTML() {
    const e = settings.efforts, on = (what) => e.mode === what;
    const known = state?.available?.length ? state.available : ["low", "medium", "high", "xhigh", "max"];
    const efforts = S.EFFORTS.filter((x) => known.includes(x) || (e.mode === "pick" && e.list.includes(x)));
    const labs = plan() && prices ? prices.labs.filter((l) => l.plans.length > 1) : [];
    const picked = labs.filter((l) => settings.plans[l.id]).length;
    return `<span class="aap-brand" title="These controls are added by the AA Plus extension, not by Artificial Analysis">${LOGO}AA Plus</span>
<span class="aap-group"><span class="aap-lbl">Pricing</span>${pricingSeg()}</span>
<span class="aap-group"><span class="aap-lbl">Effort</span><span class="aap-seg" role="group" aria-label="Reasoning effort">
<button type="button" data-aaplus-effort="highest" aria-pressed="${on("highest")}" title="Each model at its highest effort">Highest</button>${state?.headline?.defaultIds?.length ? `<button type="button" data-aaplus-effort="default" aria-pressed="${on("default")}" title="The effort Artificial Analysis marks as each model's API default, where it marks one">API default</button>` : ""}<i></i>${efforts.map((x) => `<button type="button" data-aaplus-effort="${x}" aria-pressed="${e.mode === "pick" && e.list.includes(x)}" title="Show models at ${esc(S.EFFORT_LABEL[x])} effort">${esc(S.EFFORT_LABEL[x])}</button>`).join("")}</span></span>
${labs.length ? `<details class="aap-plans"${plansOpen ? " open" : ""}><summary>Plans${picked ? ` · ${picked}` : ""}</summary><div class="aap-pop"><p>The plan each lab's models are priced on. Default is the plan a model's price was measured on.</p>${labs.map((l) => `<label>${esc(l.name)}<select data-aaplus-lab="${esc(l.id)}"><option value="">Default</option>${l.plans.map((p) => `<option value="${esc(p.plan)}"${settings.plans[l.id] === p.plan ? " selected" : ""}>${esc(p.plan)}${Number.isFinite(p.feeUsd) ? ` · $${esc(p.feeUsd)}` : ""}</option>`).join("")}</select></label>`).join("")}</div></details>` : ""}`;
  }

  function placeBar(at, where, how) {
    let bar = document.querySelector(`[data-aaplus-bar][data-at="${at}"]`);
    if (!where) { bar?.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.dataset.aaplusBar = ""; bar.dataset.at = at; bar.setAttribute("data-aaplus-ui", ""); }
    if (how === "after" ? where.nextElementSibling !== bar : where.previousElementSibling !== bar) where[how](bar);
    const html = barHTML();
    // Rebuilt only when something it shows changed: a rebuild would close the plan list under the pointer.
    if (bar.dataset.key !== html) { bar.dataset.key = html; bar.innerHTML = html; }
  }

  /* ---------------- headline cards ---------------- */

  const CARDS = [
    { title: "Intelligence", value: (r) => r.ii, sort: (a, b) => b.value - a.value, format: (v) => v.toFixed(0), label: "inside", priced: false },
    { title: "Time per Task", value: (r) => r.time == null ? null : r.time / 60, sort: (a, b) => a.value - b.value, format: (v) => v.toFixed(1), label: "inside", priced: false },
    { title: "Cost per Task", value: (r, ratio) => r.cost == null ? null : r.cost * (ratio ?? 1), sort: (a, b) => a.value - b.value, format: C.usd, label: "top", priced: true },
  ];
  const charts = new WeakMap();
  /** One configuration per headline model under an effort choice: its best-scoring one when several qualify. */
  function variants(head, efforts) {
    const byId = new Map(rows.map((r) => [r.id, r])), rels = [...new Set(head.ids.map((id) => byId.get(id)?.rel).filter(Boolean))];
    const defaults = new Set(head.defaultIds), checked = new Set(Object.keys(head.patterns ?? {}).map((id) => byId.get(id)?.rel));
    return rels.flatMap((rel) => {
      const best = S.choose(rows.filter((r) => r.rel === rel), efforts, defaults).reduce((a, b) => (a && (a.ii ?? -1) >= (b.ii ?? -1) ? a : b), null);
      return best ? [{ ...best, pattern: checked.has(rel) }] : [];
    });
  }
  function headlineCards() {
    const head = state?.headline, ready = head && rows && rowsPath === location.pathname && state.path === location.pathname;
    const found = CARDS.map((def) => [...document.querySelectorAll("h3")].find((h) => !h.closest("[data-aaplus-scope], [data-aaplus-card]") && textOf(h) === def.title)?.closest(".rounded-lg"));
    const picked = ready ? variants(head, settings.efforts) : [];
    const ok = ready && picked.length >= 3 && found.every(Boolean);
    const row = document.querySelector('[role="group"][aria-label="Effort level"]')?.parentElement;
    if (!ok) {
      // Not enough to redraw them faithfully: leave AA's own cards and switch exactly as they are.
      for (const card of found) { if (!card) continue; card.querySelector('[data-aaplus-off="chart"]')?.removeAttribute("data-aaplus-off"); card.querySelector("[data-aaplus-plot]")?.remove(); charts.delete(card); }
      row?.removeAttribute("data-aaplus-off");
      placeBar("head", null);
      return false;
    }
    // In AA's own switch's place, where it sits above the cards; on a page without one, in a row of its own before them.
    if (row) { row.setAttribute("data-aaplus-off", "row"); placeBar("head", row, "after"); } else placeBar("head", found[0].parentElement, "before");
    document.querySelector('[data-aaplus-bar][data-at="head"]')?.toggleAttribute("data-flow", !row);
    const draw = (def, list, pricing) => list.map((r) => { const ratio = def.priced && pricing ? share(r.slug) : null, value = def.value(r, ratio); return value == null ? null : { key: r.rel, name: r.name, color: r.color, logo: r.logo, pattern: r.pattern, value, title: `${r.name}: ${def.format(value)}${def.priced ? (ratio ? ` at ${C.pct(ratio)} of API price (${C.usd(r.cost)})` : " at API price") : ""}` }; }).filter(Boolean).sort(def.sort);
    CARDS.forEach((def, i) => {
      const card = found[i], theirs = [...card.children].find((c) => c.querySelector(".recharts-responsive-container") && !c.hasAttribute("data-aaplus-plot"));
      let host = card.querySelector("[data-aaplus-plot]"), chart = charts.get(card);
      const width = Math.floor(card.clientWidth - 32);
      if (!host || !chart) {
        host?.remove();
        host = document.createElement("div"); host.dataset.aaplusPlot = ""; host.setAttribute("data-aaplus-ui", "");
        (theirs ?? card.lastElementChild).after(host);
        chart = new C.Bars(host, { height: theirs?.firstElementChild?.clientHeight || 288, format: def.format, label: def.label, ariaLabel: def.title });
        charts.set(card, chart);
        // Start from what AA itself shows (highest effort, API prices), so the first change is seen happening.
        chart.update(draw(def, variants(head, { mode: "highest", list: [] }), false), { width });
        chart.key = "";
      }
      theirs?.setAttribute("data-aaplus-off", "chart");
      const items = draw(def, picked, plan()), key = JSON.stringify([items.map((x) => [x.key, x.name, x.value]), width]);
      if (chart.key !== key) { chart.key = key; chart.update(items, { width }); }
    });
    return true;
  }

  /* ---------------- switches on cost charts, and the added chart ---------------- */

  function chartSwitches(cardsOurs) {
    for (const h of document.querySelectorAll("h2, h3")) {
      if (h.closest("[data-aaplus-card]")) continue;
      const mine = h.querySelector(":scope > [data-aaplus-note]"), text = textOf(h);
      // Only where the pricing really applies: charts under AA's model store, and the headline card AA Plus draws.
      const wants = /\bCost\b/.test(text) && !/Image|Video|Speech|Music|Audio/.test(text) && (h.closest("[data-aaplus-scope]") ? !!state?.scope : cardsOurs && text === "Cost per Task" && !!h.closest(".rounded-lg"));
      if (!wants) { mine?.remove(); continue; }
      const html = pricingSeg("aap-mini");
      if (!mine) { const s = document.createElement("span"); s.dataset.aaplusNote = ""; s.setAttribute("data-aaplus-ui", ""); s.dataset.key = html; s.innerHTML = html; h.append(s); }
      else if (mine.dataset.key !== html) { mine.dataset.key = html; mine.innerHTML = html; }
    }
  }

  let added = null;
  function addedChart() {
    const old = document.querySelector("[data-aaplus-card]");
    const heads = [...document.querySelectorAll("h2, h3")].filter((h) => !h.closest("[data-aaplus-card]"));
    const where = !settings.chart || !rows || !prices || rowsPath !== location.pathname ? null
      : heads.find((h) => textOf(h) === "Cost per Task")?.closest(".rounded-lg")?.parentElement ?? heads.find((h) => /^Cost per Intelligence Index Task|^Cost to Run/.test(textOf(h)))?.closest('[class*="scroll-mt"]') ?? null;
    const pick = (list) => {
      const seen = new Map(); let left = 0;
      for (const row of list) {
        const id = prices.slugs[row.slug], m = id && prices.models[id], r = share(row.slug);
        if (!m || r == null) { left++; continue; }
        const lab = prices.labs.find((l) => l.id === m.lab), chosen = settings.plans[m.lab] && m.plans?.[settings.plans[m.lab]] ? settings.plans[m.lab] : m.plan;
        const fee = chosen === m.plan ? m.fee : lab?.plans.find((p) => p.plan === chosen)?.feeUsd;
        if (!seen.has(id)) seen.set(id, { key: id, name: m.name, color: row.color, logo: row.logo, value: r, title: `${m.name}: ${C.pct(r)} of API price on ${chosen}${fee ? ` ($${fee}/mo)` : ""}. Confidence: ${m.conf}.${row.cost != null ? ` Cost per task: ${C.usd(row.cost * r)} on the plan, ${C.usd(row.cost)} at API price.` : ""}` });
      }
      return { items: [...seen.values()].sort((a, b) => a.value - b.value), left };
    };
    let data = where ? pick(rows.filter((r) => r.sel)) : { items: [], left: 0 };
    if (where && data.items.length < 4) data = pick(rows.filter((r) => r.ii != null).sort((a, b) => b.ii - a.ii).slice(0, 40));
    if (!where || data.items.length < 3) { old?.remove(); added = null; return; }
    let card = old;
    if (!card || !added) {
      old?.remove();
      card = document.createElement("div"); card.dataset.aaplusCard = ""; card.setAttribute("data-aaplus-ui", "");
      card.innerHTML = '<div class="ap-head"><div class="ap-sq"></div><h3>Plan Price vs. API Price</h3></div><div class="ap-sub">Share of the API price a subscriber pays for the same tokens (%) · Lower is better</div><div data-aaplus-plot></div><div class="ap-foot"></div>';
      added = new C.Bars(card.querySelector("[data-aaplus-plot]"), { height: 300, format: C.pct, label: "top", ariaLabel: "Plan price as a share of API price, by model" });
      added.key = "";
    }
    if (card.previousElementSibling !== where) where.after(card);
    const width = Math.floor(card.clientWidth - 34), key = JSON.stringify([data.items.map((x) => [x.key, x.value]), width]);
    if (added.key !== key) { added.key = key; added.update(data.items, { width }); }
    const foot = `Added by AA Plus, not Artificial Analysis. Plan data from <a href="https://mypriors.com" target="_blank" rel="noreferrer">Priors</a>, ${esc(prices.date)}.${data.left ? ` ${data.left} charted model${data.left === 1 ? " has" : "s have"} no first-party plan and ${data.left === 1 ? "is" : "are"} left out.` : ""}`;
    const footEl = card.querySelector(".ap-foot");
    if (footEl.dataset.key !== foot) { footEl.dataset.key = foot; footEl.innerHTML = foot; }
  }

  /* ---------------- drawing, and staying on the page ---------------- */

  let queued = false;
  function render() {
    if (queued || !document.body) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try {
        if (!document.getElementById("aaplus-style")) { const s = document.createElement("style"); s.id = "aaplus-style"; s.textContent = STYLE; document.head.append(s); }
        const ours = headlineCards();
        const scope = state?.scope && state.path === location.pathname ? document.querySelector("[data-aaplus-scope]") : null;
        placeBar("scope", scope, "before");
        chartSwitches(ours);
        addedChart();
      } catch (e) { console.warn("AA Plus:", e); }
    });
  }

  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-aaplus-pricing], [data-aaplus-effort]") : null;
    if (!t) {
      // A click elsewhere closes an open plan list.
      if (plansOpen && !(e.target instanceof Element && e.target.closest(".aap-plans"))) { plansOpen = false; for (const d of document.querySelectorAll(".aap-plans[open]")) d.open = false; }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (!alive) return;
    if (t.dataset.aaplusPricing) { if (t.dataset.aaplusPricing !== settings.pricing) change({ pricing: t.dataset.aaplusPricing }); }
    else change({ efforts: S.toggleEffort(settings.efforts, t.dataset.aaplusEffort) });
  }, true);
  document.addEventListener("toggle", (e) => { if (e.target instanceof Element && e.target.classList.contains("aap-plans")) plansOpen = e.target.open; }, true);
  document.addEventListener("change", (e) => {
    const lab = e.target instanceof Element ? e.target.getAttribute("data-aaplus-lab") : null;
    if (!lab || !alive) return;
    const plans = { ...settings.plans };
    if (e.target.value) plans[lab] = e.target.value; else delete plans[lab];
    change({ plans });
  }, true);

  function start() {
    configure(); render();
    window.postMessage({ aaplus: "ask" }, location.origin);
    // AA is a single-page app: sections come and go, and it redraws its own headings.
    let timer;
    new MutationObserver((list) => {
      if (list.every((m) => (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.("[data-aaplus-ui]"))) return;
      clearTimeout(timer); timer = setTimeout(render, 250);
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(render, 150); });
  }
  // After the page has drawn itself, so nothing is added while React is still claiming its markup.
  if (document.readyState === "complete") start(); else window.addEventListener("load", () => setTimeout(start, 200));
})();
