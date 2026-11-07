import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
it("runs NVR independently of API restarts with non-root private storage", async () => {
  const unit = await readFile(new URL("./systemd/cyberos-nvr.service", import.meta.url), "utf8");
  expect(unit).toContain("User=cyberos"); expect(unit).toContain("UMask=0077");
  expect(unit).toContain("KillMode=control-group"); expect(unit).toContain("NoNewPrivileges=yes");
  expect(unit).not.toMatch(/^(?:Requires|BindsTo|PartOf)=.*cyberos-api/mu);
  expect(await readFile(new URL("./debian/install", import.meta.url), "utf8")).toContain("target/release/cyberos-nvr usr/lib/cyberos/bin/");
});
