// The toolbar popup: the same settings as the controls on the page. It only writes chrome.storage;
// every open Artificial Analysis tab hears the change and updates in place.
/* global __aaPlusShared, chrome */
(() => {
  const S = __aaPlusShared, $ = (id) => document.getElementById(id);
  let settings = S.settingsOf(), prices = null;

  const save = (patch) => { settings = S.settingsOf({ ...settings, ...patch }); chrome.storage.local.set({ settings }); draw(); };
  const button = (attr, value, text, pressed) => { const b = document.createElement("button"); b.type = "button"; b.dataset[attr] = value; b.textContent = text; b.setAttribute("aria-pressed", String(pressed)); return b; };

  function draw() {
    const plan = settings.pricing === "plan", e = settings.efforts;
    for (const b of $("pricing").children) b.setAttribute("aria-pressed", String(b.dataset.pricing === settings.pricing));
    $("pricing-help").textContent = plan ? "Each model at its plan's share of API price. Models with no plan stay at API price." : "Artificial Analysis's own costs, at API prices.";
    for (const b of $("mode").children) b.setAttribute("aria-pressed", String(e.mode === b.dataset.effort));
    $("efforts").replaceChildren(...S.EFFORTS.filter((x) => x !== "minimal" || e.list.includes(x)).map((x) => button("effort", x, S.EFFORT_LABEL[x], e.mode === "pick" && e.list.includes(x))));
    $("effort-help").textContent = e.mode === "pick" ? "Charts show the models at the efforts picked. Models with one configuration always show." : e.mode === "default" ? "The effort Artificial Analysis marks as a model's API default, where it marks one." : "Each model at its highest effort.";
    $("chart").checked = !!settings.chart;
    $("radar").checked = !!settings.radar;
    for (const b of $("theme").children) b.setAttribute("aria-pressed", String(b.dataset.theme === settings.theme));
    const labs = plan && prices ? prices.labs.filter((l) => l.plans.length > 1) : [];
    $("plans").hidden = !labs.length;
    $("labs").replaceChildren(...labs.map((l) => {
      const row = document.createElement("label"), name = document.createElement("span"), select = document.createElement("select");
      row.className = "row"; name.textContent = l.name; select.dataset.lab = l.id;
      select.append(new Option("Default", ""), ...l.plans.map((p) => new Option(`${p.plan}${Number.isFinite(p.feeUsd) ? ` · $${p.feeUsd}` : ""}`, p.plan)));
      select.value = settings.plans[l.id] ?? "";
      row.append(name, select);
      return row;
    }));
    $("data").textContent = prices?.date ? `Data: Priors, ${prices.date}` : "Data loads from Priors on first use";
  }

  document.addEventListener("click", (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest("button[data-pricing], button[data-effort], button[data-theme]") : null;
    if (!t) return;
    if (t.dataset.pricing) save({ pricing: t.dataset.pricing }); else if (t.dataset.theme) save({ theme: t.dataset.theme }); else save({ efforts: S.toggleEffort(settings.efforts, t.dataset.effort) });
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "chart") return save({ chart: t.checked });
    if (t.id === "radar") return save({ radar: t.checked });
    if (t.dataset?.lab) { const plans = { ...settings.plans }; if (t.value) plans[t.dataset.lab] = t.value; else delete plans[t.dataset.lab]; save({ plans }); }
  });

  chrome.storage.local.get(["settings", "cache"], (got) => {
    settings = S.settingsOf(got?.settings);
    if (got?.cache?.data) prices = S.adoptPrices(got.cache.data, got.cache.at);
    draw();
    chrome.runtime.sendMessage({ type: "prices" }, (res) => { if (!chrome.runtime.lastError && res?.ok) { prices = S.adoptPrices(res.data, res.at); draw(); } });
  });
  // The page's own controls write the same settings; keep an open popup in step with them.
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.settings) { settings = S.settingsOf(changes.settings.newValue); draw(); } });
  draw();
})();
