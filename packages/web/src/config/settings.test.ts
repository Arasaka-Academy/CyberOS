import { beforeAll, describe, expect, it } from "vitest";
import { i18n, initI18n } from "../i18n/index.js";
import {
  SETTINGS_SECTIONS,
  dockerSettingsToForm,
  modelSettingsToForm,
  settingsGroupLabel,
  settingsSectionState,
  vmSettingsToForm,
  type SettingsSection
} from "./settings.js";

beforeAll(async () => {
  await initI18n();
});

describe("settings helpers", () => {
  it("keeps all 25 sections once in the agreed task-oriented order", () => {
    const groups = [...new Set(SETTINGS_SECTIONS.map((section) => section.group))];
    expect(groups.map((group) => ({ group, sections: SETTINGS_SECTIONS.filter((section) => section.group === group).map((section) => section.id) }))).toEqual([
      { group: "general", sections: ["overview", "appearance", "system-profile", "version"] },
      { group: "network", sections: ["wireless", "bluetooth", "proxy", "tailscale"] },
      { group: "storage", sections: ["files", "indexer", "shares", "backup"] },
      { group: "media", sections: ["photos", "media", "downloads"] },
      { group: "ai", sections: ["model-providers", "pi-agent", "mcp", "skills", "audio"] },
      { group: "system", sections: ["docker", "virtual-machines", "monitoring", "alerts", "operations"] }
    ]);
    expect(SETTINGS_SECTIONS).toHaveLength(25);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(25);
  });

  it.each([
    { language: "en", labels: ["General", "Network & Connections", "Files & Data", "Media & Downloads", "AI & Voice", "System & Maintenance"] },
    { language: "zh-CN", labels: ["常规", "网络与连接", "文件与数据", "媒体与下载", "AI 与语音", "系统与维护"] }
  ])("localizes every task-oriented group in $language", async ({ language, labels }) => {
    await i18n.changeLanguage(language);
    const groups = [...new Set(SETTINGS_SECTIONS.map((section) => section.group))];
    expect(groups.map((group) => settingsGroupLabel(group, i18n.t.bind(i18n)))).toEqual(labels);
  });

  it("treats saved Docker settings as configured even when disabled", () => {
    const section: SettingsSection = {
      id: "docker",
      group: "system"
    };

    expect(settingsSectionState(section, null, null)).toBe("missing");
    expect(
      settingsSectionState(section, null, {
        enabled: false,
        updatedAt: "2026-01-01T00:00:00.000Z"
      })
    ).toBe("ready");
  });

  it("hydrates Docker form defaults from the runtime config", () => {
    expect(dockerSettingsToForm(null)).toMatchObject({
      enabled: false,
      updatedAt: new Date(0).toISOString()
    });
  });

  it("hydrates virtual machine settings independently from Docker", () => {
    expect(vmSettingsToForm(null)).toEqual({
      enabled: false,
      updatedAt: new Date(0).toISOString()
    });
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toContain("virtual-machines");
  });

  it("hydrates model provider form defaults without a display name", () => {
    expect(modelSettingsToForm(null)).toMatchObject({
      providerName: "openai",
      baseUrl: "",
      model: "",
      apiKey: "",
      clearApiKey: false
    });
  });

  it("reports the running version in the dedicated settings section", () => {
    const section: SettingsSection = {
      id: "version",
      group: "general"
    };
    const buildInfo = {
      version: "0.2.0",
      commitSha: "0123456789abcdef",
      commitShortSha: "0123456789ab",
      tag: "v0.2.0",
      branch: "main",
      builtAt: "2026-09-14T08:00:00.000Z",
      source: "release" as const,
      dirty: false,
      reproducible: false
    };
    expect(settingsSectionState(section, null, null, buildInfo)).toBe("ready");
    expect(settingsSectionState(section, null, null, null)).toBe("missing");
  });

  it("reflects photo library scan state in the settings navigation", () => {
    const section: SettingsSection = {
      id: "photos",
      group: "media"
    };
    const photoStatus = {
      state: "processing" as const,
      total: 24,
      failed: 0,
      scanned: 30,
      processed: 24,
      currentPath: "Photo/2026",
      phase: "processing" as const,
      error: null,
      errorCode: null,
      retryCount: 0,
      nextRetryAt: null,
      updatedAt: "2026-09-24T00:01:00.000Z"
    };
    expect(settingsSectionState(section, null, null, null, null, photoStatus)).toBe("loading");
    expect(settingsSectionState(section, null, null, null, null, {
      ...photoStatus,
      state: "unconfigured"
    })).toBe("missing");
  });

  it("does not expose the deleted security section", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).not.toContain("security");
  });

  it("keeps runtime details in Overview instead of exposing an Advanced section", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).not.toContain("advanced");
  });
});
