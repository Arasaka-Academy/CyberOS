import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

describe("release workflow", () => {
  it("builds and validates the release manifest from explicit jq arguments", async () => {
    const workflow = await readFile(new URL("../.github/workflows/package-release.yml", import.meta.url), "utf8");

    for (const field of ["repository", "tag", "version", "commitSha", "architecture", "asset", "sha256"]) {
      expect(workflow).toContain(`${field}: $${field}`);
    }

    expect(workflow).toContain(".repository == $repository and");
    expect(workflow).toContain("release-manifest.json >/dev/null");
    expect(workflow).not.toContain("'{repository, tag, version, commitSha, architecture, asset, sha256}'");
    expect(workflow).not.toContain("relocate-mount");
    expect(workflow).not.toContain("migration-recovery");
  });

  it.each([
    { repository: "Arasaka-Academy/CyberOS", accepted: true },
    { repository: "zhubby/CyberOS", accepted: false },
    { repository: "untrusted/CyberOS", accepted: false }
  ])("checks the deployment manifest repository: $repository", async ({ repository, accepted }) => {
    const helper = await readFile(new URL("../packaging/scripts/cyberos-deploy", import.meta.url), "utf8");
    const validator = helper.match(/read_manifest\(\) \{[\s\S]*?<<'NODE'\n([\s\S]*?)\nNODE/u)?.[1];
    expect(validator).toBeDefined();
    const root = await mkdtemp(path.join(os.tmpdir(), "cyberos-release-manifest-"));
    try {
      const manifestPath = path.join(root, "release-manifest.json");
      await writeFile(manifestPath, JSON.stringify({
        repository, tag: "v2.4.10", version: "2.4.10", commitSha: "a".repeat(40),
        architecture: "arm64", asset: "cyberos_2.4.10_arm64.deb", sha256: "b".repeat(64)
      }));
      const result = spawnSync(process.execPath, ["--input-type=module", "-", manifestPath], {
        input: validator, encoding: "utf8"
      });
      expect(result.status).toBe(accepted ? 0 : 1);
      if (accepted) expect(result.stdout.split("\t")[0]).toBe(repository);
      else expect(result.stderr).toContain("manifest repository is not trusted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
