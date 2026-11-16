import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { expect, it } from "vitest";

it("GHSA-9hj8-73fh-9963 uses fixed ZIP releases without legacy decoders", () => {
  const manifest = readFileSync(new URL("../Cargo.toml", import.meta.url), "utf8");
  const declaration = manifest.match(/^zip = (.+)$/m)?.[1] ?? "";
  expect(declaration).toContain("default-features = false");
  expect(declaration).toContain('features = ["deflate"]');
  expect(declaration).not.toContain("legacy-zip");

  const lock = readFileSync(new URL("../Cargo.lock", import.meta.url), "utf8");
  const versions = Array.from(lock.matchAll(/\[\[package\]\]\nname = "zip"\nversion = "([^"]+)"/g), match => match[1]);
  expect(versions.length).toBeGreaterThan(0);
  for (const version of versions) {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number(version.split(".")[0])).toBeGreaterThanOrEqual(9);
  }
});
