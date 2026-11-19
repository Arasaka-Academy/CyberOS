/**
 * [INPUT]: 依赖固定 CyberUI 提交中的滑块源码与来源清单。
 * [OUTPUT]: 同步滑块快照并校验本地源码哈希。
 * [POS]: 只更新滑块组件，不覆盖既有 CyberUI 适配。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = path.join(root, "packages/ui/CYBERUI-SLIDER.json");
const args = process.argv.slice(2);
const check = args.includes("--check");
const sourceFlag = args.indexOf("--source");
const sourceRoot = sourceFlag >= 0 ? args[sourceFlag + 1] : undefined;
const baseCommit = "80c468cf0c6bffecda3d47bd8112c6d583d4fd0e";
const hash = value => createHash("sha256").update(value).digest("hex");
const files = ["slider.tsx", "slider.module.css"];
const adapt = source => source.replace(/(from\s+['"])(\.\/[^'"]+)(['"])/g, (match, prefix, target, quote) => /\.(?:js|css)$/.test(target) ? match : `${prefix}${target}.js${quote}`).replace(/className=\{((?:s|fieldStyles)\.[A-Za-z]+)\}/g, "className={cx($1)}");

if (!sourceRoot) {
  if (!check) throw new Error("Provide --source /path/to/CyberUI, or --check for the local snapshot.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const file of manifest.files) {
    if (hash(await readFile(path.join(root, file.vendored))) !== file.vendoredSha256) throw new Error(`CyberUI slider source drift: ${file.vendored}`);
  }
  console.log("CyberUI slider source snapshot verified.");
} else {
  const upstream = path.resolve(sourceRoot);
  const manifest = { repository: "https://github.com/Arasaka-Academy/CyberUI", version: "0.3.0", baseCommit, transformations: ["Relative TypeScript imports gain .js for NodeNext.", "CSS Module indexed class names use cx for exact optional types."], files: [] };
  for (const name of files) {
    const source = `packages/react/src/${name}`;
    const vendored = `packages/ui/src/vendor/${name}`;
    const original = execFileSync("git", ["show", `${baseCommit}:${source}`], { cwd: upstream, encoding: "utf8" });
    const content = name.endsWith(".tsx") ? adapt(original) : original;
    if (check) {
      if (content !== await readFile(path.join(root, vendored), "utf8")) throw new Error(`CyberUI slider differs: ${name}`);
    } else await writeFile(path.join(root, vendored), content);
    manifest.files.push({ source, sourceSha256: hash(original), vendored, vendoredSha256: hash(content) });
  }
  if (!check) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`CyberUI slider ${check ? "matches" : "synced from"} ${baseCommit}.`);
}
