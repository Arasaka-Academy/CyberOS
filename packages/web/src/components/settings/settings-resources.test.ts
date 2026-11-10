import { describe, expect, it, vi } from "vitest";
import { SettingsResourceStore, shareInFlight, settingsSectionResources } from "./settings-resources.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

describe("settings resource rounds", () => {
  it("deduplicates reads and reuses a ready resource until reopening", async () => {
    const store = new SettingsResourceStore(String);
    const request = deferred<string>();
    const read = vi.fn(() => request.promise);
    const apply = vi.fn();
    store.begin();
    const first = store.load("providers", read, apply);
    void store.load("providers", read, apply);
    request.resolve("ready");
    await first;
    await store.load("providers", read, apply);
    expect(read).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledExactlyOnceWith("ready");
    store.close();
    store.begin();
    await store.load("providers", read, apply);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("ignores old-round success and errors after close and reopen", async () => {
    const store = new SettingsResourceStore(String);
    const old = deferred<string>();
    const failure = deferred<string>();
    const apply = vi.fn();
    store.begin();
    const oldRead = store.load("providers", () => old.promise, apply);
    const oldFailure = store.load("bluetooth", () => failure.promise, apply);
    store.close();
    store.begin();
    await store.load("providers", async () => "new", apply);
    old.resolve("old");
    failure.reject(new Error("late failure"));
    await Promise.all([oldRead, oldFailure]);
    expect(apply).toHaveBeenCalledExactlyOnceWith("new");
    expect(store.getSnapshot().providers.status).toBe("ready");
    expect(store.getSnapshot().bluetooth.status).toBe("idle");
  });

  it("isolates concurrent failures and only retries the requested resource", async () => {
    const store = new SettingsResourceStore(String);
    store.begin();
    await Promise.all([
      store.load("indexerSettings", async () => "config", vi.fn()),
      store.load("indexerStatus", async () => { throw new Error("status failed"); }, vi.fn())
    ]);
    expect(store.getSnapshot().indexerSettings.status).toBe("ready");
    expect(store.getSnapshot().indexerStatus.status).toBe("error");
    const retry = vi.fn(async () => null);
    await store.load("indexerStatus", retry, vi.fn());
    expect(retry).not.toHaveBeenCalled();
    store.invalidate("indexerStatus");
    await store.load("indexerStatus", retry, vi.fn());
    expect(store.getSnapshot().indexerStatus.status).toBe("ready");
    expect(store.getSnapshot().indexerSettings.status).toBe("ready");
  });

  it("never loads resources for local-only or hidden mobile pages", () => {
    expect(settingsSectionResources("appearance")).toEqual([]);
    expect(settingsSectionResources("files")).toEqual([]);
    expect(settingsSectionResources(null)).toEqual([]);
    expect(settingsSectionResources("photos")).toEqual(["photoLibrary", "photoProcessing", "photoStatus"]);
  });

  it("shares only in-flight startup reads and allows a fresh later read", async () => {
    const request = deferred<string>();
    const read = vi.fn(() => request.promise);
    const shared = shareInFlight(read);
    const startup = shared();
    const settings = shared();
    expect(settings).toBe(startup);
    request.resolve("ready");
    await startup;
    await shared();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
