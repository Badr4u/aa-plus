// Builds the store uploads:
//   store/dist/aa-plus-<version>.zip          Chrome Web Store
//   store/dist/aa-plus-<version>-firefox.zip  addons.mozilla.org
// and leaves store/dist/firefox/, the Firefox build unpacked, for about:debugging.
//   node store/package.mjs
// Only the files the extension runs are packed. The localhost host permission (used by `node test/run.mjs --base`
// against a local Priors) is dropped from the store builds, so the extension asks for no more than it uses there.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, stage } from "./build.mjs";

const dist = path.join(root, "store/dist");
mkdirSync(dist, { recursive: true });
for (const target of ["chrome", "firefox"]) {
  const dir = target === "firefox" ? path.join(dist, "firefox") : mkdtempSync(path.join(tmpdir(), "aaplus-store-"));
  const manifest = stage(target, dir);
  const out = path.join(dist, `aa-plus-${manifest.version}${target === "firefox" ? "-firefox" : ""}.zip`);
  rmSync(out, { force: true });
  execFileSync("zip", ["-q", "-X", "-r", out, "."], { cwd: dir });
  if (target !== "firefox") rmSync(dir, { recursive: true, force: true });
  console.log(`${out} (${manifest.name} ${manifest.version} for ${target}, hosts: ${manifest.host_permissions.join(" ")})`);
}
