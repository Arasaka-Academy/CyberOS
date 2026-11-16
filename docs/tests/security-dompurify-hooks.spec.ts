import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { DOMPurify } from "dompurify";

const require = createRequire(import.meta.url);
const purifierScript = path.join(path.dirname(require.resolve("dompurify")), "purify.min.js");
const hooks = ["beforeSanitizeElements", "uponSanitizeElement", "afterSanitizeElements", "beforeSanitizeAttributes", "afterSanitizeAttributes"] as const;

for (const hook of hooks) {
  for (const mode of ["parent", "nextSibling"] as const) {
    test(`GHSA-mrv2-3pqr-j5jr neutralizes handlers when ${hook} removes ${mode}`, async ({ page }) => {
      await page.addScriptTag({ path: purifierScript });
      const result = await page.evaluate(({ hook, mode }) => {
        const purifier = (window as unknown as { DOMPurify: DOMPurify }).DOMPurify;
        const root = document.createElement("div");
        root.innerHTML = '<figure><img class="remove"><img id="unsafe" onerror="securityMarker()"></figure><p>safe content</p>';
        document.body.append(root);
        const unsafe = root.querySelector("#unsafe");
        if (!unsafe) throw new Error("Missing regression fixture");
        const detach = (node: Node) => {
          if (!(node instanceof Element) || !node.classList.contains("remove")) return;
          if (mode === "parent") node.parentElement?.remove();
          else node.nextElementSibling?.remove();
        };
        switch (hook) {
          case "uponSanitizeElement":
            purifier.addHook(hook, detach);
            break;
          case "beforeSanitizeElements":
          case "afterSanitizeElements":
            purifier.addHook(hook, detach);
            break;
          case "beforeSanitizeAttributes":
          case "afterSanitizeAttributes":
            purifier.addHook(hook, detach);
        }
        purifier.sanitize(root, { IN_PLACE: true });
        return { handler: unsafe.getAttribute("onerror"), content: root.textContent };
      }, { hook, mode });

      expect(result.handler).toBeNull();
      expect(result.content).toContain("safe content");
    });
  }
}
