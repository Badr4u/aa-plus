// Functions run inside the page by both tests (Playwright for Chromium, Puppeteer for Firefox): each is sent as
// source with `page.evaluate`, so it uses nothing from this module's scope.

/** A headline card as AA Plus draws it: its bars left to right, each with the model's label and the value shown. */
export function cardBars(title) {
  const c = [...document.querySelectorAll("h3")].find((h) => h.textContent.trim().startsWith(title) && !h.closest("[data-aaplus-scope]"))?.closest(".rounded-lg");
  return [...(c?.querySelectorAll("[data-aaplus-plot] svg > g:last-child > g") ?? [])].map((g) => ({ x: Number(/translate\(([\d.-]+)/.exec(g.getAttribute("transform"))[1]), value: g.querySelector('text[text-anchor="middle"]').textContent, name: [...g.querySelectorAll("tspan")].map((s) => s.textContent).join(" ") })).sort((a, b) => a.x - b.x);
}

/** Every AA chart under its model store whose title carries the pricing switch, with the dollar figures it draws. */
export function switchedCharts() {
  return Object.fromEntries([...document.querySelectorAll("[data-aaplus-scope] h3")].filter((h) => h.querySelector("[data-aaplus-note]")).map((h, i) => {
    let box = h.parentElement;
    while (box.parentElement && !box.querySelector(".recharts-surface")) box = box.parentElement;
    return [`${i} ${[...h.childNodes].filter((n) => n.nodeType === 3 || !n.hasAttribute?.("data-aaplus-ui")).map((n) => n.textContent).join("").trim()}`, [...box.querySelectorAll("svg text")].map((t) => t.textContent.trim()).filter((t) => /^\$[\d.,]+[kKmM]?$/.test(t)).join(" ")];
  }));
}
