// Cuts the recorded shots (demo/shots.mjs) to the beat of the music edit and renders the film.
//   node demo/film.mjs <work dir> [out.mp4] [--draft]
// The timeline is written in bars and beats of the track (work/audio/music/*.edit.json, from cinetic's
// track.py): every cut sits on a beat and every click half a beat after its cut. Each frame is a pure
// function of its number, drawn in a headless page (footage frame, crop, logo, label) and screenshotted.
// The page is laid out at 1920x1080 and drawn at 4/3 device pixels, so the film is 2560x1440; the footage
// has three pixels per page pixel, so a push-in is drawn from real pixels, not enlarged.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "/Users/adam/priors-arena/node_modules/playwright/index.mjs");
const work = path.resolve(process.argv[2] ?? "demo-work"), draft = process.argv.includes("--draft");
const out = path.resolve(process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : path.join(work, "film.mp4"));
const FPS = 30, W = 1920, H = 1080, VW = 1440, VH = 810, DENSITY = draft ? 0.5 : 4 / 3;
const { shots } = JSON.parse(readFileSync(path.join(work, "shots/shots.json"), "utf8"));
const editFile = readdirSync(path.join(work, "audio/music")).find((f) => f.endsWith(".edit.json"));
const edit = JSON.parse(readFileSync(path.join(work, "audio/music", editFile), "utf8"));
const down = edit.film.downbeats;
/** Film time of a bar's beat (both from 1; a half beat is 1.5). */
const B = (bar, beat = 1) => down[bar - 1] + (beat - 1) * (down[Math.min(bar, down.length - 1)] - down[Math.min(bar, down.length - 1) - 1]) / 4;
const AND = (down[1] - down[0]) / 8;
const END = edit.ending.last_hit_film_s, LENGTH = END + 2.9;

/* ---------------- the cut ---------------- */
const FULL = [0, 0, VW, VH];
/** A 16:9 window around a box of the page, kept inside the frame. */
function around(x, y, w, h) {
  let cw = Math.max(w, h * 16 / 9), ch = cw * 9 / 16;
  if (cw > VW) { cw = VW; ch = VH; }
  const cx = Math.min(Math.max(x + w / 2, cw / 2), VW - cw / 2), cy = Math.min(Math.max(y + h / 2, ch / 2), VH - ch / 2);
  return [cx - cw / 2, cy - ch / 2, cw, ch];
}
const COST = around(900, 140, 540, 470), CHART = around(250, 330, 940, 480), RADAR = around(330, 262, 780, 540);
// cut: film time of the cut. mark: the click in that shot, placed `lead` seconds after the cut. crop: the window, or [from, to] to push in after the click.
const cut = (at, shot, mark, crop = FULL, lead = AND) => ({ at, shot, src: shots[shot].marks[mark] - lead, click: at + lead, crop, mark });
const SEGMENTS = [
  cut(B(3, 1), "cards", "plan", [FULL, COST], B(3, 3) - B(3, 1)),
  cut(B(5, 1), "cards", "high"), cut(B(5, 3), "cards", "medium"), cut(B(6, 1), "cards", "low"), cut(B(6, 3), "cards", "highest"),
  cut(B(7, 1), "scatter", "api", FULL, B(7, 3) - B(7, 1)),
  cut(B(8, 3), "scatter", "plan"),
  cut(B(10, 1), "scatter", "api", CHART), cut(B(10, 3), "scatter", "plan", CHART),   // once more, close on the Pareto line
  cut(B(11, 1), "scatter", "medium"), cut(B(11, 3), "scatter", "high"), cut(B(12, 1), "scatter", "highest"),
  { ...cut(B(12, 3), "radar", "tip", RADAR, B(13, 1) - B(12, 3)), click: null },
  cut(B(13, 3), "radar", "six", RADAR),
  cut(B(14, 1), "dark", "dark"),
  cut(B(15, 1), "dark", "api"), cut(B(15, 3), "dark", "plan"),
  cut(B(16, 1), "darkradar", "six", RADAR), cut(B(16, 3), "darkradar", "four", RADAR),
  cut(B(17, 1), "darkcards", "high"), cut(B(17, 3), "darkcards", "highest", [FULL, COST]),
];
const LABELS = [
  { from: B(3, 1), to: B(4, 4.6), text: "Subscription pricing" },
  { from: B(5, 1), to: B(6, 4.6), text: "Pick the efforts" },
  { from: B(7, 1), to: B(9, 4.6), text: "On AA's own charts" },
  { from: B(12, 3), to: B(13, 4.6), text: "Strengths radar" },
  { from: B(14, 1), to: B(15, 4.6), text: "Dark mode" },
];
const OPEN_END = B(3, 1), CLOSE = B(18, 1);
writeFileSync(path.join(work, "cues.json"), JSON.stringify({ fps: FPS, length: LENGTH, cuts: SEGMENTS.map((s) => +s.at.toFixed(3)), clicks: SEGMENTS.filter((s) => s.click != null).map((s) => +s.click.toFixed(3)), open: +OPEN_END.toFixed(3), close: +CLOSE.toFixed(3), lockup: +END.toFixed(3), stop: +SEGMENTS.find((s) => s.shot === "dark" && s.mark === "dark").click.toFixed(3), labels: LABELS.map((l) => +l.from.toFixed(3)) }, null, 1));

/* ---------------- the page that draws a frame ---------------- */
const MARK = '<svg viewBox="0 0 200 200"><rect width="200" height="200" rx="40" fill="#8841FD"/><g fill="#fff"><g transform="translate(-9 9)"><path class="z1" d="M100 43h28.5v28.5H118L89.5 100H43V71.5h28.5z"/><rect class="s1" x="128.5" y="71.5" width="28.5" height="28.5"/><path class="z2" d="M100 100h28.5v28.5H118L89.5 157H43v-28.5h28.5z"/><rect class="s2" x="128.5" y="128.5" width="28.5" height="28.5"/></g><path class="plus" d="M149.5 29h11v12.5H173v11h-12.5V65h-11V52.5H137v-11h12.5z"/></g></svg>';
const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#fff}
#stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#fff;font-family:Inter,"SF Pro Display",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif}
#shot{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
#shot img{display:block;width:100%;height:100%}
#label{position:absolute;left:50%;bottom:58px;padding:16px 30px 17px;border-radius:14px;background:#0b0b0b;color:#fff;font-size:42px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;box-shadow:0 0 0 1.5px rgba(255,255,255,.16),0 14px 40px rgba(0,0,0,.28)}
#card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
#lock{display:flex;align-items:center;gap:56px;transform-origin:50% 50%}
#lock svg{width:310px;height:310px;display:block;flex:none;overflow:visible}
#lock svg *{transform-box:fill-box;transform-origin:50% 50%}
#words{display:flex;flex-direction:column;gap:18px;white-space:nowrap}
#name{font-size:190px;font-weight:650;letter-spacing:-.04em;line-height:1}
#line{font-size:47px;font-weight:500;letter-spacing:-.012em;opacity:.62}
</style><div id="stage"><div id="shot"><img id="img"></div><div id="card"><div id="lock">${MARK}<div id="words"><div id="name">AA Plus</div><div id="line">Priors controls for Artificial Analysis</div></div></div></div><div id="label"></div></div>
<script>
const P = ${JSON.stringify({ FPS, W, H, VW, VH, SEGMENTS, LABELS, OPEN_END, CLOSE, END, LENGTH, down, AND, frames: Object.fromEntries(Object.entries(shots).map(([k, s]) => [k, s.frames])), dir: "file://" + path.join(work, "shots") })};
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
const out = (t) => 1 - Math.pow(1 - clamp(t), 4), inOut = (t) => { t = clamp(t); return t < .5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2; }, back = (t) => { t = clamp(t); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const beatOf = (t) => { let i = 0; while (i < P.down.length - 2 && P.down[i + 1] <= t) i++; const len = P.down[i + 1] - P.down[i]; return { bar: i + 1, phase: ((t - P.down[i]) / (len / 4)) % 1, len: len / 4 }; };
/** The picture nearest a moment of a shot: the footage has about two for every frame of the film. */
function frameFile(shot, t) { const list = P.frames[shot]; let lo = 0, hi = list.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (list[mid].t <= t) lo = mid; else hi = mid - 1; } if (lo + 1 < list.length && list[lo + 1].t - t < t - list[lo].t) lo++; return P.dir + "/" + shot + "/" + list[lo].file; }
let shown = "";
window.draw = async (f) => {
  const t = f / P.FPS, img = $("img"), shot = $("shot"), card = $("card"), lock = $("lock"), label = $("label"), stage = $("stage");
  /* footage */
  let seg = null, next = null;
  for (let i = 0; i < P.SEGMENTS.length; i++) if (P.SEGMENTS[i].at <= t + 1e-6) { seg = P.SEGMENTS[i]; next = P.SEGMENTS[i + 1] ?? null; }
  const closing = t >= P.CLOSE, k = clamp((t - P.CLOSE) / (P.END - P.CLOSE));
  if (seg) {
    const since = t - seg.at, file = frameFile(seg.shot, seg.src + since);
    if (file !== shown) { shown = file; img.src = file; await img.decode(); }
    // The window on the page: a push toward what was clicked, starting on the click.
    const two = Array.isArray(seg.crop[0]), from = two ? seg.crop[0] : seg.crop, to = two ? seg.crop[1] : seg.crop;
    const p = two ? inOut((t - (seg.click ?? seg.at)) / 0.55) : 0, c = from.map((v, i) => lerp(v, to[i], p));
    // Every cut lands with a small punch that settles within a beat, and the shot keeps creeping in.
    const hold = (next ? next.at : P.CLOSE) - seg.at, punch = 1 + 0.045 * (1 - out(since / 0.32)) + 0.022 * out(since / Math.max(hold, 0.5));
    // The shot element is the whole page at film size; S makes the window fill the frame.
    const q = P.W / P.VW, S = (P.VW / c[2]) * punch * (closing ? lerp(1, 0.9, inOut(k)) : 1), cx = c[0] + c[2] / 2, cy = c[1] + c[3] / 2;
    shot.style.transform = "translate(" + (P.W / 2 - cx * q * S).toFixed(2) + "px," + (P.H / 2 - cy * q * S).toFixed(2) + "px) scale(" + S.toFixed(5) + ")";
    shot.style.filter = closing ? "blur(" + (22 * inOut(k)).toFixed(1) + "px) brightness(" + lerp(1, 0.25, inOut(k)).toFixed(3) + ")" : "none";
    shot.style.opacity = closing ? String(1 - inOut(clamp((k - 0.45) / 0.55))) : "1";
    shot.style.display = "";
  } else shot.style.display = "none";
  stage.style.background = closing ? "#0b0b0b" : "#fff";

  /* the logo: opens the film, and closes it on the track's last hit */
  const zs = lock.querySelectorAll(".z1,.z2,.s1,.s2,.plus"), name = $("name"), line = $("line"), words = $("words"), svg = lock.querySelector("svg");
  const part = (el, a, dx, dy, pop) => { el.style.opacity = String(out(a / 0.5)); el.style.transform = "translate(" + (dx * (1 - out(a))) + "px," + (dy * (1 - out(a))) + "px) scale(" + (pop ? lerp(0.55, 1, back(a)) : 1) + ")"; };
  if (t < P.OPEN_END) {
    card.style.display = "flex"; card.style.color = "#0b0b0b";
    const b = (bar, beat) => P.down[bar - 1] + (beat - 1) * (P.down[1] - P.down[0]) / 4, d = 0.42;
    if (f === 0) { for (const el of zs) { el.style.opacity = "1"; el.style.transform = "none"; } svg.style.transform = "none"; words.style.width = ""; name.style.opacity = line.style.opacity = "1"; name.style.transform = line.style.transform = "none"; lock.style.transform = "none"; lock.style.opacity = "1"; lock.style.filter = "none"; }
    else {
      // The mark builds piece by piece on the first bar's beats; the name answers on the second bar; then it all gives way to the page on the drop.
      svg.style.transform = "scale(" + lerp(0.86, 1, out((t - 0.02) / 0.5)) + ")";
      svg.style.opacity = String(out(t / 0.18));
      part(zs[0], (t - b(1, 1)) / d, -34, 0); part(zs[2], (t - b(1, 2)) / d, 34, 0); part(zs[1], (t - b(1, 3)) / d, 0, -26); part(zs[3], (t - b(1, 3) - 0.08) / d, 0, 26); part(zs[4], (t - b(1, 4)) / 0.36, 0, 0, true);
      const a = inOut((t - b(2, 1) + 0.06) / 0.5);
      words.style.width = (a * 860).toFixed(1) + "px"; words.style.overflow = "hidden"; lock.style.gap = (56 * a).toFixed(1) + "px";
      name.style.opacity = String(out((t - b(2, 1)) / 0.3)); name.style.transform = "translateX(" + (-40 * (1 - out((t - b(2, 1)) / 0.45))) + "px)";
      line.style.opacity = String(0.62 * out((t - b(2, 2.5)) / 0.35)); line.style.transform = "translateY(" + (14 * (1 - out((t - b(2, 2.5)) / 0.4))) + "px)";
      const leave = inOut((t - (P.OPEN_END - 0.2)) / 0.2);
      lock.style.transform = "scale(" + lerp(1, 1.22, leave) + ")"; lock.style.opacity = String(1 - leave); lock.style.filter = leave ? "blur(" + (16 * leave).toFixed(1) + "px)" : "none";
    }
  } else if (closing) {
    card.style.display = "flex"; card.style.color = "#fff";
    const a = (t - (P.END - 0.5)) / 0.5, landed = out(a), creep = 1 + 0.035 * clamp((t - P.END) / (P.LENGTH - P.END));
    for (const el of zs) { el.style.opacity = "1"; el.style.transform = "none"; }
    svg.style.opacity = "1"; svg.style.transform = "none"; words.style.width = "860px"; lock.style.gap = "56px"; name.style.transform = "none"; line.style.transform = "none";
    lock.style.transform = "scale(" + (lerp(1.32, 1, landed) * creep) + ")"; lock.style.opacity = String(out(a / 0.6)); lock.style.filter = a < 1 ? "blur(" + (14 * (1 - landed)).toFixed(1) + "px)" : "none";
    name.style.opacity = "1"; line.style.opacity = String(0.62 * out((t - P.END - 0.1) / 0.4));
    // The frame settles out with the last of the music.
    stage.style.filter = "brightness(" + (1 - inOut((t - (P.LENGTH - 0.55)) / 0.55)).toFixed(3) + ")";
  } else { card.style.display = "none"; stage.style.filter = "none"; }
  if (!closing) stage.style.filter = "none";

  /* the label */
  const lab = P.LABELS.find((l) => t >= l.from && t < l.to);
  if (lab) { const a = out((t - lab.from) / 0.3), z = inOut((t - (lab.to - 0.18)) / 0.18); label.textContent = lab.text; label.style.display = ""; label.style.opacity = String(a * (1 - z)); label.style.transform = "translate(-50%," + (22 * (1 - a) + 10 * z) + "px)"; }
  else label.style.display = "none";
};
</script>`;
writeFileSync(path.join(work, "film.html"), html);

/* ---------------- render ---------------- */
const seq = path.join(work, draft ? "seq-draft" : "seq");
rmSync(seq, { recursive: true, force: true });
mkdirSync(seq, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DENSITY })).newPage();
page.on("pageerror", (e) => { console.error("page error:", e.message); });
await page.goto("file://" + path.join(work, "film.html"));
const total = Math.round(LENGTH * FPS), step = draft ? 2 : 1;
for (let f = 0, n = 0; f < total; f += step, n++) {
  await page.evaluate((frame) => window.draw(frame), f);
  await page.locator("#stage").screenshot(draft ? { path: path.join(seq, `${String(n).padStart(5, "0")}.jpg`), type: "jpeg", quality: 80 } : { path: path.join(seq, `${String(n).padStart(5, "0")}.png`), type: "png" });
  if (n % 150 === 0) console.log(`frame ${f}/${total}`);
}
await browser.close();
const silent = out.replace(/\.mp4$/, ".silent.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS / step), "-i", path.join(seq, draft ? "%05d.jpg" : "%05d.png"), "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-r", String(FPS), "-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "23" : "16", "-movflags", "+faststart", "-an", silent], { stdio: "inherit" });
console.log(`${total} frames, ${LENGTH.toFixed(2)}s, ${SEGMENTS.length} cuts -> ${silent}`);
