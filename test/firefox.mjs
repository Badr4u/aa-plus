// Loads the Firefox build in a headless Firefox and checks it on the live Artificial Analysis site.
//   npx browsers install firefox@stable     (once; Puppeteer drives Firefox over WebDriver BiDi)
//   node test/firefox.mjs [--base http://localhost:48766] [--shots <dir>]
// test/run.mjs covers the behaviour in depth in Chromium. This checks what could differ in Firefox: both content
// scripts load (one in the page's world), they talk, the background event page fetches from Priors, AA's own charts
// are repriced, and the popup and page share settings. The add-on is installed as a temporary one into a throwaway profile.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { getInstalledBrowsers } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";
import { FIREFOX_ID, stage } from "../store/build.mjs";
import { cardBars, switchedCharts } from "./probes.mjs";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg("--base"), shots = arg("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const firefox = process.env.FIREFOX ?? (await getInstalledBrowsers({ cacheDir: path.join(homedir(), ".cache/puppeteer") })).filter((b) => b.browser === "firefox").sort((a, b) => b.buildId.localeCompare(a.buildId, undefined, { numeric: true }))[0]?.executablePath;
if (!firefox) { console.error("No Firefox found: npx browsers install firefox@stable (or set FIREFOX to its path)"); process.exit(1); }
const work = mkdtempSync(path.join(tmpdir(), "aaplus-firefox-")), ext = path.join(work, "ext");
stage("firefox", ext, { dev: true });
// A fixed internal id, so the test can open the popup's page at a known moz-extension:// address.
const uuid = "2f6d1c3a-8b4e-4f7a-9c21-5e0d7a3b6f18", popupUrl = `moz-extension://${uuid}/popup.html`;
const browser = await puppeteer.launch({
  browser: "firefox", executablePath: firefox, headless: true, defaultViewport: { width: 1440, height: 1000 },
  // Opening and scripting the extension's own pages needs this.
  env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
  extraPrefsFirefox: { "extensions.webextensions.uuids": JSON.stringify({ [FIREFOX_ID]: uuid }), "ui.systemUsesDarkTheme": 0 },
});
try {
  assert.equal(await browser.installExtension(ext), FIREFOX_ID);
  /** The extension's popup, opened as a tab. Firefox never reports that navigation as finished, so it is not awaited. */
  const popup = async () => {
    const pop = await browser.newPage();
    await pop.setViewport({ width: 340, height: 520 });
    await pop.goto(popupUrl, { timeout: 3000 }).catch(() => {});
    await pop.waitForSelector('button[data-pricing][aria-pressed="true"]', { timeout: 10000 });
    return pop;
  };
  if (base) { const pop = await popup(); await pop.evaluate((b) => chrome.storage.local.set({ base: b }), base); await pop.close(); }

  const page = await browser.newPage();
  const errors = [];
  let loads = 0;
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  page.on("console", (m) => { if (/AA Plus:/.test(m.text())) errors.push(m.text()); });
  page.on("load", () => loads++);
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `firefox-${name}.png`) }); };
  const HEAD = '[data-aaplus-bar][data-at="head"]', SCOPE = '[data-aaplus-bar][data-at="scope"]';
  const card = (title) => page.evaluate(cardBars, title);
  const dollars = (bars) => bars.map((b) => Number(b.value.replace(/[$,]/g, "")));
  const pressed = (bar) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} [aria-pressed="true"]`)].map((b) => b.innerText.trim()), bar);
  const click = async (selector) => { await page.locator(selector).click(); };
  const switched = async () => {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < Math.min(height, 20000); y += 700) { await page.evaluate((to) => window.scrollTo(0, to), y); await wait(250); }
    await wait(1200);
    const out = await page.evaluate(switchedCharts);
    await page.evaluate(() => window.scrollTo(0, 0));
    return out;
  };

  await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(HEAD, { timeout: 45000 });
  await wait(2500);

  let plan;
  await check("the controls sit inline where AA's effort switch was, and the cost card opens on subscription pricing", async () => {
    assert.equal(await page.evaluate(() => { const g = document.querySelector('[role="group"][aria-label="Effort level"]'); return !!g && g.checkVisibility(); }), false, "AA's own Max | API Default switch is replaced");
    const text = await page.$eval(HEAD, (el) => el.innerText.replace(/\s+/g, " "));
    for (const word of ["AA Plus", "Pricing", "API", "Subscription", "Effort", "Highest", "API default", "High", "Max", "Plans"]) assert.ok(text.includes(word), `the row has "${word}": ${text}`);
    assert.deepEqual(await pressed(HEAD), ["Subscription", "Highest"]);
    plan = await card("Cost per Task");
    assert.ok(plan.length >= 8, `the cost card is drawn (${plan.length} bars)`);
    assert.deepEqual(dollars(plan), [...dollars(plan)].sort((a, b) => a - b), "cheapest first");
    await shot("home-plan");
  });

  await check("switching to API updates the cards in place, with the bars moving through the values between", async () => {
    await click(`${HEAD} [data-aaplus-pricing="api"]`);
    await wait(200);
    const mid = await card("Cost per Task");
    await wait(900);
    const api = await card("Cost per Task");
    assert.ok(Math.max(...dollars(api)) > Math.max(...dollars(plan)) * 2, `API costs are well above plan costs (${Math.max(...dollars(api))} vs ${Math.max(...dollars(plan))})`);
    const top = Math.max(...dollars(mid));
    assert.ok(top > Math.max(...dollars(plan)) && top < Math.max(...dollars(api)), `a frame in between shows a value in between (${top})`);
    assert.equal(loads, 1, "the page was not reloaded");
  });

  await check("an effort pick changes which configuration each headline model shows", async () => {
    const before = await card("Intelligence");
    await click(`${HEAD} [data-aaplus-effort="high"]`);
    await wait(1100);
    const high = await card("Intelligence");
    assert.ok(high.length >= 5, `bars at high effort: ${high.map((b) => b.name).join(", ")}`);
    for (const b of high) assert.ok(!/\((max|xhigh|medium|low)\)/.test(b.name), `${b.name} is not another effort`);
    assert.deepEqual(await pressed(HEAD), ["API", "High"]);
    await click(`${HEAD} [data-aaplus-effort="highest"]`);
    await wait(1100);
    assert.deepEqual((await card("Intelligence")).map((b) => b.name), before.map((b) => b.name), "Highest restores AA's own set");
  });

  await check("AA's own cost charts are repriced in the page's world, without a reload", async () => {
    const apiCharts = await switched();
    assert.ok(Object.keys(apiCharts).length >= 2, `cost charts with a switch: ${Object.keys(apiCharts).join(" | ")}`);
    await click(`${SCOPE} [data-aaplus-pricing="plan"]`);
    await wait(2500);
    const planCharts = await switched();
    assert.deepEqual(Object.entries(planCharts).filter(([title, figures]) => !figures || figures === apiCharts[title]).map(([title]) => title), [], "charts carrying the switch whose figures did not change");
    assert.equal(loads, 1, "still the same page load");
    assert.deepEqual(await pressed(HEAD), ["Subscription", "Highest"], "every copy of the control agrees");
  });

  await check("the strengths radar sits in the Benchmarks section", async () => {
    await page.$eval("[data-aaplus-radar]", (el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 260));
    await wait(1200);
    const radar = await page.$eval("[data-aaplus-radar]", (el) => { const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "Benchmarks"); return { inside: !!h2?.closest("section")?.contains(el), shapes: el.querySelectorAll("svg > g:nth-of-type(2) > g").length, spokes: el.querySelectorAll('svg g[style*="help"]').length }; });
    assert.ok(radar.inside, "inside the Benchmarks section");
    assert.equal(radar.shapes, 4, "four models by default");
    assert.ok(radar.spokes >= 5, `one spoke per evaluation in the index (${radar.spokes})`);
    await shot("radar");
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  await check("dark mode inverts the page, and is on before the first paint next time", async () => {
    const theme = () => page.evaluate(() => document.documentElement.getAttribute("data-aaplus-theme"));
    assert.equal(await theme(), null, "light to begin with");
    await click(`${HEAD} [data-aaplus-theme]`);
    await wait(600);
    assert.equal(await theme(), "dark");
    assert.match(await page.evaluate(() => getComputedStyle(document.documentElement).filter), /invert/);
    // The page is marked dark with the same attribute the moon button carries; a click on the page must not be taken for the button's.
    assert.equal(await page.evaluate(() => { const e = new MouseEvent("click", { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; }), false, "a click on the page is left to the page");
    await shot("dark");
    await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.equal(await theme(), "dark", "set as soon as the next page starts");
    await page.waitForSelector(HEAD, { timeout: 45000 });
    await wait(2000);
    await click(`${HEAD} [data-aaplus-theme]`);
    await wait(400);
    assert.equal(await theme(), null, "and off again");
    loads = 1;
  });

  await check("the background page fetched plan prices and evaluation scores from Priors", async () => {
    const pop = await popup();
    const stored = await pop.evaluate(() => chrome.storage.local.get(["cache", "strengths"]).then((g) => ({ prices: g.cache?.data?.generatedAt, strengths: g.strengths?.data?.generatedAt })));
    await pop.close();
    const age = (iso) => (Date.now() - Date.parse(iso)) / 3600000;
    assert.ok(age(stored.prices) < 6, `plan prices come from a snapshot built ${age(stored.prices).toFixed(1)}h ago`);
    assert.ok(age(stored.strengths) < 6, "so do the evaluation scores");
  });

  await check("the popup edits the same settings, and the open page follows", async () => {
    const pop = await popup();
    assert.equal(await pop.$eval("#access", (el) => el.hidden), true, "no access notice while the add-on may run on the site");
    assert.deepEqual(await pop.$$eval('#pricing [aria-pressed="true"]', (bs) => bs.map((b) => b.innerText)), ["Subscription"]);
    if (shots) await pop.screenshot({ path: path.join(shots, "firefox-popup.png") });
    await pop.locator('button[data-pricing="api"]').click();
    await pop.locator('button[data-effort="high"]').click();
    await pop.close();
    await page.bringToFront();
    await wait(1500);
    assert.deepEqual(await pressed(HEAD), ["API", "High"]);
    assert.ok((await card("Intelligence")).some((b) => /\(high\)/.test(b.name)));
    assert.equal(loads, 1, "still no reload");
  });

  await check("the popup asks for access when it was taken away", async () => {
    const pop = await popup();
    await pop.evaluate(() => chrome.permissions.remove({ origins: ["https://artificialanalysis.ai/*"] }));
    await pop.goto(popupUrl, { timeout: 3000 }).catch(() => {});
    await pop.waitForSelector("#access:not([hidden])", { timeout: 10000 });
    if (shots) await pop.screenshot({ path: path.join(shots, "firefox-popup-access.png") });
    await pop.close();
  });

  await check("nothing threw", async () => {
    assert.deepEqual(errors.filter((e) => /aaplus|AA Plus|moz-extension/i.test(e)), []);
  });
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall checks passed");
