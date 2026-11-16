import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { DOMPurify } from "dompurify";

const require = createRequire(import.meta.url);
const purifierScript = path.join(path.dirname(require.resolve("dompurify")), "purify.min.js");

for (const expression of ["${securityMarker()}", "{{securityMarker()}}", "<%securityMarker()%>"]) {
  for (const nested of [false, true]) {
    test(`GHSA-cg2g-xh64-v4q7 scrubs ${expression} in ${nested ? "nested" : "attached"} shadow roots`, async ({ page }) => {
      await page.addScriptTag({ path: purifierScript });
      const result = await page.evaluate(({ expression, nested }) => {
        const purifier = (window as unknown as { DOMPurify: DOMPurify }).DOMPurify;
        const host = document.createElement("div");
        let shadow = host.attachShadow({ mode: "open" });
        if (nested) {
          const child = document.createElement("div");
          shadow.append(child);
          shadow = child.attachShadow({ mode: "open" });
        }
        const safe = document.createElement("p");
        safe.textContent = "safe content";
        shadow.append(safe);
        for (const character of expression) {
          shadow.append(document.createTextNode(character), document.createElement("object"));
        }
        purifier.sanitize(host, { IN_PLACE: true, SAFE_FOR_TEMPLATES: true });
        shadow.normalize();
        return { content: shadow.textContent, separator: shadow.querySelector("object") !== null };
      }, { expression, nested });

      expect(result.separator).toBe(false);
      expect(result.content).toContain("safe content");
      expect(result.content).not.toContain(expression);
    });
  }
}
