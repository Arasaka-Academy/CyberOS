import { describe, expect, it } from "vitest";
import { canonicalAction, collectApiActions } from "./api-actions.test-support.js";
import { PARITY_MANIFEST } from "./parity-manifest.js";
import { ADDITIONAL_PRODUCT_ACTIONS, PRODUCT_ACTION_EXCLUSIONS } from "./product-actions.js";

describe("bidirectional product action coverage", () => {
  const actions = collectApiActions();
  const known = new Set(actions.map(canonicalAction));
  const mapped = PARITY_MANIFEST.flatMap((entry) => entry.rest);
  const exclusions = PRODUCT_ACTION_EXCLUSIONS.flatMap((entry) => entry.actions);

  it("only maps existing API actions, including concrete NVR daemon routes", () => {
    expect(mapped.filter((action) => !known.has(canonicalAction(action)))).toEqual([]);
    expect(actions).toContain("GET /api/nvr/segments/:id");
    expect(actions).toContain("PATCH /api/nvr/devices/:id");
  });

  it("requires a capability or an explicit reason for every product action", () => {
    const covered = new Set([...mapped, ...exclusions].map(canonicalAction));
    expect(actions.filter((action) => !covered.has(canonicalAction(action)))).toEqual([]);
  });

  it("rejects stale, duplicate or overlapping exclusions", () => {
    const seen = new Set(mapped.map(canonicalAction));
    for (const entry of PRODUCT_ACTION_EXCLUSIONS) {
      expect(entry.reason.trim().length).toBeGreaterThan(30);
      for (const action of entry.actions) {
        expect(known.has(canonicalAction(action)), action).toBe(true);
        expect(seen.has(canonicalAction(action)), action).toBe(false);
        seen.add(canonicalAction(action));
      }
    }
    for (const id of Object.keys(ADDITIONAL_PRODUCT_ACTIONS)) expect(PARITY_MANIFEST.some((entry) => entry.capabilityId === id), id).toBe(true);
  });
});
