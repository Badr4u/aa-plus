// Records the demo: the real extension on the live Artificial Analysis site, in a headless Chromium.
//   node demo/record.mjs <work dir> [out.mp4]
// It captures the page's own frames (2x, so the 1080p result is sharp) and draws a pointer so clicks can be
// followed. Nothing is cut: no control reloads the page. No window opens.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "/Users/adam/priors-arena/node_modules/playwright/index.mjs");
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.resolve(process.argv[2] ?? "demo-work"), out = path.resolve(process.argv[3] ?? path.join(work, "aa-plus-demo.mp4"));
const raw = path.join(work, "raw"), seq = path.join(work, "seq");
rmSync(raw, { recursive: true, force: true }); rmSync(seq, { recursive: true, force: true });
mkdirSync(raw, { recursive: true }); mkdirSync(seq, { recursive: true });

const W = 1440, H = 810, FPS = 30;
const profile = mkdtempSync(path.join(tmpdir(), "aaplus-demo-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: W, height: H }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });

// A pointer drawn in the page: a headless browser has none. It follows the real mouse events and survives reloads.
await ctx.addInitScript(() => {
  if (window.top !== window) return;
  const KEY = "demo:pointer";
  let pos; try { pos = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { /* fresh */ }
  pos = pos || { x: 760, y: 330 };
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:22px;height:22px;will-change:transform";
  el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5v16.2l4.4-3.9 2.8 6.6 2.7-1.2-2.8-6.5h5.9z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const place = () => { el.style.transform = `translate(${pos.x - 3}px,${pos.y - 1.5}px)`; };
  place();
  addEventListener("mousemove", (e) => { pos = { x: e.clientX, y: e.clientY }; place(); try { sessionStorage.setItem(KEY, JSON.stringify(pos)); } catch { /* fine */ } }, true);
  addEventListener("mousedown", () => {
    const ring = document.createElement("div");
    ring.style.cssText = `position:fixed;left:${pos.x - 14}px;top:${pos.y - 14}px;width:28px;height:28px;border-radius:50%;border:2px solid rgba(17,17,17,.55);z-index:2147483646;pointer-events:none;transition:transform .35s ease-out,opacity .35s ease-out`;
    document.documentElement.append(ring);
    requestAnimationFrame(() => { ring.style.transform = "scale(1.7)"; ring.style.opacity = "0"; });
    setTimeout(() => ring.remove(), 420);
  }, true);
  setInterval(() => { if (!el.isConnected && document.documentElement) document.documentElement.append(el); }, 100);
});

const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker", { timeout: 15000 });
// Start from Artificial Analysis as it is: API prices, each model's highest effort.
await worker.evaluate(() => chrome.storage.local.set({ settings: { pricing: "api", plans: {}, efforts: { mode: "highest", list: [] }, chart: true } }));
const page = await ctx.newPage();
const sleep = (ms) => page.waitForTimeout(ms);
const now = () => Date.now() / 1000;
let mouse = { x: 760, y: 330 };
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

async function moveTo(x, y, ms = 700) {
  const from = { ...mouse }, steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) { const k = ease(i / steps); await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k); await sleep(ms / steps * 0.55); }
  mouse = { x, y };
}
async function click(locator, ms = 700) {
  const box = await locator.boundingBox();
  await moveTo(box.x + box.width / 2, box.y + box.height / 2, ms);
  await sleep(160);
  await page.mouse.down(); await sleep(70); await page.mouse.up();
}
/** Scroll the page to `top` over `ms`, eased, driven from inside the page so every frame is drawn. */
const scrollTo = (top, ms = 1300) => page.evaluate(([to, dur]) => new Promise((done) => {
  const from = window.scrollY, t0 = performance.now(), e = (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const step = (t) => { const k = Math.min(1, (t - t0) / dur); window.scrollTo(0, from + (to - from) * e(k)); if (k < 1) requestAnimationFrame(step); else done(); };
  requestAnimationFrame(step);
}), [top, ms]);
const topOf = (selector, text, offset = 96) => page.evaluate(([sel, txt, off]) => { const el = [...document.querySelectorAll(sel)].find((e) => !txt || e.textContent.trim().startsWith(txt)); return el ? Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - off)) : null; }, [selector, text, offset]);

/* ---------------- capture ---------------- */

const frames = [];
let cdp, n = 0;
async function startCapture() {
  cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = path.join(raw, `${String(n++).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ t: metadata.timestamp, file });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 93, everyNthFrame: 1 });
}

try {
  const head = page.locator('[data-aaplus-bar][data-at="head"]'), scope = page.locator('[data-aaplus-bar][data-at="scope"]');
  await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await head.waitFor({ timeout: 60000 });
  await sleep(3500);
  // Clear of AA's fixed header, which takes the clicks of anything that scrolls under it.
  const cards = await topOf('[data-aaplus-bar][data-at="head"]', "", 150);
  await page.evaluate((y) => window.scrollTo(0, y), cards);
  await page.mouse.move(mouse.x, mouse.y);
  await sleep(1200);

  await startCapture();
  const begin = now();
  let hero = null;
  const stay = async (text, offset) => scrollTo(await topOf("h2, h3", text, offset), 1500);
  await sleep(1500);                                                        // AA as it is: $26.54 a task for the top model
  await click(head.locator('[data-aaplus-pricing="plan"]'), 900);           // Subscription: the cost card re-sorts and counts down
  await sleep(2500);
  await click(head.locator('[data-aaplus-effort="high"]'), 800);            // efforts: every model at High
  await sleep(1900);
  await click(head.locator('[data-aaplus-effort="highest"]'), 600);
  await sleep(1200);
  await moveTo(720, 430, 500);
  await scrollTo(await topOf("[data-aaplus-card]", "", 100), 1300);         // the chart AA Plus adds
  await sleep(1900);

  /* The scatter: intelligence against cost per task, AA's own chart, repriced with its Pareto line. */
  await stay("Intelligence Index vs. Cost per Task", 190);
  await sleep(2600);
  hero = now();
  const scatter = page.locator("[data-aaplus-scope] h3", { hasText: "Intelligence Index vs. Cost per Task" }).first();
  await click(scatter.locator('[data-aaplus-pricing="api"]'), 900);         // the switch beside the chart's own title
  await sleep(2900);
  await click(scatter.locator('[data-aaplus-pricing="plan"]'), 500);
  await sleep(2900);
  const label = page.locator("[data-aaplus-scope] svg text", { hasText: /^Claude Opus 5\.5/ }).first();   // a point's own tooltip: the plan cost
  if (await label.count()) { const lb = await label.boundingBox(); await moveTo(lb.x - 8, lb.y + lb.height / 2, 900); await sleep(2300); }
  await click(scope.locator('[data-aaplus-effort="medium"]'), 900);         // the row stays with you; AA's selection follows it
  await sleep(3000);
  await click(scope.locator('[data-aaplus-effort="highest"]'), 700);
  await sleep(2300);

  /* The radar, in AA's Benchmarks section. */
  await moveTo(720, 470, 400);
  await scrollTo(await topOf("[data-aaplus-radar]", "", 185), 1900);
  await sleep(2200);
  const spoke = page.locator('[data-aaplus-radar] svg g[style*="help"]').nth(2), sb = await spoke.boundingBox();
  await moveTo(sb.x + sb.width / 2, sb.y + sb.height / 2, 900);             // what an evaluation measures
  await sleep(3000);
  await click(page.locator('[data-aaplus-radar-top="6"]'), 900);
  await sleep(2400);

  /* Dark mode, which Artificial Analysis does not have. */
  await click(scope.locator("[data-aaplus-theme]"), 900);
  await sleep(2300);
  await moveTo(720, 470, 400);
  await stay("Intelligence Index vs. Cost per Task", 190);
  await sleep(2800);
  await scrollTo(cards, 1900);
  await sleep(2600);
  const end = now();
  await cdp.send("Page.stopScreencast");
  await sleep(300);

  /* ---------------- hold frames to a steady 30 a second ---------------- */
  frames.sort((a, b) => a.t - b.t);
  const total = end - begin;
  const frameAt = (t) => { let lo = 0, hi = frames.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid - 1; } return frames[lo].file; };
  const count = Math.round(total * FPS);
  // Frame 0 is the picture that stands for the film: AA's intelligence-against-cost chart at subscription prices, the controls in view.
  symlinkSync(frameAt(hero ?? end), path.join(seq, "000000.jpg"));
  for (let k = 0; k < count; k++) symlinkSync(frameAt(begin + k / FPS), path.join(seq, `${String(k + 1).padStart(6, "0")}.jpg`));
  writeFileSync(path.join(work, "edit.json"), JSON.stringify({ begin, end, captured: frames.length, seconds: total }, null, 1));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(seq, "%06d.jpg"), "-vf", "scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-movflags", "+faststart", "-an", out], { stdio: "inherit" });
  console.log(`captured ${frames.length} frames, ${total.toFixed(1)}s -> ${out}`);
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
