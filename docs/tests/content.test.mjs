import { readdir, readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

const docsRoot = path.resolve("src/content/docs");
const repoRoot = path.resolve("..");

test("project entry points share the personal operating system positioning", async () => {
  const tagline = "personal operating system for the cyber era";
  const entryPoints = [
    "README.md",
    "AGENTS.md",
    "packages/web/index.html",
    "docs/astro.config.mjs",
    "docs/src/components/DocsHome.astro",
    "docs/src/content/docs/index.mdx",
    "docs/src/content/docs/reference/frontend-design.md"
  ];
  for (const entryPoint of entryPoints) {
    const source = await readFile(path.join(repoRoot, entryPoint), "utf8");
    assert(source.toLowerCase().includes(tagline), `${entryPoint} must declare the English project positioning`);
    assert(!source.includes("赛博时代的个人操作系统"), `${entryPoint} must keep the Chinese tagline in translations only`);
  }
  const metadata = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert(metadata.description === `A ${tagline}`, "package.json must use the English project tagline as its description");
  const control = await readFile(path.join(repoRoot, "packaging/debian/control"), "utf8");
  assert(/^Description: Personal operating system for the cyber era$/m.test(control), "the Debian package must use the English project positioning");
});

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(absolute));
    else if (/\.(md|mdx)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

test("every published page declares its content contract and valid source paths", async () => {
  const files = await markdownFiles(docsRoot);
  assert(files.length > 0, "the docs collection must not be empty");
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const match = source.match(/^---\n([\s\S]*?)\n---/);
    assert(match, `${file} is missing frontmatter`);
    const frontmatter = parse(match[1]);
    for (const field of ["title", "description", "type", "status", "audience", "sourceOfTruth"]) {
      assert(frontmatter[field], `${file} is missing ${field}`);
    }
    for (const sourcePath of frontmatter.sourceOfTruth) {
      assert(!path.isAbsolute(sourcePath), `${file} has an absolute source path: ${sourcePath}`);
      await access(path.join(repoRoot, sourcePath));
    }
  }
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
