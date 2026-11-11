import { readFile, access } from "node:fs/promises";
import { expect, it } from "vitest";

it("ships licensed CyberUI fonts for the native TV overlay", async () => {
  const install = await readFile(new URL("./debian/install", import.meta.url), "utf8");
  expect(install).toContain("packages/ui/src/fonts/Oxanium-*.ttf usr/share/fonts/truetype/cyberos/");
  expect(install).toContain("packages/shared/src/fonts/ShareTechMono-Regular.ttf usr/share/fonts/truetype/cyberos/");
  expect(install).toContain("packages/ui/src/fonts/OFL-Oxanium.txt usr/share/doc/cyberos/fonts/");
  expect(install).toContain("packages/shared/src/fonts/share-tech-mono.LICENSE usr/share/doc/cyberos/fonts/");
  await access(new URL("../packages/shared/src/fonts/ShareTechMono-Regular.ttf", import.meta.url));
});
