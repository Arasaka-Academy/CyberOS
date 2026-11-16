import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const advisories = JSON.parse(readFileSync(new URL("./dependency-security-advisories.json", import.meta.url), "utf8"));

function versionParts(version) {
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  return version.split(".").map(Number);
}

function atLeast(version, minimum) {
  const actual = versionParts(version);
  const required = versionParts(minimum);
  for (const index of [0, 1, 2]) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

for (const advisory of advisories) {
  it(`alert #${advisory.alert}: ${advisory.ghsa} (${advisory.package}) stays patched`, () => {
    const contents = readFileSync(new URL(advisory.manifest, root), "utf8");
    const versions = advisory.manifest === "Cargo.lock"
      ? [...contents.matchAll(/\[\[package\]\]\nname = "([^"\n]+)"\nversion = "([^"\n]+)"/g)]
        .filter(match => match[1] === advisory.package).map(match => match[2])
      : Object.entries(JSON.parse(contents).packages)
        .filter(([location]) => location.endsWith(`node_modules/${advisory.package}`))
        .map(([, dependency]) => dependency.version);

    expect(versions.length, "advisory package must remain covered by the lockfile check").toBeGreaterThan(0);
    for (const version of versions) {
      const major = versionParts(version)[0];
      if (advisory.major !== undefined && major !== advisory.major) continue;
      if (advisory.unaffectedMajors?.includes(major)) continue;
      expect(atLeast(version, advisory.minimumVersion), version).toBe(true);
    }
  });
}
