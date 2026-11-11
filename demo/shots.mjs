// Records the footage for the cut film: the real extension on the live Artificial Analysis site, in a
// headless Chromium, one shot per subject. Each shot is a folder of pictures, each with its time, plus the
// moment of every click and the on-screen boxes of what matters, so the edit can put a click on a beat and
// push in on the right thing.
//   node demo/shots.mjs <work dir>
// Two things keep the footage sharp and smooth:
//  - The browser really runs at three device pixels per page pixel, and every picture is lossless. (A screen
//    recording of a headless page comes out at one pixel per page pixel whatever scale it is asked for: the
//    first cut of this film was soft for that reason.)
//  - The page runs in slow motion while it is filmed (its clocks, timers and animations all SLOW times
//    slower), so a browser that can take about fifteen such pictures a second still gets sixty for every
//    second of the film. Times in shots.json are in film seconds.
// No window opens.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "/Users/adam/priors-arena/node_modules/playwright/index.mjs");
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.resolve(process.argv[2] ?? "demo-work"), dir = path.join(work, "shots");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const W = 1440, H = 810, SCALE = 3, SLOW = Number(process.env.SLOW ?? 4), RATE = 60;

/** Slow motion for one JavaScript world: its clocks run SLOW times slower and its timers wait SLOW times longer. */
const slowMotion = `(() => {
  if (globalThis.__slowMotion) return; globalThis.__slowMotion = true;
  // Date is left alone: animations here time themselves by performance.now and frame times, and the site checks dates.
  const K = ${SLOW}, realNow = performance.now.bind(performance), p0 = realNow();
  performance.now = () => p0 + (realNow() - p0) / K;
  const timeout = globalThis.setTimeout, interval = globalThis.setInterval, frame = globalThis.requestAnimationFrame;
  globalThis.setTimeout = (fn, ms, ...rest) => timeout(fn, (Number(ms) || 0) * K, ...rest);
  globalThis.setInterval = (fn, ms, ...rest) => interval(fn, (Number(ms) || 0) * K, ...rest);
  // A frame callback is handed the slowed clock, not the browser's frame time: once CSS animations are slowed (below),
  // Chrome slows frame times too, from that moment on, and the two would no longer agree.
  if (frame) globalThis.requestAnimationFrame = (fn) => frame(() => fn(performance.now()));
})();`;

// The extension as filmed is a copy whose own scripts run in the same slow motion (they live in a world of their own,
// which a script added to the page cannot reach). Nothing else about it differs.
const ext = mkdtempSync(path.join(tmpdir(), "aaplus-film-ext-"));
cpSync(source, ext, { recursive: true, filter: (from) => !/\/(\.git|demo|test|node_modules)(\/|$)/.test(from.slice(source.length)) });
writeFileSync(path.join(ext, "shared.js"), `${slowMotion}\n${readFileSync(path.join(source, "shared.js"), "utf8")}`);

const profile = mkdtempSync(path.join(tmpdir(), "aaplus-shots-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--force-device-scale-factor=${SCALE}`, `--window-size=${W},${H + 87}`, "--hide-scrollbars"] });
await ctx.addInitScript(slowMotion);

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
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => { if (m.type() === "error" || /AA Plus/.test(m.text())) console.error("console:", m.text().slice(0, 300)); });
const real = (ms) => new Promise((done) => setTimeout(done, ms));
/** A wait in film time. */
const sleep = (ms) => real(ms * SLOW);
const cdp = await ctx.newCDPSession(page);
// The window is sized so the page itself is W x H: the browser's own frame takes some of the height.
{
  const { windowId, bounds } = await cdp.send("Browser.getWindowForTarget");
  const inner = await page.evaluate(() => [innerWidth, innerHeight]);
  if (inner[0] !== W || inner[1] !== H) await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: bounds.width + W - inner[0], height: bounds.height + H - inner[1] } });
  await real(300);
  const now = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
  if (now[0] !== W || now[1] !== H || now[2] !== SCALE) throw new Error(`the page is ${now[0]}x${now[1]} at ${now[2]}x, not ${W}x${H} at ${SCALE}x`);
}

let mouse = { x: 760, y: 330 };
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
async function moveTo(x, y, ms = 450) {
  const from = { ...mouse }, start = Date.now(), length = ms * SLOW;
  for (;;) {
    const k = Math.min(1, (Date.now() - start) / length);
    await page.mouse.move(from.x + (x - from.x) * ease(k), from.y + (y - from.y) * ease(k));
    if (k >= 1) break;
    await real(12);
  }
  mouse = { x, y };
}
const boxOf = async (target) => { const box = await (typeof target === "string" ? page.locator(target).first() : target).boundingBox({ timeout: 30000 }); if (!box) throw new Error(`nothing on screen for ${target}`); return box; };
const topOf = (selector, text, offset) => page.evaluate(([sel, txt, off]) => { const el = [...document.querySelectorAll(sel)].find((e) => !txt || e.textContent.trim().startsWith(txt)); return el ? Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - off)) : null; }, [selector, text, offset]);
const jump = async (y) => { if (y == null) throw new Error("nothing to scroll to"); await page.evaluate((to) => window.scrollTo(0, to), y); await sleep(1800); };

const shots = {};
async function record(name, boxes, run) {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  const rects = {};
  for (const [key, target] of Object.entries(boxes)) rects[key] = await boxOf(target);
  const shot = { frames: [], writes: [], marks: {}, rolling: true, t0: Date.now() }, at = () => +((Date.now() - shot.t0) / SLOW / 1000).toFixed(4);
  // The camera: pictures one after another, at most RATE for each second of film, each stamped with the film time at its middle.
  const camera = (async () => {
    while (shot.rolling) {
      const asked = Date.now();
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
      const file = `${String(shot.frames.length).padStart(5, "0")}.png`;
      shot.frames.push({ t: +(((asked + Date.now()) / 2 - shot.t0) / SLOW / 1000).toFixed(4), file });
      shot.writes.push(writeFile(path.join(folder, file), Buffer.from(data, "base64")));
      const spare = SLOW * 1000 / RATE - (Date.now() - asked);
      if (spare > 0) await real(spare);
    }
  })();
  /** Click something and note when: the edit puts that moment on a beat. */
  const press = async (label, target, ms = 420) => {
    const box = await boxOf(target);
    await moveTo(box.x + box.width / 2, box.y + box.height / 2, ms);
    await sleep(110);
    await page.mouse.down(); await sleep(50);
    shot.marks[label] = at();
    await page.mouse.up();
  };
  const mark = (label) => { shot.marks[label] = at(); };
  await sleep(700);
  await run({ press, mark });
  await sleep(500);
  shot.rolling = false;
  await camera;
  await Promise.all(shot.writes);
  const length = at();
  shots[name] = { frames: shot.frames, marks: shot.marks, rects, length };
  console.error(`${name}: ${shot.frames.length} pictures over ${length}s of film (${(shot.frames.length / length).toFixed(0)} a second), marks ${Object.keys(shot.marks).join(" ")}`);
}

try {
  const head = '[data-aaplus-bar][data-at="head"]', scope = '[data-aaplus-bar][data-at="scope"]';
  await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator(head).waitFor({ timeout: Number(process.env.WAIT ?? 120000) });
  await real(6000);
  // Walk the whole page once, so every section that loads on scroll is in before anything is filmed.
  for (let y = 0, tall = 1; y < tall; y += 600) { tall = Math.min(40000, await page.evaluate((to) => { window.scrollTo(0, to); return document.documentElement.scrollHeight; }, y)); await real(350); }
  await real(3000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await real(2000);
  // CSS transitions and animations keep their own clock: slow that one too.
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / SLOW });
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
    if (await label.count()) { const lb = await boxOf(label); await moveTo(lb.x - 8, lb.y + lb.height / 2, 600); mark("hover"); await sleep(1700); }
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

  writeFileSync(path.join(dir, "shots.json"), JSON.stringify({ width: W, height: H, scale: SCALE, slow: SLOW, shots }, null, 1));
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(ext, { recursive: true, force: true });
}
