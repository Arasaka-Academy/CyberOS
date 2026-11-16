import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RecordingPolicy } from "@cyberos/shared";
import type { StoragePool } from "../../api.js";
import { i18n, initI18n } from "../../i18n/index.js";
import { SettingsNvrContent } from "./SettingsNvrPage.js";

beforeAll(async () => { await initI18n(); await i18n.changeLanguage("en"); });

const policy: RecordingPolicy = { storagePoolId: "pool-1", directory: "NVR", retentionDays: 7, quotaBytes: 100 * 2 ** 30 };
const pools: StoragePool[] = [{ id: "pool-1", name: "Video storage", path: "/cyberos/data/pool-1", mountpoint: "/cyberos/data/pool-1", filesystem: "ext4", status: "ready" }];

describe("NVR settings", () => {
  const render = (form: RecordingPolicy | null = policy, storagePools = pools, error = "", busy = false) => renderToStaticMarkup(createElement(SettingsNvrContent, {
    form, storagePools, usedBytes: 2 ** 30, error, busy, saved: false, onChange: vi.fn(), onSubmit: vi.fn(), onRetry: vi.fn()
  }));

  it("uses the shared single-column layout for recording policy fields", () => {
    expect(render()).toContain('class="settings-field-grid settings-field-grid-single"');
  });

  it("exposes the existing recording policy bounds and a fixed save area", () => {
    const html = render();
    expect(html).toContain("Video storage");
    expect(html).toContain('min="1" max="3650" step="1"');
    expect(html).toContain('min="1" max="8388607" step="1"');
    expect(html).toContain('maxLength="2048"');
    expect(html).toContain('value="100"');
    expect(html).toContain("settings-actions");
    expect(html).not.toContain('type="password"');
  });

  it("keeps a missing selected pool visible without substituting a mounted pool", () => {
    const html = render({ ...policy, storagePoolId: "missing-pool" });
    expect(html).toContain("missing-pool");
    expect(html).toMatch(/type="submit"[^>]*disabled=""/u);
    expect(html).toContain('value="NVR"');
  });

  it("keeps failed drafts visible and locks policy fields during save", () => {
    const html = render({ ...policy, directory: "Draft footage", retentionDays: 21 }, pools, "Save failed", true);
    expect(html).toContain("Save failed");
    expect(html).toContain('value="Draft footage"');
    expect(html).toContain('value="21"');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/u);
  });

  it("renders a retry instead of an empty configuration when loading fails", () => {
    const html = render(null, pools, "NVR unavailable");
    expect(html).toContain("NVR unavailable");
    expect(html).toContain("Retry");
    expect(html).not.toContain('type="submit"');
  });
});
