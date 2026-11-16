import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NvrOverview } from "@cyberos/shared";
import { initI18n, i18n } from "../../i18n/index.js";
import { NvrDevices } from "./NvrDevices.js";

beforeAll(async () => { await initI18n(); await i18n.changeLanguage("en"); });

const overview: NvrOverview = {
  devices: [{ id: "jetson", name: "Jetson Nano", onvifUrl: "http://camera/onvif/device_service", credentialsConfigured: true,
    profiles: [{ token: "raw", name: "Raw", rtspUri: "", snapshotUri: "" }], recordingEnabled: false, recordingProfile: "raw",
    removedAt: null, connection: "disconnected", video: "unavailable", recording: "disabled", ptz: "unavailable",
    analytics: null, person: null, vehicle: null, lastError: "Raw transport diagnostic", updatedAt: "2026-11-15T00:00:00Z" }],
  policy: { storagePoolId: null, directory: "NVR", retentionDays: 7, quotaBytes: 100 * 2 ** 30 },
  usedBytes: 0, maxRecordings: 4, heartbeatAt: "2026-11-15T00:00:00Z"
};

describe("NVR device management", () => {
  const render = (value = overview) => {
    const props = { overview: value, refresh: vi.fn(), onOpen: vi.fn() };
    return renderToStaticMarkup(createElement(NvrDevices, props));
  };

  it("uses a device table without storage or credential forms", () => {
    const html = render();
    expect(html).toContain("<table");
    expect(html).toContain("Jetson Nano");
    expect(html).not.toContain("nvr-management-storage");
    expect(html).not.toContain("Recording settings");
    expect(html).not.toContain("Recording storage not configured");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Raw transport diagnostic");
    expect(html).toContain('data-state="offline"');
  });

  it("omits the storage summary when a recording pool is configured", () => {
    const html = render({ ...overview, policy: { ...overview.policy, storagePoolId: "recording-pool", directory: "Footage" } });
    expect(html).not.toContain("recording-pool / Footage");
    expect(html).not.toContain("Recording settings");
  });

  it("keeps removed cameras out of the device table", () => {
    const html = render({ ...overview, devices: overview.devices.map(device => ({ ...device, removedAt: "2026-11-15T01:00:00Z" })) });
    expect(html).not.toContain("Jetson Nano");
    expect(html).toContain("No cameras connected");
  });
});
