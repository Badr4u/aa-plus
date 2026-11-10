// Loads the unpacked extension in a headless Chromium and checks it on the live Artificial Analysis site.
//   node test/run.mjs [--base http://localhost:48766] [--shots <dir>]
// No window opens. The profile is a throwaway directory, never a real Chrome profile.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? "/Users/adam/priors-arena/node_modules/playwright/index.mjs";
const { chromium } = await import(PLAYWRIGHT);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), base = arg("--base"), shots = arg("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), "aaplus-test-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const failures = [];
const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message}`); } };
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };

try {
  const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  if (base) await worker.evaluate((b) => chrome.storage.local.set({ base: b }), base);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const settle = async () => { await page.locator(".recharts-surface").first().waitFor({ timeout: 60000 }); await page.waitForTimeout(3500); };
  /** The dollar labels AA draws on its headline "Cost per Task" card, by model, as the page shows them. */
  const costCard = () => page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((e) => e.textContent.trim().startsWith("Cost per Task"));
    const card = h?.closest(".rounded-lg");
    return { note: h?.querySelector("[data-aaplus-note]")?.textContent ?? null, values: [...(card?.querySelectorAll("svg text") ?? [])].map((t) => t.textContent.trim()).filter((t) => /^\$[\d.,]+$/.test(t)).map((t) => Number(t.slice(1).replace(/,/g, ""))) };
  });
  /** Every AA chart on the page whose title says cost, with the dollar figures it draws. Scrolls the page through first: AA draws charts as they come into view. */
  const costCharts = async () => {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < Math.min(height, 14000); y += 700) { await page.evaluate((to) => window.scrollTo(0, to), y); await page.waitForTimeout(220); }
    const out = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("h2, h3")].filter((h) => !h.closest("[data-aaplus-card]") && /\bCost\b/.test(h.textContent) && !/Image|Video|Speech|Music|Audio/.test(h.textContent)).map((h, i) => {
      // The smallest box around the title that holds a chart: that chart is the title's own.
      let box = h.parentElement;
      while (box.parentElement && !box.querySelector(".recharts-surface")) box = box.parentElement;
      const title = h.textContent.replace(h.querySelector("[data-aaplus-note]")?.textContent ?? "", "").trim();
      return [`${i} ${title}`, { labelled: !!h.querySelector("[data-aaplus-note]"), dollars: [...box.querySelectorAll("svg text")].map((t) => t.textContent.trim()).filter((t) => /^\$[\d.,]+[kKmM]?$/.test(t)).join(" ") }];
    })));
    await page.evaluate(() => window.scrollTo(0, 0));
    return out;
  };
  const setPricing = async (to) => {
    await page.locator("#aaplus-root").locator("[data-act=open]").click();
    await Promise.all([page.waitForEvent("load", { timeout: 60000 }), page.locator("#aaplus-root").locator(`[data-pricing=${to}]`).click()]);
    await settle();
  };

  await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle();
  // The first visit has no plan data yet, so the extension reloads the page once after fetching it.
  await page.locator("#aaplus-root").waitFor({ state: "attached", timeout: 30000 });
  await page.waitForTimeout(2500);
  await settle();

  let plan;
  await check("subscription pricing is on by default and AA's own cost card shows plan costs, labelled", async () => {
    plan = await costCard();
    assert.ok(plan.values.length >= 5, `the cost card draws its dollar labels (saw ${plan.values.length})`);
    assert.equal(plan.note, "Subscription pricing · AA Plus");
    assert.deepEqual(plan.values, [...plan.values].sort((a, b) => a - b), "still sorted cheapest first after repricing");
    await shot(page, "home-plan");
  });
  const planCharts = await costCharts();

  await check("the added chart sits under the headline cards, in the page's own look", async () => {
    const card = page.locator("[data-aaplus-card]");
    await card.waitFor({ timeout: 10000 });
    const info = await card.evaluate((el) => ({ title: el.querySelector("h3").textContent, font: getComputedStyle(el.querySelector("h3")).fontFamily, bars: el.querySelectorAll("svg path").length, labels: [...el.querySelectorAll("svg g > text:first-of-type")].map((t) => t.textContent), prev: !!el.previousElementSibling?.querySelector("h3"), w: el.getBoundingClientRect().width, sw: el.querySelector("svg").getBoundingClientRect().width }));
    assert.equal(info.title, "Plan Price vs. API Price");
    assert.match(info.font, /victorSerifBasic/);
    assert.ok(info.bars >= 4, `bars drawn: ${info.bars}`);
    assert.ok(info.labels.every((t) => /^\d+(\.\d)?%$/.test(t)), `every bar carries its share: ${info.labels.join(" ")}`);
    const shares = info.labels.map((t) => parseFloat(t));
    assert.deepEqual(shares, [...shares].sort((a, b) => a - b), "cheapest share first");
    assert.ok(info.prev, "placed after the headline cards");
    await card.scrollIntoViewIfNeeded();
    if (shots) await card.screenshot({ path: path.join(shots, "added-chart.png") });
  });

  await check("the panel opens, lists plans per lab, and switching to API restores AA's own costs", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#aaplus-root").locator("[data-act=open]").click();
    const panel = page.locator("#aaplus-root").locator(".panel");
    await panel.waitFor();
    assert.match(await panel.innerText(), /models on this page are repriced/);
    await panel.locator("details.plans summary").click();
    assert.ok(await panel.locator("select[data-lab]").count() >= 2, "a plan picker per lab");
    await page.waitForTimeout(600);
    assert.ok(await panel.locator("select[data-lab]").first().isVisible(), "the plan list stays open while the page redraws");
    await shot(page, "panel");
    await panel.locator("[data-act=close]").click();
    await setPricing("api");
    const api = await costCard();
    assert.equal(api.note, null, "no label on AA's own numbers");
    assert.ok(api.values.length >= 5);
    assert.ok(Math.max(...api.values) > Math.max(...plan.values) * 2, `API costs are well above plan costs (${Math.max(...api.values)} vs ${Math.max(...plan.values)})`);
    await shot(page, "home-api");
    assert.equal(await page.locator("[data-aaplus-card]").count(), 1, "the added chart stays: it does not depend on the pricing");
  });

  await check("every chart labelled as repriced really shows different figures than at API price", async () => {
    const apiCharts = await costCharts();
    const same = [];
    for (const [title, p] of Object.entries(planCharts)) {
      const a = apiCharts[title];
      console.log(`     ${title}: ${p.labelled ? "labelled" : "not labelled"}, plan [${p.dollars.slice(0, 70)}] api [${(a?.dollars ?? "").slice(0, 70)}]`);
      if (p.labelled && (!p.dollars || !a || p.dollars === a.dollars)) same.push(title);
    }
    assert.deepEqual(same, [], "labelled charts whose figures did not change");
  });

  await check("a plan picked for a lab changes that lab's costs", async () => {
    await setPricing("plan");
    const before = await costCard();
    await page.locator("#aaplus-root").locator("[data-act=open]").click();
    await page.locator("#aaplus-root").locator("details.plans summary").click();
    const select = page.locator("#aaplus-root").locator("select[data-lab=anthropic]");
    const options = await select.locator("option").allTextContents();
    assert.ok(options.length >= 3, `Anthropic plans: ${options.join(", ")}`);
    await Promise.all([page.waitForEvent("load", { timeout: 60000 }), select.selectOption({ index: 1 })]);
    await settle();
    const after = await costCard();
    assert.notDeepEqual(after.values, before.values, "the cost card changed");
    assert.equal(after.note, "Subscription pricing · AA Plus");
    if (shots) for (const [i, title] of ["Cost per Intelligence Index Task", "Intelligence Index vs. Cost per Task"].entries()) {
      const h = page.locator("h3", { hasText: title }).first();
      await h.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -90));
      await page.waitForTimeout(1500);
      await shot(page, `section-${i}`);
    }
  });

  await check("the models page is repriced too, and nothing threw", async () => {
    await page.goto("https://artificialanalysis.ai/models", { waitUntil: "domcontentloaded", timeout: 60000 });
    await settle();
    await page.locator("#aaplus-root").waitFor({ state: "attached", timeout: 30000 });
    const notes = await page.locator("[data-aaplus-note]").count();
    assert.ok(notes >= 1, "cost charts on /models are labelled");
    await shot(page, "models-plan");
    assert.deepEqual(errors.filter((e) => /aaplus|AA Plus/i.test(e)), []);
  });
  if (errors.length) console.log(`page errors seen (the site's own included): ${errors.slice(0, 5).join(" | ")}`);
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall checks passed");
