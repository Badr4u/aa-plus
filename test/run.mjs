// Loads the unpacked extension in a headless Chromium and checks it on the live Artificial Analysis site.
//   node test/run.mjs [--base http://localhost:48766] [--shots <dir>]
// No window opens. The profile is a throwaway directory, never a real Chrome profile.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? "/Users/adam/priors-arena/node_modules/playwright/index.mjs";
const { chromium } = await import(PLAYWRIGHT);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), base = arg("--base"), shots = arg("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message}`); } };

await check("the page-side copy of the shared code matches the original", async () => {
  // Chrome injects one file into one world only, so the page-side script loads a copy. `cp shared.js shared.page.js` after editing.
  assert.equal(readFileSync(path.join(ext, "shared.page.js"), "utf8"), readFileSync(path.join(ext, "shared.js"), "utf8"));
});

const profile = mkdtempSync(path.join(tmpdir(), "aaplus-test-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
try {
  const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).host;
  if (base) await worker.evaluate((b) => chrome.storage.local.set({ base: b }), base);
  const page = await ctx.newPage();
  const errors = [];
  let loads = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (/AA Plus:/.test(m.text())) errors.push(m.text()); });
  page.on("load", () => loads++);
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  const head = page.locator('[data-aaplus-bar][data-at="head"]'), scopeBar = page.locator('[data-aaplus-bar][data-at="scope"]');
  /** A headline card as AA Plus draws it: its bars left to right, each with the model's label and the value shown. */
  const card = (title) => page.evaluate((t) => {
    const c = [...document.querySelectorAll("h3")].find((h) => h.textContent.trim().startsWith(t) && !h.closest("[data-aaplus-scope]"))?.closest(".rounded-lg");
    return [...(c?.querySelectorAll("[data-aaplus-plot] svg > g:last-child > g") ?? [])].map((g) => ({ x: Number(/translate\(([\d.-]+)/.exec(g.getAttribute("transform"))[1]), value: g.querySelector('text[text-anchor="middle"]').textContent, name: [...g.querySelectorAll("tspan")].map((s) => s.textContent).join(" ") })).sort((a, b) => a.x - b.x);
  }, title);
  const dollars = (bars) => bars.map((b) => Number(b.value.replace(/[$,]/g, "")));
  /** Every AA chart under its model store whose title carries the pricing switch, with the dollar figures it draws. */
  const switched = async () => {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < Math.min(height, 20000); y += 700) { await page.evaluate((to) => window.scrollTo(0, to), y); await page.waitForTimeout(250); }
    await page.waitForTimeout(1200);
    const out = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-aaplus-scope] h3")].filter((h) => h.querySelector("[data-aaplus-note]")).map((h, i) => {
      let box = h.parentElement;
      while (box.parentElement && !box.querySelector(".recharts-surface")) box = box.parentElement;
      return [`${i} ${[...h.childNodes].filter((n) => n.nodeType === 3 || !n.hasAttribute?.("data-aaplus-ui")).map((n) => n.textContent).join("").trim()}`, [...box.querySelectorAll("svg text")].map((t) => t.textContent.trim()).filter((t) => /^\$[\d.,]+[kKmM]?$/.test(t)).join(" ")];
    })));
    await page.evaluate(() => window.scrollTo(0, 0));
    return out;
  };
  const models = async () => Number((await page.locator("text=/^\\d+ of \\d+ models$/").first().innerText()).split(" ")[0]);

  await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await head.waitFor({ timeout: 45000 });
  await page.waitForTimeout(2500);

  let plan;
  await check("the controls sit inline where AA's effort switch was, and the cost card opens on subscription pricing", async () => {
    assert.equal(await page.locator('[role="group"][aria-label="Effort level"]').isVisible(), false, "AA's own Max | API Default switch is replaced");
    const text = (await head.innerText()).replace(/\s+/g, " ");
    for (const word of ["AA Plus", "Pricing", "API", "Subscription", "Effort", "Highest", "API default", "High", "Max", "Plans"]) assert.ok(text.includes(word), `the row has "${word}": ${text}`);
    assert.deepEqual(await head.locator('[aria-pressed="true"]').allInnerTexts(), ["Subscription", "Highest"]);
    plan = await card("Cost per Task");
    assert.ok(plan.length >= 8, `the cost card is drawn (${plan.length} bars)`);
    assert.deepEqual(dollars(plan), [...dollars(plan)].sort((a, b) => a - b), "cheapest first");
    assert.equal(await page.locator("#aaplus-root").count(), 0, "no floating panel");
    await shot("home-plan");
  });

  await check("switching to API updates the cards in place, with the bars moving through the values between", async () => {
    await head.locator('[data-aaplus-pricing="api"]').click();
    await page.waitForTimeout(200);
    const mid = await card("Cost per Task");
    await page.waitForTimeout(900);
    const api = await card("Cost per Task");
    assert.ok(Math.max(...dollars(api)) > Math.max(...dollars(plan)) * 2, `API costs are well above plan costs (${Math.max(...dollars(api))} vs ${Math.max(...dollars(plan))})`);
    assert.deepEqual(dollars(api), [...dollars(api)].sort((a, b) => a - b), "still cheapest first");
    const top = Math.max(...dollars(mid));
    assert.ok(top > Math.max(...dollars(plan)) && top < Math.max(...dollars(api)), `a frame in between shows a value in between (${top})`);
    assert.equal(loads, 1, "the page was not reloaded");
    assert.deepEqual(await page.locator('h3:has-text("Cost per Task") [data-aaplus-note] [aria-pressed="true"]').first().allInnerTexts(), ["API"], "the switch on the card follows");
    await shot("home-api");
  });

  await check("an effort pick changes which configuration each headline model shows", async () => {
    const before = await card("Intelligence");
    await head.locator('[data-aaplus-effort="high"]').click();
    await page.waitForTimeout(1100);
    const high = await card("Intelligence");
    assert.ok(high.length >= 5, `bars at high effort: ${high.map((b) => b.name).join(", ")}`);
    for (const b of high) assert.ok(!/\((max|xhigh|medium|low)\)/.test(b.name), `${b.name} is not another effort`);
    assert.ok(high.some((b) => /\(high\)/.test(b.name)) && before.some((b) => /\(max\)/.test(b.name)), "labels name the effort shown");
    assert.deepEqual(await head.locator('[aria-pressed="true"]').allInnerTexts(), ["API", "High"]);
    await head.locator('[data-aaplus-effort="default"]').click();
    await page.waitForTimeout(1100);
    const marked = await card("Intelligence");
    assert.notDeepEqual(marked.map((b) => b.name), before.map((b) => b.name), "API default differs from highest");
    await head.locator('[data-aaplus-effort="highest"]').click();
    await page.waitForTimeout(1100);
    assert.deepEqual((await card("Intelligence")).map((b) => b.name), before.map((b) => b.name), "Highest restores AA's own set");
  });

  let apiCharts;
  await check("AA's own charts follow: the switch beside a cost chart's title reprices it without a reload", async () => {
    apiCharts = await switched();
    assert.ok(Object.keys(apiCharts).length >= 2, `cost charts with a switch: ${Object.keys(apiCharts).join(" | ")}`);
    const first = page.locator("[data-aaplus-scope] h3:has([data-aaplus-note])").first();
    await first.scrollIntoViewIfNeeded();
    await first.locator('[data-aaplus-pricing="plan"]').click();
    await page.waitForTimeout(2500);
    const planCharts = await switched();
    const same = Object.entries(planCharts).filter(([title, figures]) => !figures || figures === apiCharts[title]).map(([title]) => title);
    for (const [title, figures] of Object.entries(planCharts)) console.log(`     ${title}: plan [${figures.slice(0, 60)}] api [${(apiCharts[title] ?? "").slice(0, 60)}]`);
    assert.deepEqual(same, [], "charts carrying the switch whose figures did not change");
    assert.equal(loads, 1, "still the same page load");
    assert.deepEqual(await head.locator('[aria-pressed="true"]').allInnerTexts(), ["Subscription", "Highest"], "every copy of the control agrees");
  });

  await check("the row above AA's charts picks efforts for them, and Highest puts the selection back", async () => {
    await scopeBar.scrollIntoViewIfNeeded();
    const before = await models();
    await scopeBar.locator('[data-aaplus-effort="medium"]').click();
    await page.waitForTimeout(2500);
    const medium = await models();
    assert.notEqual(medium, before, `the selection changed (${before} -> ${medium})`);
    await scopeBar.locator('[data-aaplus-effort="max"]').click();
    await page.waitForTimeout(2500);
    assert.ok(await models() > medium, "a second effort adds configurations");
    assert.deepEqual(await scopeBar.locator('[aria-pressed="true"]').allInnerTexts(), ["Subscription", "Medium", "Max"]);
    await scopeBar.locator('[data-aaplus-effort="highest"]').click();
    await page.waitForTimeout(2500);
    assert.equal(await models(), before, "back to AA's own selection");
    await shot("scope-bar");
  });

  await check("a plan picked for a lab reprices its models, and the added chart moves with it", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await card("Cost per Task");
    const chart = page.locator("[data-aaplus-card]");
    assert.equal(await chart.locator("h3").innerText(), "Plan Price vs. API Price");
    const shares = () => chart.locator('svg text[text-anchor="middle"]').allTextContents();
    const sharesBefore = await shares();
    assert.ok(sharesBefore.length >= 4 && sharesBefore.every((t) => /^\d+(\.\d)?%$/.test(t)), `every bar carries its share: ${sharesBefore.join(" ")}`);
    await head.locator(".aap-plans summary").click();
    const select = head.locator('select[data-aaplus-lab="anthropic"]');
    assert.ok((await select.locator("option").count()) >= 3, "Anthropic's plans are listed");
    await select.selectOption({ index: 1 });
    await page.waitForTimeout(1200);
    assert.notDeepEqual(dollars(await card("Cost per Task")), dollars(before), "the cost card changed");
    assert.notDeepEqual(await shares(), sharesBefore, "the added chart changed");
    assert.ok(await select.isVisible(), "the plan list stays open while the page redraws");
    await select.selectOption({ index: 0 });
    await page.mouse.click(300, 300);
    assert.equal(await select.isVisible(), false, "a click elsewhere closes it");
    if (shots) { await chart.scrollIntoViewIfNeeded(); await chart.screenshot({ path: path.join(shots, "added-chart.png") }); }
  });

  await check("the toolbar popup edits the same settings, and the open page follows", async () => {
    const pop = await ctx.newPage();
    await pop.setViewportSize({ width: 340, height: 520 });
    await pop.goto(`chrome-extension://${id}/popup.html`);
    await pop.locator('button[data-pricing][aria-pressed="true"]').waitFor();
    assert.deepEqual(await pop.locator('#pricing [aria-pressed="true"]').allInnerTexts(), ["Subscription"]);
    if (shots) await pop.screenshot({ path: path.join(shots, "popup.png") });
    await pop.locator('button[data-pricing="api"]').click();
    await pop.locator('button[data-effort="high"]').click();
    await pop.close();
    await page.bringToFront();
    await page.waitForTimeout(1500);
    assert.deepEqual(await head.locator('[aria-pressed="true"]').allInnerTexts(), ["API", "High"]);
    assert.ok((await card("Intelligence")).some((b) => /\(high\)/.test(b.name)));
    assert.equal(loads, 1, "still no reload");
  });

  await check("the models page works the same way, and nothing threw", async () => {
    await page.goto("https://artificialanalysis.ai/models", { waitUntil: "domcontentloaded", timeout: 60000 });
    await head.waitFor({ timeout: 45000 });
    await page.waitForTimeout(3000);
    const high = await card("Intelligence");
    assert.ok(high.length >= 5 && high.some((b) => /\(high\)/.test(b.name)), `the settings carried over: ${high.map((b) => b.name).join(", ")}`);
    await head.locator('[data-aaplus-effort="highest"]').click();
    await head.locator('[data-aaplus-pricing="plan"]').click();
    await page.waitForTimeout(1500);
    assert.ok(Math.max(...dollars(await card("Cost per Task"))) < 10, "plan costs on the models page");
    const planCharts = await switched();
    await head.locator('[data-aaplus-pricing="api"]').click();
    await page.waitForTimeout(2500);
    const apiCharts = await switched();
    for (const [title, figures] of Object.entries(planCharts)) console.log(`     ${title}: plan [${figures.slice(0, 50)}] api [${(apiCharts[title] ?? "").slice(0, 50)}]`);
    assert.ok(Object.keys(planCharts).length >= 1, "cost charts on /models carry the switch");
    assert.deepEqual(Object.entries(planCharts).filter(([title, figures]) => !figures || figures === apiCharts[title]).map(([title]) => title), [], "charts on /models carrying the switch whose figures did not change");
    await head.locator('[data-aaplus-pricing="plan"]').click();
    await page.evaluate(() => window.scrollTo(0, 600));
    await shot("models-plan");
    assert.deepEqual(errors.filter((e) => /aaplus|AA Plus|chrome-extension/i.test(e)), []);
  });
  if (errors.length) console.log(`page errors seen (the site's own included): ${errors.slice(0, 5).join(" | ")}`);
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall checks passed");
