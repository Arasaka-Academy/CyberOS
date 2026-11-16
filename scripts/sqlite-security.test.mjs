import { createRequire } from "node:module";
import { expect, it } from "vitest";

const databaseRequire = createRequire(new URL("../packages/db/package.json", import.meta.url));
const Database = databaseRequire("better-sqlite3");

it("CVE-2026-119375 uses SQLite with the crafted WAL memory disclosure fix", () => {
  const database = new Database(":memory:");
  try {
    const { version } = database.prepare("SELECT sqlite_version() AS version").get();
    const [major, minor] = version.split(".").map(Number);
    expect(major > 3 || (major === 3 && minor >= 54), version).toBe(true);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    database.close();
  }
});
