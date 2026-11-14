import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NvrDevice } from "@cyberos/shared";
import { initI18n, i18n } from "../../i18n/index.js";
import { NvrCameraCard, NvrDeviceState } from "./NvrLive.js";
import { NvrPtz } from "./NvrPtz.js";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("en");
});

const device: NvrDevice = {
  id: "jetson", name: "Jetson Nano", onvifUrl: "http://camera/onvif/device_service",
  credentialsConfigured: true, profiles: [], recordingEnabled: false, recordingProfile: "raw", removedAt: null,
  connection: "disconnected", video: "unavailable", recording: "disabled", ptz: "unavailable",
  analytics: null, person: null, vehicle: null, lastError: "Camera connection unavailable", updatedAt: "2026-11-14T00:00:00Z"
};

describe("NVR camera presentation", () => {
  it("replaces the offline image and repeated errors with a single empty state and three summary facts", () => {
    const html = renderToStaticMarkup(createElement(NvrCameraCard, { device, paused: false, onOpen: vi.fn() }));
    expect(html).toContain("Camera offline");
    expect(html).toContain('data-state="offline"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain(device.lastError);
    expect(html.match(/<dt>/gu)).toHaveLength(3);
  });

  it("keeps a loading image hidden until a frame is decoded", () => {
    const html = renderToStaticMarkup(createElement(NvrCameraCard, {
      device: { ...device, connection: "connected", lastError: null }, paused: false, onOpen: vi.fn()
    }));
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('hidden=""');
    expect(html).not.toContain("Camera offline");
  });

  it("uses a paused placeholder without opening an image transport", () => {
    const html = renderToStaticMarkup(createElement(NvrCameraCard, {
      device: { ...device, connection: "connected" }, paused: true, onOpen: vi.fn()
    }));
    expect(html).toContain('data-state="paused"');
    expect(html).not.toContain("<img");
  });

  it("maps device statuses to shared semantic badge states", () => {
    const html = renderToStaticMarkup(createElement(NvrDeviceState, { device: { ...device, connection: "connected", ptz: "calibration_required" } }));
    expect(html).toContain("ui-description-list");
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('data-state="warning"');
    expect(html).not.toContain('data-state="connected"');
    expect(html).not.toContain('data-state="calibration_required"');
  });

  it("collapses offline PTZ controls but keeps an explicit stop command", () => {
    const html = renderToStaticMarkup(createElement(NvrPtz, { deviceId: device.id, connected: false, onFault: vi.fn() }));
    expect(html).toContain("Pan / tilt unavailable");
    expect(html).toContain(">Stop</button>");
    expect(html).not.toContain('aria-label="Pan right"');
    expect(html).not.toContain("<input");
  });
});
