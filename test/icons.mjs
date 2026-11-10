// Draws the extension's icons: a black disc with "A+" in a serif, like the site's own mark.
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT ?? "/Users/adam/priors-arena/node_modules/playwright/index.mjs");
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../icons");
const b = await chromium.launch();
for (const size of [16, 48, 128]) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#000"/><text x="64" y="88" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="68" fill="#fff">A+</text></svg></body>`);
  await p.screenshot({ path: path.join(out, `${size}.png`), omitBackground: true });
  await p.close();
}
await b.close();
