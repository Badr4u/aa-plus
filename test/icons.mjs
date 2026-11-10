// Renders icons/logo.svg to the PNG sizes Chrome wants. Optional second argument: a reference image to place beside it for comparison.
//   node test/icons.mjs [compare.png] [reference.png]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT ?? "/Users/adam/priors-arena/node_modules/playwright/index.mjs");
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../icons");
const svg = readFileSync(path.join(dir, "logo.svg"), "utf8");
const b = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body>`);
  await p.screenshot({ path: path.join(dir, `${size}.png`), omitBackground: true });
  await p.close();
}
const [compare, reference] = process.argv.slice(2);
if (compare) {
  const p = await b.newPage({ viewport: { width: 700, height: 240 }, deviceScaleFactor: 2 });
  const ref = reference ? `<img src="data:image/png;base64,${readFileSync(reference).toString("base64")}" width="200" height="200">` : "";
  await p.setContent(`<body style="margin:20px;display:flex;gap:20px;align-items:center;background:#fff">${ref}${svg.replace("<svg ", '<svg width="200" height="200" ')}${[48, 32, 16].map((s) => svg.replace("<svg ", `<svg width="${s}" height="${s}" `)).join("")}</body>`);
  await p.screenshot({ path: compare });
}
await b.close();
