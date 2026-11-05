// Bundles the demo page and the Chrome extension, then zips the extension for download.
import { build } from "esbuild";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const common = { bundle: true, minify: true, target: "es2022", logLevel: "info" };

await build({ ...common, entryPoints: ["src/demo/main.ts"], outfile: "public/assets/demo.js", format: "esm" });
await build({ ...common, entryPoints: ["src/extension/content.ts"], outfile: "extension/dist/content.js", format: "iife" });
await build({ ...common, entryPoints: ["src/extension/background.ts"], outfile: "extension/dist/background.js", format: "esm" });

// Zip the extension folder (manifest, icons, dist) so the demo page can offer it as a download.
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[`wisp-extension/${relative("extension", p).replace(/\\/g, "/")}`] = readFileSync(p);
  }
};
walk("extension");
mkdirSync("public", { recursive: true });
writeFileSync("public/wisp-extension.zip", zipSync(files, { level: 9 }));
console.log(`Zipped ${Object.keys(files).length} extension files -> public/wisp-extension.zip`);
