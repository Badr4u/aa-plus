// Stages the files the extension runs into a folder, with a manifest for Chrome or Firefox.
// One source tree serves both; only the manifest differs:
//  - Firefox runs MV3 background code as an event page (`background.scripts`), not a service worker;
//  - Firefox needs an add-on id, and AMO wants the built-in data consent (AA Plus collects nothing).
// `dev` keeps the localhost host permission that `--base` in the tests uses against a local Priors.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIREFOX_ID = "aa-plus@mypriors.com";
const FILES = ["background.js", "chart.js", "content.js", "page.js", "popup.html", "popup.js", "shared.js", "shared.page.js", "icons/16.png", "icons/32.png", "icons/48.png", "icons/128.png"];

export function manifestFor(target, { dev = false } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (!dev) manifest.host_permissions = manifest.host_permissions.filter((h) => !h.startsWith("http://localhost"));
  if (target === "firefox") {
    manifest.background = { scripts: [manifest.background.service_worker] };
    manifest.browser_specific_settings = {
      gecko: { id: FIREFOX_ID, strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } },
      gecko_android: { strict_min_version: "142.0" },
    };
  }
  return manifest;
}

/** Copies the extension into `dir` (emptied first) with the manifest for `target`. */
export function stage(target, dir, options) {
  if (readFileSync(path.join(root, "shared.js"), "utf8") !== readFileSync(path.join(root, "shared.page.js"), "utf8")) throw new Error("shared.page.js is not a copy of shared.js: cp shared.js shared.page.js");
  rmSync(dir, { recursive: true, force: true });
  for (const f of FILES) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); cpSync(path.join(root, f), path.join(dir, f)); }
  const manifest = manifestFor(target, options);
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
