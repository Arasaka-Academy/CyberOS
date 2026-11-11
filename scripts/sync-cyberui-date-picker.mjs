import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = path.join(root, "packages/ui/CYBERUI-DATE-PICKER.json");
const args = process.argv.slice(2);
const check = args.includes("--check");
const sourceFlag = args.indexOf("--source");
const sourceRoot = sourceFlag >= 0 ? args[sourceFlag + 1] : undefined;
const hash = value => createHash("sha256").update(value).digest("hex");
const files = ["date-picker.tsx", "date-picker.module.css", "calendar-date.ts", "provider.tsx"];

function adapt(source) {
  return source.replace(/(from\s+['"])(\.\/[^'"]+)(['"])/g, (match, prefix, target, quote) => /\.(?:js|css)$/.test(target) ? match : `${prefix}${target}.js${quote}`)
    .replace(/(['"])@cyberui\/tokens\1/g, '"./tokens.js"');
}

if (!sourceRoot) {
  if (!check) throw new Error("Provide --source /path/to/CyberUI, or --check for the checked-in source snapshot.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const file of manifest.files) {
    if (hash(await readFile(path.join(root, file.vendored))) !== file.vendoredSha256) throw new Error(`CyberUI source drift: ${file.vendored}. Sync from CyberUI instead of editing the vendor copy.`);
  }
  console.log("CyberUI date picker source snapshot verified.");
} else {
  const upstream = path.resolve(sourceRoot);
  const manifest = {
    repository: "https://github.com/Arasaka-Academy/CyberUI",
    version: JSON.parse(await readFile(path.join(upstream, "packages/react/package.json"), "utf8")).version,
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: upstream, encoding: "utf8" }).trim(),
    sourceDirty: Boolean(execFileSync("git", ["status", "--porcelain", "--", "packages/react/src"], { cwd: upstream, encoding: "utf8" }).trim()),
    transformations: ["Relative TypeScript imports gain .js for NodeNext.", "Provider token import uses the existing local tokens adapter."],
    files: []
  };
  for (const name of files) {
    const source = `packages/react/src/${name}`;
    const vendored = `packages/ui/src/vendor/${name}`;
    const original = await readFile(path.join(upstream, source), "utf8");
    const content = name.endsWith(".tsx") ? adapt(original) : original;
    if (check) {
      if (content !== await readFile(path.join(root, vendored), "utf8")) throw new Error(`CyberUI and CyberOS differ: ${name}`);
    } else await writeFile(path.join(root, vendored), content);
    manifest.files.push({ source, sourceSha256: hash(original), vendored, vendoredSha256: hash(content) });
  }
  if (!check) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`CyberUI date picker ${check ? "matches" : "synced from"} ${manifest.baseCommit}${manifest.sourceDirty ? " + local changes" : ""}.`);
}
