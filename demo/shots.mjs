// Records the footage for the cut film: the real extension on the live Artificial Analysis site, in a
// headless Chromium, one shot per subject. Each shot is a folder of the page's own frames (2x) with the
// moment of every click and the on-screen boxes of what matters, so the edit can put a click on a beat and
// push in on the right thing.
//   node demo/shots.mjs <work dir>
// No window opens.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "/Users/adam/priors-arena/node_modules/playwright/index.mjs");
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.resolve(process.argv[2] ?? "demo-work"), dir = path.join(work, "shots");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const W = 1440, H = 810;
const profile = mkdtempSync(path.join(tmpdir(), "aaplus-shots-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: W, height: H }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });

// A pointer drawn in the page: a headless browser has none. It follows the real mouse events.
await ctx.addInitScript(() => {
  if (window.top !== window) return;
  let pos = { x: 760, y: 330 };
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:22px;height:22px;will-change:transform";
  el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5v16.2l4.4-3.9 2.8 6.6 2.7-1.2-2.8-6.5h5.9z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const place = () => { el.style.transform = `translate(${pos.x - 3}px,${pos.y - 1.5}px)`; };
  place();
  addEventListener("mousemove", (e) => { pos = { x: e.clientX, y: e.clientY }; place(); }, true);
  addEventListener("mousedown", () => {
    const ring = document.createElement("div");
    ring.style.cssText = `position:fixed;left:${pos.x - 14}px;top:${pos.y - 14}px;width:28px;height:28px;border-radius:50%;border:2px solid rgba(17,17,17,.55);z-index:2147483646;pointer-events:none;transition:transform .3s ease-out,opacity .3s ease-out`;
    document.documentElement.append(ring);
    requestAnimationFrame(() => { ring.style.transform = "scale(1.7)"; ring.style.opacity = "0"; });
    setTimeout(() => ring.remove(), 380);
  }, true);
  setInterval(() => { if (!el.isConnected && document.documentElement) document.documentElement.append(el); }, 100);
});

const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker", { timeout: 15000 });
await worker.evaluate(() => chrome.storage.local.set({ settings: { pricing: "api", plans: {}, efforts: { mode: "highest", list: [] }, chart: true, radar: true, radarTop: 4, theme: "light" } }));
const page = await ctx.newPage();
const sleep = (ms) => page.waitForTimeout(ms);
const now = () => Date.now() / 1000;
let mouse = { x: 760, y: 330 };
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
async function moveTo(x, y, ms = 450) {
  const from = { ...mouse }, steps = Math.max(6, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) { const k = ease(i / steps); await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k); await sleep(ms / steps * 0.55); }
  mouse = { x, y };
}
const boxOf = async (target) => typeof target === "string" ? page.locator(target).first().boundingBox() : target.boundingBox();
const topOf = (selector, text, offset) => page.evaluate(([sel, txt, off]) => { const el = [...document.querySelectorAll(sel)].find((e) => !txt || e.textContent.trim().startsWith(txt)); return el ? Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - off)) : null; }, [selector, text, offset]);
const jump = async (y) => { await page.evaluate((to) => window.scrollTo(0, to), y); await sleep(1600); };

const cdp = await ctx.newCDPSession(page);
let shot = null;
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  if (shot) { const file = `${String(shot.frames.length).padStart(5, "0")}.jpg`; writeFileSync(path.join(shot.dir, file), Buffer.from(data, "base64")); shot.frames.push({ t: +(metadata.timestamp - shot.t0).toFixed(4), file }); }
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
const shots = {};
async function record(name, boxes, run) {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  const rects = {};
  for (const [key, target] of Object.entries(boxes)) rects[key] = await boxOf(target);
  shot = { dir: folder, frames: [], t0: now(), marks: {}, rects };
  const current = shot;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  /** Click something and note when: the edit puts that moment on a beat. */
  const press = async (label, target, ms = 420) => {
    const box = await boxOf(target);
    await moveTo(box.x + box.width / 2, box.y + box.height / 2, ms);
    await sleep(110);
    current.marks[label] = +(now() - current.t0).toFixed(3);
    await page.mouse.down(); await sleep(60); await page.mouse.up();
  };
  const mark = (label) => { current.marks[label] = +(now() - current.t0).toFixed(3); };
  await sleep(700);
  await run({ press, mark });
  await sleep(500);
  await cdp.send("Page.stopScreencast");
  await sleep(250);
  shot = null;
  current.length = +(now() - current.t0).toFixed(3);
  shots[name] = { frames: current.frames, marks: current.marks, rects: current.rects, length: current.length };
  console.log(`${name}: ${current.frames.length} frames, ${current.length}s, marks ${Object.keys(current.marks).join(" ")}`);
}

try {
  const head = '[data-aaplus-bar][data-at="head"]', scope = '[data-aaplus-bar][data-at="scope"]';
  await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator(head).waitFor({ timeout: 60000 });
  await sleep(3500);
  await page.mouse.move(mouse.x, mouse.y);
  const cardsY = await topOf(head, "", 150);
  const costCard = page.locator("h3", { hasText: "Cost per Task" }).first().locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  const scatterTitle = page.locator("[data-aaplus-scope] h3", { hasText: "Intelligence Index vs. Cost per Task" }).first();
  const scatterBox = scatterTitle.locator("xpath=ancestor::div[.//*[contains(@class,'recharts-surface')]][1]");

  /* 1. The headline cards: pricing, then efforts. */
  await jump(cardsY);
  await record("cards", { bar: head, brand: `${head} .aap-brand svg`, cost: costCard, row: costCard.locator("xpath=..") }, async ({ press }) => {
    await press("plan", `${head} [data-aaplus-pricing="plan"]`, 600); await sleep(1700);
    await press("high", `${head} [data-aaplus-effort="high"]`); await sleep(1400);
    await press("medium", `${head} [data-aaplus-effort="medium"]`); await sleep(1400);
    await press("low", `${head} [data-aaplus-effort="low"]`); await sleep(1400);
    await press("highest", `${head} [data-aaplus-effort="highest"]`); await sleep(1500);
  });

  /* 2. The scatter: intelligence against cost per task, with its Pareto line. */
  await jump(await topOf("[data-aaplus-scope] h3", "Intelligence Index vs. Cost per Task", 190));
  await sleep(1500);
  await record("scatter", { bar: scope, title: scatterTitle, chart: scatterBox.locator(".recharts-wrapper").first(), box: scatterBox }, async ({ press, mark }) => {
    await press("api", scatterTitle.locator('[data-aaplus-pricing="api"]'), 600); await sleep(2300);
    await press("plan", scatterTitle.locator('[data-aaplus-pricing="plan"]')); await sleep(2500);
    const label = page.locator("[data-aaplus-scope] svg text", { hasText: /^Claude Opus 5\.5/ }).first();
    if (await label.count()) { const lb = await label.boundingBox(); await moveTo(lb.x - 8, lb.y + lb.height / 2, 600); mark("hover"); await sleep(1700); }
    await press("medium", `${scope} [data-aaplus-effort="medium"]`, 600); await sleep(2600);
    await press("high", `${scope} [data-aaplus-effort="high"]`); await sleep(2400);
    await press("highest", `${scope} [data-aaplus-effort="highest"]`); await sleep(2300);
  });

  /* 3. The radar in the Benchmarks section. */
  await moveTo(700, 480, 300);
  await jump(await topOf("[data-aaplus-radar]", "", 185));
  await record("radar", { bar: scope, card: "[data-aaplus-radar]", plot: "[data-aaplus-radar] [data-aaplus-plot] svg" }, async ({ press, mark }) => {
    const spoke = await boxOf(page.locator('[data-aaplus-radar] svg g[style*="help"]').nth(2));
    await moveTo(spoke.x + spoke.width / 2, spoke.y + spoke.height / 2, 600); mark("tip"); await sleep(1900);
    await press("six", '[data-aaplus-radar-top="6"]', 600); await sleep(1700);
    await press("three", '[data-aaplus-radar-top="3"]', 300); await sleep(1500);
    await press("four", '[data-aaplus-radar-top="4"]', 300); await sleep(1400);
  });

  /* 4. Dark mode, switched on over the scatter, then seen on the radar and the cards. */
  await moveTo(700, 480, 300);
  await jump(await topOf("[data-aaplus-scope] h3", "Intelligence Index vs. Cost per Task", 190));
  await sleep(1200);
  await record("dark", { bar: scope, chart: scatterBox.locator(".recharts-wrapper").first(), box: scatterBox }, async ({ press }) => {
    await press("dark", `${scope} [data-aaplus-theme]`, 600); await sleep(1900);
    await press("api", scatterTitle.locator('[data-aaplus-pricing="api"]'), 500); await sleep(2100);
    await press("plan", scatterTitle.locator('[data-aaplus-pricing="plan"]')); await sleep(2200);
  });
  await moveTo(700, 480, 300);
  await jump(await topOf("[data-aaplus-radar]", "", 185));
  await record("darkradar", { card: "[data-aaplus-radar]" }, async ({ press }) => { await press("six", '[data-aaplus-radar-top="6"]', 500); await sleep(1700); await press("four", '[data-aaplus-radar-top="4"]', 300); await sleep(1400); });
  await moveTo(700, 430, 300);
  await jump(cardsY);
  await record("darkcards", { bar: head, brand: `${head} .aap-brand svg`, cost: costCard, row: costCard.locator("xpath=..") }, async ({ press }) => {
    await press("high", `${head} [data-aaplus-effort="high"]`, 600); await sleep(1500);
    await press("highest", `${head} [data-aaplus-effort="highest"]`); await sleep(1700);
  });

  writeFileSync(path.join(dir, "shots.json"), JSON.stringify({ width: W, height: H, scale: 2, shots }, null, 1));
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
