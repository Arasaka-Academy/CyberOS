/**
 * [INPUT]: 依赖滑块来源清单和固定的本地源码快照。
 * [OUTPUT]: 拒绝未同步来源清单的上游源码漂移。
 * [POS]: UI 滑块来源与适配边界的回归检查。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the recorded CyberUI slider snapshot intact", () => {
  const root = new URL("../../../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("packages/ui/CYBERUI-SLIDER.json", root), "utf8")) as { files: { vendored: string; vendoredSha256: string }[] };
  for (const file of manifest.files) {
    const actual = createHash("sha256").update(readFileSync(new URL(file.vendored, root))).digest("hex");
    expect(actual, file.vendored).toBe(file.vendoredSha256);
  }
});
