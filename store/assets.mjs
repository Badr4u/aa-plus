// Makes the Chrome Web Store listing images from the real extension on the live site, in a headless Chromium:
// store/assets/screenshot-1..5.png (1280x800) and promo-small.png (440x280).
//   node store/assets.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), out = path.join(root, "store/assets");
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), "aaplus-assets-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
const set = (worker, patch) => worker.evaluate((p) => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, ...p } })), patch);
try {
  const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ settings: { pricing: "plan", plans: {}, efforts: { mode: "highest", list: [] }, chart: true, radar: true, radarTop: 4, theme: "light" } }));
  const page = await ctx.newPage();
  const wait = (ms) => page.waitForTimeout(ms);
  const head = '[data-aaplus-bar][data-at="head"]';
  const scrollTo = async (selector, text, offset) => { await page.evaluate(([sel, txt, off]) => { const el = [...document.querySelectorAll(sel)].find((e) => !txt || e.textContent.trim().startsWith(txt)); window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + scrollY - off)); }, [selector, text, offset]); await wait(1800); };
  await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator(head).waitFor({ timeout: 90000 });
  await wait(4000);
  await page.mouse.move(1270, 790);

  // 1. The headline cards at subscription prices, controls inline.
  await scrollTo(head, "", 130);
  await page.screenshot({ path: path.join(out, "screenshot-1.png") });
  // 2. The intelligence vs. cost scatter, Pareto line through the repriced points.
  await scrollTo("[data-aaplus-scope] h3", "Intelligence Index vs. Cost per Task", 190);
  await page.screenshot({ path: path.join(out, "screenshot-2.png") });
  // 3. Effort picks: the same chart at medium effort.
  await page.locator('[data-aaplus-bar][data-at="scope"] [data-aaplus-effort="medium"]').click();
  await wait(2500); await page.mouse.move(1270, 790); await wait(400);
  await page.screenshot({ path: path.join(out, "screenshot-3.png") });
  await page.locator('[data-aaplus-bar][data-at="scope"] [data-aaplus-effort="highest"]').click();
  await wait(2000);
  // 4. The strengths radar, one evaluation hovered.
  await scrollTo("[data-aaplus-radar]", "", 150);
  const spoke = await page.locator('[data-aaplus-radar] svg g[style*="help"]').nth(2).boundingBox();
  await page.mouse.move(spoke.x + spoke.width / 2, spoke.y + spoke.height / 2); await wait(800);
  await page.screenshot({ path: path.join(out, "screenshot-4.png") });
  // 5. Dark mode, with the toolbar popup.
  await page.mouse.move(1270, 790);
  await set(worker, { theme: "dark" });
  await scrollTo(head, "", 130);
  await wait(800);
  const back = await page.screenshot({ type: "png" });
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 340, height: 560 });
  await pop.emulateMedia({ colorScheme: "dark" });
  await pop.goto(`chrome-extension://${id}/popup.html`);
  await pop.waitForTimeout(1200);
  const h = await pop.evaluate(() => document.documentElement.scrollHeight);
  const popup = await pop.screenshot({ clip: { x: 0, y: 0, width: 340, height: Math.min(h, 700) } });
  await pop.close();
  const comp = await ctx.newPage();
  await comp.setViewportSize({ width: 1280, height: 800 });
  await comp.setContent(`<style>html,body{margin:0;background:#111}img{display:block}#p{position:absolute;right:24px;top:16px;border-radius:10px;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 18px 50px rgba(0,0,0,.55);max-height:768px}</style><img src="data:image/png;base64,${back.toString("base64")}"><img id="p" src="data:image/png;base64,${popup.toString("base64")}">`);
  await comp.waitForTimeout(300);
  await comp.screenshot({ path: path.join(out, "screenshot-5.png") });

  // Small promo tile.
  const logo = readFileSync(path.join(root, "icons/logo.svg"), "utf8");
  await comp.setViewportSize({ width: 440, height: 280 });
  await comp.setContent(`<style>html,body{margin:0}#t{width:440px;height:280px;background:#0b0b0b;color:#fff;display:flex;align-items:center;gap:22px;padding:0 34px;box-sizing:border-box;font-family:Inter,"SF Pro Display",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif}#t svg{width:104px;height:104px;flex:none}h1{margin:0;font-size:46px;font-weight:650;letter-spacing:-.03em;line-height:1}p{margin:10px 0 0;font-size:16px;line-height:1.35;opacity:.72}</style><div id="t">${logo}<div><h1>AA Plus</h1><p>Subscription pricing, effort picks and more on Artificial Analysis</p></div></div>`);
  await comp.waitForTimeout(300);
  await comp.locator("#t").screenshot({ path: path.join(out, "promo-small.png") });
  console.log("wrote", out);
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
