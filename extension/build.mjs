/* Build both browser variants from the single shared codebase.
   Usage: node build.mjs  ->  dist/chromium and dist/firefox */
import { cpSync, rmSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

for (const target of ["chromium", "firefox"]) {
    const out = join(dist, target);
    mkdirSync(out, { recursive: true });
    cpSync(join(root, "src"), join(out, "src"), { recursive: true });
    cpSync(join(root, "assets"), join(out, "assets"), { recursive: true });
    cpSync(join(root, "manifest.json"), join(out, "manifest.json"));
    if (target === "firefox") {
        cpSync(join(root, "manifest.firefox.json"), join(out, "manifest.json"));
    }
    console.log(`built dist/${target}`);
}
