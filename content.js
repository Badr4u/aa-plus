// AA Plus on artificialanalysis.ai: the control panel, the chart it adds, and the labels that say
// which of AA's own charts have been repriced. The repricing itself happens in hook.js; this script
// keeps the settings and the plan prices where the hook can read them (the page's localStorage).
/* global AAPlusChart, chrome */
(() => {
  const KEY = "aaplus:v1", SCROLL = "aaplus:scroll", RELOADED = "aaplus:reloaded";
  const DEFAULTS = { pricing: "plan", plans: {}, chart: true };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null") || {}; } catch { return {}; } };
  const state = read();
  state.settings = { ...DEFAULTS, ...state.settings };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked: the panel still works for this page */ } };
  save();

  /** What the hook last read from the page: AA's model rows, and how many it repriced. */
  let page = null, open = false, plansOpen = false, note = "";
  const esc = AAPlusChart.esc;

  /* ---------------- plan prices from Priors ---------------- */

  /** Keep only what the hook needs: per model, the share of API price on its default plan and on each plan its lab sells. */
  function adopt(data, at) {
    const models = {}, slugs = {};
    for (const m of data.models) {
      // A free tier is not a price: a model free today is priced on its paid plan, or left at API price without one.
      const p = m.free ? m.paid : m;
      if (!p || !(p.ratio > 0)) continue;
      models[m.id] = { name: m.name, lab: m.lab, r: p.ratio, plan: p.plan, fee: p.feeUsd, conf: p.confidence, plans: m.plans ? Object.fromEntries(Object.entries(m.plans).map(([k, v]) => [k, v.ratio])) : undefined };
      for (const slug of m.aa ?? []) slugs[slug] = m.id;
    }
    const before = JSON.stringify([state.prices?.models, state.prices?.slugs]);
    state.prices = { date: data.date, at, labs: data.labs ?? [], models, slugs };
    save();
    return before !== JSON.stringify([models, slugs]);
  }

  function reload() {
    try { sessionStorage.setItem(SCROLL, String(window.scrollY)); } catch { /* fine */ }
    location.reload();
  }

  function fetchPrices(force) {
    const first = !state.prices;
    try {
      chrome.runtime.sendMessage({ type: "prices", force }, (res) => {
        if (chrome.runtime.lastError || !res) { note = "Could not reach the extension. Reload the page."; return render(); }
        if (!res.ok) { note = `No plan data: ${res.error}`; return render(); }
        const changed = adopt(res.data, res.at);
        note = res.stale ? `Priors could not be reached (${res.stale}); using plan data from ${state.prices.date}.` : "";
        // The page loaded before any plan data existed, so its costs are still API-priced: load it once more.
        if (first && state.settings.pricing === "plan" && !sessionStorage.getItem(RELOADED)) { sessionStorage.setItem(RELOADED, "1"); return reload(); }
        if (changed && !first && state.settings.pricing === "plan" && page?.pricing === "plan") note = "Plan data changed since this page loaded. Reload to apply it.";
        render();
      });
    } catch { note = "The extension was updated. Reload the page."; render(); }
  }

  /* ---------------- the page's rows ---------------- */

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.aaplus !== "rows") return;
    // A page can hand over several tables; the one with the most models is the one its charts use.
    if (!page || page.path !== e.data.path || e.data.rows.length >= page.rows.length) page = e.data;
    render();
    const y = Number(sessionStorage.getItem(SCROLL));
    if (y > 0) { sessionStorage.removeItem(SCROLL); setTimeout(() => window.scrollTo(0, y), 250); }
  });

  const priced = (slug) => { const id = state.prices?.slugs?.[slug], m = id && state.prices.models[id]; if (!m) return null; const picked = state.settings.plans[m.lab], r = (picked && m.plans?.[picked]) ?? m.r; return r > 0 && r < 1 ? { id, ...m, r, plan: picked && m.plans?.[picked] ? picked : m.plan, fee: picked && m.plans?.[picked] ? state.prices.labs.find((l) => l.id === m.lab)?.plans.find((p) => p.plan === picked)?.feeUsd : m.fee } : null; };

  /** One bar per model AA charts by default that a plan sells, cheapest share first. */
  function chartItems() {
    if (!page || !state.prices) return { items: [], left: 0 };
    const pick = (rows) => {
      const seen = new Map(); let left = 0;
      for (const row of rows) {
        const p = priced(row.slug);
        if (!p) { left++; continue; }
        // AA lists a model once per reasoning effort; the plan's share is the same for all of them.
        if (!seen.has(p.id)) seen.set(p.id, { name: p.name, color: row.color, logo: row.logo, ratio: p.r, title: `${p.name}: ${AAPlusChart.pct(p.r)} of API price on ${p.plan}${p.fee ? ` ($${p.fee}/mo)` : ""}. Confidence: ${p.conf}.${row.api != null ? ` Cost per task: ${AAPlusChart.usd(row.api * p.r)} on the plan, ${AAPlusChart.usd(row.api)} at API price.` : ""}` });
      }
      return { items: [...seen.values()].sort((a, b) => a.ratio - b.ratio), left };
    };
    const chosen = pick(page.rows.filter((r) => r.sel));
    // A page that highlights few models: the most capable ones a plan sells.
    return chosen.items.length >= 4 ? chosen : pick(page.rows.filter((r) => r.ii != null).sort((a, b) => b.ii - a.ii).slice(0, 40));
  }

  /* ---------------- on the page: added chart, and labels on repriced charts ---------------- */

  const STYLE = `
[data-aaplus-card]{border:1px solid rgba(128,128,128,.32);border-radius:8px;padding:16px;margin-top:16px;position:relative}
[data-aaplus-card] .ap-head{display:flex;align-items:baseline;gap:8px;margin-bottom:12px}
[data-aaplus-card] .ap-sq{width:16px;height:16px;flex:none;background:currentColor}
[data-aaplus-card] h3{font-family:victorSerifBasic,Georgia,Cambria,serif;font-size:24px;line-height:32px;font-weight:500;margin:0}
[data-aaplus-card] .ap-sub{font-size:12px;line-height:16px;opacity:.6;margin-bottom:16px}
[data-aaplus-card] .ap-plot{width:100%;overflow-x:auto}
[data-aaplus-card] .ap-foot{font-size:12px;line-height:16px;opacity:.6;margin-top:10px}
[data-aaplus-card] a{text-decoration:underline;text-underline-offset:2px}
[data-aaplus-note]{font-family:suisseIntl,ui-sans-serif,system-ui,sans-serif;font-size:11px;line-height:1;font-weight:500;letter-spacing:0;opacity:.6;margin-left:8px;white-space:nowrap;vertical-align:middle}`;

  /** Where the added chart goes: under the row of headline cards, or under the page's own cost-per-task section. */
  function anchor() {
    const heads = [...document.querySelectorAll("h2, h3")].filter((h) => !h.closest("[data-aaplus-card]"));
    const top = heads.find((h) => h.textContent.trim().replace(/Subscription pricing.*$/, "").trim() === "Cost per Task")?.closest(".rounded-lg");
    if (top?.parentElement) return top.parentElement;
    return heads.find((h) => /^Cost per Intelligence Index Task|^Cost to Run/.test(h.textContent.trim()))?.closest('[class*="scroll-mt"]') ?? null;
  }

  function place() {
    if (!document.body) return;
    if (!document.getElementById("aaplus-style")) { const s = document.createElement("style"); s.id = "aaplus-style"; s.textContent = STYLE; document.head.append(s); }
    // Labels: every AA chart whose costs the hook repriced says so beside its title.
    const repriced = page?.pricing === "plan" && page.applied > 0;
    for (const h of document.querySelectorAll("h2, h3")) {
      if (h.closest("[data-aaplus-card]")) continue;
      const mine = h.querySelector("[data-aaplus-note]"), text = h.textContent.replace(mine?.textContent ?? "", "").trim();
      const wants = repriced && /\bCost\b/.test(text) && !/Image|Video|Speech|Music|Audio/.test(text);
      if (wants && !mine) { const s = document.createElement("span"); s.dataset.aaplusNote = ""; s.textContent = "Subscription pricing · AA Plus"; s.title = "Costs here are repriced by the AA Plus extension at each model's plan share of API price (data: Priors). Models with no plan stay at API price."; h.append(s); }
      if (!wants && mine) mine.remove();
    }
    // The added chart.
    const old = document.querySelector("[data-aaplus-card]"), where = state.settings.chart ? anchor() : null, { items, left } = where ? chartItems() : { items: [], left: 0 };
    if (!where || items.length < 3) { old?.remove(); return; }
    const card = old ?? document.createElement("div");
    if (!old) card.dataset.aaplusCard = "";
    if (card.previousElementSibling !== where) where.after(card);
    const width = Math.max(320, Math.floor(card.clientWidth - 34));
    const key = JSON.stringify([items, left, width, state.prices.date]);
    if (card.dataset.key === key) return;
    card.dataset.key = key;
    card.innerHTML = `<div class="ap-head"><div class="ap-sq"></div><h3>Plan Price vs. API Price</h3></div>
<div class="ap-sub">Share of the API price a subscriber pays for the same tokens (%) · Lower is better</div>
<div class="ap-plot">${AAPlusChart.bars(items, { width })}</div>
<div class="ap-foot">Added by AA Plus, not Artificial Analysis. Plan data from <a href="https://mypriors.com" target="_blank" rel="noreferrer">Priors</a>, ${esc(state.prices.date)}.${left ? ` ${left} charted model${left === 1 ? " has" : "s have"} no first-party plan and ${left === 1 ? "is" : "are"} left out.` : ""}</div>`;
  }

  /* ---------------- the panel ---------------- */

  let host, root;
  const PANEL_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.wrap{position:fixed;right:16px;bottom:16px;z-index:2147483000;font:13px/1.4 suisseIntl,ui-sans-serif,system-ui,sans-serif;color:var(--ink);--ink:#000;--bg:#fff;--soft:#f1f2f4;--line:#d9d9d9;--mute:#737373}
.wrap.dark{--ink:#fff;--bg:#0a0a0a;--soft:#262626;--line:#404040;--mute:#a3a3a3}
button,select{font:inherit;color:inherit}
.fab{display:flex;align-items:center;gap:6px;height:38px;padding:0 14px;border:0;border-radius:999px;background:var(--ink);color:var(--bg);font-family:victorSerifBasic,Georgia,serif;font-size:16px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18)}
.fab i{width:7px;height:7px;border-radius:50%;background:#22c55e}
.panel{width:310px;max-height:min(560px,calc(100vh - 32px));overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.16);padding:14px 16px 12px}
.head{display:flex;align-items:baseline;gap:8px;margin-bottom:12px}
.head h2{font:500 20px/1.2 victorSerifBasic,Georgia,serif;margin:0}
.head a{font-size:12px;color:var(--mute)}
.head button{margin-left:auto;border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:var(--mute);padding:2px 4px}
.label{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--mute);margin:14px 0 6px}
.label:first-of-type{margin-top:0}
.seg{display:flex;gap:4px;background:var(--soft);border-radius:4px;padding:2px}
.seg button{flex:1;height:28px;border:1px solid transparent;border-radius:4px;background:none;font-size:12px;font-weight:500;cursor:pointer}
.seg button[aria-pressed=true]{background:var(--bg);border-color:var(--line)}
.help{font-size:12px;color:var(--mute);margin:8px 0 0}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px;font-size:12.5px}
.row select{max-width:170px;height:28px;border:1px solid var(--line);border-radius:4px;background:var(--bg);padding:0 6px;font-size:12px}
.plans{margin-top:12px}
.plans summary{font-size:12.5px;cursor:pointer;color:var(--ink)}
.check{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer}
.foot{display:flex;justify-content:space-between;gap:8px;margin-top:14px;padding-top:10px;border-top:1px solid var(--line);font-size:11.5px;color:var(--mute)}
.foot button{border:0;background:none;padding:0;text-decoration:underline;cursor:pointer;color:var(--mute);font-size:11.5px}
.warn{font-size:12px;margin:10px 0 0;padding:8px 10px;border:1px solid var(--line);border-radius:4px}
.warn button{border:0;background:none;padding:0;text-decoration:underline;cursor:pointer;font-weight:500}`;

  function panel() {
    const s = state.settings, plan = s.pricing === "plan", prices = state.prices;
    const live = page?.pricing === s.pricing;
    const help = !prices ? "Loading plan data from Priors."
      : plan ? (page ? (live ? `${page.applied} of ${page.rows.length} models on this page are repriced at their plan's share of API price. Models with no plan stay at API price.` : "Reloading to reprice this page.") : "This page has no model costs to reprice.")
      : "Artificial Analysis's own costs, at API prices.";
    const labs = plan && prices ? prices.labs.filter((l) => l.plans.length > 1) : [];
    const picked = labs.filter((l) => s.plans[l.id]).length;
    return `<div class="panel" role="dialog" aria-label="AA Plus">
<div class="head"><h2>AA Plus</h2><a href="https://mypriors.com" target="_blank" rel="noreferrer">by Priors</a><button type="button" data-act="close" aria-label="Close">×</button></div>
<div class="label">Cost pricing</div>
<div class="seg" role="group" aria-label="Cost pricing"><button type="button" data-pricing="api" aria-pressed="${!plan}">API</button><button type="button" data-pricing="plan" aria-pressed="${plan}">Subscription</button></div>
<p class="help">${esc(help)}</p>
${labs.length ? `<details class="plans"${plansOpen ? " open" : ""}><summary>Plan per lab${picked ? ` · ${picked} picked` : ""}</summary>${labs.map((l) => `<div class="row"><span>${esc(l.name)}</span><select data-lab="${esc(l.id)}" aria-label="${esc(l.name)} plan"><option value="">Default</option>${l.plans.map((p) => `<option value="${esc(p.plan)}"${s.plans[l.id] === p.plan ? " selected" : ""}>${esc(p.plan)}${p.feeUsd ? ` · $${p.feeUsd}` : ""}</option>`).join("")}</select></div>`).join("")}</details>` : ""}
<div class="label">Added charts</div>
<label class="check"><input type="checkbox" data-act="chart"${s.chart ? " checked" : ""}> Plan price vs. API price</label>
${note ? `<p class="warn">${esc(note)} ${/Reload/.test(note) ? '<button type="button" data-act="reload">Reload</button>' : ""}</p>` : ""}
<div class="foot"><span>${prices ? `Plan data: Priors, ${esc(prices.date)}` : "No plan data yet"}</span><button type="button" data-act="refresh">Refresh</button></div>
</div>`;
  }

  function renderPanel() {
    if (!document.body) return;
    if (!host || !host.isConnected) {
      host = document.createElement("div"); host.id = "aaplus-root";
      root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      root.addEventListener("click", (e) => {
        const t = e.target.closest("[data-act], [data-pricing]");
        if (!t) return;
        if (t.dataset.pricing) { if (t.dataset.pricing === state.settings.pricing) return; state.settings.pricing = t.dataset.pricing; save(); renderPanel(); return reload(); }
        const act = t.dataset.act;
        if (act === "open") open = true; else if (act === "close") open = false;
        else if (act === "chart") { state.settings.chart = t.checked; save(); }
        else if (act === "reload") return reload();
        else if (act === "refresh") { note = ""; fetchPrices(true); }
        render();
      });
      root.addEventListener("toggle", (e) => { if (e.target.classList?.contains("plans")) plansOpen = e.target.open; }, true);
      root.addEventListener("change", (e) => {
        const lab = e.target.dataset?.lab;
        if (!lab) return;
        if (e.target.value) state.settings.plans[lab] = e.target.value; else delete state.settings.plans[lab];
        save(); reload();
      });
      document.body.append(host);
    }
    const dark = document.documentElement.classList.contains("dark");
    const on = state.settings.pricing === "plan";
    root.innerHTML = `<style>${PANEL_CSS}</style><div class="wrap${dark ? " dark" : ""}">${open ? panel() : `<button type="button" class="fab" data-act="open" aria-label="Open AA Plus" title="AA Plus: ${on ? "subscription pricing is on" : "API pricing"}">A+${on ? "<i></i>" : ""}</button>`}</div>`;
  }

  /* ---------------- keeping it on the page ---------------- */

  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; try { renderPanel(); place(); } catch (e) { console.warn("AA Plus:", e); } });
  }

  function start() {
    render();
    window.postMessage({ aaplus: "ask" }, location.origin);
    // AA is a single-page app: sections come and go as you move between pages, and it redraws its own headings.
    let timer;
    new MutationObserver((list) => {
      if (list.every((m) => (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.("[data-aaplus-card], #aaplus-root, [data-aaplus-note]"))) return;
      clearTimeout(timer); timer = setTimeout(render, 350);
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(render, 200); });
  }

  fetchPrices(false);
  // After the page has drawn itself, so nothing is added while React is still claiming its markup.
  if (document.readyState === "complete") start(); else window.addEventListener("load", () => setTimeout(start, 300));
})();
