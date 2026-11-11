import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps the CyberUI calendar snapshot intact instead of drifting in CyberOS", () => {
  const root = new URL("../../../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("packages/ui/CYBERUI-DATE-PICKER.json", root), "utf8")) as { files: { vendored: string; vendoredSha256: string }[] };
  for (const file of manifest.files) {
    const actual = createHash("sha256").update(readFileSync(new URL(file.vendored, root))).digest("hex");
    expect(actual, fileURLToPath(new URL(file.vendored, root))).toBe(file.vendoredSha256);
  }
});
