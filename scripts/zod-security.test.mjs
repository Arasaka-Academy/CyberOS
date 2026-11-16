import { createRequire } from "node:module";
import { URL } from "node:url";
import { expect, it } from "vitest";

const docsRequire = createRequire(new URL("../docs/package.json", import.meta.url));
const zod = docsRequire("zod").z;

for (const kind of ["array", "set", "map"]) {
  for (const mode of ["sync", "async"]) {
    it(`GHSA-mrhx-c7xc-m3w5 bounds ${mode} ${kind} validation before parsing elements`, async () => {
      let parsed = 0;
      const element = zod.string().transform(value => { parsed += 1; return value; });
      const schema = kind === "array" ? zod.array(element).max(2)
        : kind === "set" ? zod.set(element).max(2) : zod.map(zod.string(), element).max(2);
      const collection = values => kind === "map" ? new Map(values.map(value => [value, value]))
        : kind === "set" ? new Set(values) : values;
      const oversized = collection(["one", "two", "three"]);
      const rejected = mode === "sync" ? schema.safeParse(oversized) : await schema.safeParseAsync(oversized);

      expect(rejected.success).toBe(false);
      expect(rejected.error.issues).toHaveLength(1);
      expect(rejected.error.issues[0].code).toBe("too_big");
      expect(parsed).toBe(0);

      const bounded = collection(["one", "two"]);
      const accepted = mode === "sync" ? schema.safeParse(bounded) : await schema.safeParseAsync(bounded);
      expect(accepted.success).toBe(true);
      expect(parsed).toBe(2);
    });
  }
}
