/**
 * [INPUT]: 下载面板、受控多选任务行与创建选择器。
 * [OUTPUT]: 验证状态图标、选择语义、真实进度阶段和任务操作。
 * [POS]: 下载展示、多选控件与创建入口回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n, initI18n } from "../../i18n/index.js";
import type { DownloadTask } from "../../api.js";
import * as downloaderModule from "./HttpDownloaderPanel.js";
import {
  downloadCreateControlState,
  DownloadTaskRow,
  HttpDownloaderPanel,
  type HttpDownloaderPool
} from "./HttpDownloaderPanel.js";

const mountedPool: HttpDownloaderPool = {
  id: "pool-1",
  name: "Data",
  path: "/cyberos/data/data",
  filesystem: "ext4",
  status: "ready"
};

beforeAll(async () => {
  await initI18n();
});

describe("HttpDownloaderPanel download creation", () => {
  it("describes the unified public download queue without a dedicated connection state", () => {
    const html = renderDownloader({ storagePoolsLoading: false, pools: [mountedPool] });
    const header = html.match(/<header[^>]*class="management-header app-titlebar downloads-header"[^>]*>[\s\S]*?<\/header>/u)?.[0] ?? "";

    expect(header).toContain("<h2>Downloads</h2>");
    expect(header).not.toContain("Queue and monitor public web, Magnet, and torrent downloads.");
    expect(header).not.toContain("HTTP transfer");
    expect(header).not.toContain("downloads-connection");
    expect(html).not.toContain("downloads-connection");
  });

  it("renders the full initial skeleton and a stable busy creation control", () => {
    const html = renderDownloader({ storagePoolsLoading: false, pools: [mountedPool] });
    const button = renderDownloadButton({ storagePoolsLoading: false, pools: [mountedPool] });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="downloads-toolbar downloads-toolbar-skeleton"');
    expect(html).toContain('class="downloads-list downloads-list-skeleton"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('class="downloads-state"');
    expect(html).not.toContain("Unavailable");
    expect(button).toContain("disabled");
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain('aria-label="Loading"');
    expect(button).toContain('data-tooltip="Loading"');
    expect(button).toContain('data-state="loading"');
    expect(button).toContain("is-spinning");
    expect(visibleButtonText(button)).toBe("");
  });

  it("enables the correct creation behavior after the initial snapshot", () => {
    expect(downloadCreateControlState(true, false, true)).toBe("loading");
    expect(downloadCreateControlState(false, true, true)).toBe("loading");
    expect(downloadCreateControlState(false, false, false)).toBe("needs-storage");
    expect(downloadCreateControlState(false, false, true)).toBe("ready");
  });
});

describe("DownloadTaskRow progress states", () => {
  it("exposes a determinate progressbar with the current percentage", () => {
    const html = renderDownloadRow({ receivedBytes: 25, totalBytes: 100 });

    expect(html).toContain('class="download-task-row" data-status="running"');
    expect(html).toContain('class="download-progress-track" role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain('style="width:25%"');
  });

  it("uses an indeterminate progress state when a running task has no total", () => {
    const html = renderDownloadRow({ receivedBytes: 2_000, totalBytes: null });

    expect(html).toContain('class="download-progress-track is-indeterminate"');
    expect(html).toContain('data-indeterminate="true"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain('style="width:36%"');
  });

  it("shows completed tasks as full even when the server has no total", () => {
    const html = renderDownloadRow({ status: "completed", receivedBytes: 2_000, totalBytes: null });

    expect(html).toContain('class="download-task-row" data-status="completed"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('style="width:100%"');
  });

  it("keeps a distinct status marker for every download state", () => {
    for (const status of ["queued", "running", "paused", "seeding", "completed", "failed", "cancelled"] as const) {
      expect(renderDownloadRow({ status })).toContain(`data-status="${status}"`);
    }
  });

  it("keeps confirmed progress while verifying and hides transfer estimates", () => {
    const html = renderDownloadRow({ phase: "verifying", receivedBytes: 50, totalBytes: 100, speedBytesPerSecond: 20 });
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain("Verifying");
    expect(html).not.toContain("20 B/s");
    expect(html).not.toContain("ETA unknown");
    expect(html).not.toContain("is-indeterminate");
  });
  it.each([
    ["queued", "Queued", "clock-3"],
    ["running", "Downloading", "arrow-down-to-line"],
    ["paused", "Paused", "circle-pause"],
    ["seeding", "Seeding", "upload"],
    ["completed", "Completed", "circle-check"],
    ["failed", "Failed", "circle-alert"],
    ["cancelled", "Cancelled", "circle-x"]
  ] as const)("uses a focusable accessible %s icon instead of a text badge", (status, label, icon) => {
    const html = renderDownloadRow({ status });
    expect(html).toContain('class="download-task-status is-icon" role="img"');
    const marker = html.match(/<span class="download-task-status is-icon"[^>]*>[\s\S]*?<\/span>/u)?.[0] ?? "";
    expect(marker).toContain('tabindex="0"');
    expect(marker).toContain(`aria-label="${label}"`);
    expect(marker).toContain(`data-tooltip="${label}"`);
    expect(marker).toContain(`lucide-${icon}`);
    expect(marker).not.toContain(`>${label}<`);
    expect(html).not.toContain(`class="download-task-status">`);
  });
  it.each(["paused", "completed", "failed"] as const)("hides stale speed and ETA for %s tasks", (status) => {
    const html = renderDownloadRow({ status, speedBytesPerSecond: 20 });
    expect(html).not.toContain("20 B/s");
    expect(html).not.toContain("ETA unknown");
  });

  it("shows torrent upload telemetry and seeding controls", () => {
    const html = renderDownloadRow({
      sourceKind: "magnet",
      status: "seeding",
      downloadMode: "torrent",
      phase: "seeding",
      receivedBytes: 100,
      totalBytes: 100,
      uploadedBytes: 50,
      uploadSpeedBytesPerSecond: 10,
      peerCount: 4,
      torrentName: "Linux release",
      url: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789"
    });

    expect(html).not.toContain("Linux release");
    expect(html).toContain("50 B uploaded");
    expect(html).toContain("10 B/s upload");
    expect(html).toContain("4 peers");
    expect(html).toContain("Ratio 0.50");
    expect(html).toContain('aria-label="Pause seeding"');
    expect(html).toContain('aria-label="Stop seeding"');
    expect(html).not.toContain('aria-label="Cancel download"');
  });

  it("shows segmented, retry, control, checksum, and stable error details", () => {
    const retryAt = new Date(Date.now() + 30_000).toISOString();
    const html = renderDownloadRow({
      status: "queued",
      phase: "retry_wait",
      downloadMode: "segmented",
      segmentCount: 4,
      retryCount: 2,
      nextRetryAt: retryAt,
      controlRequested: "pause",
      expectedSha256: "a".repeat(64),
      actualSha256: "b".repeat(64),
      errorCode: "checksum_mismatch",
      error: "SHA-256 mismatch"
    });

    expect(html).toContain("Segmented");
    expect(html).toContain("Waiting to retry");
    expect(html).toContain("4 segments");
    expect(html).toContain("Pausing");
    expect(html).toContain("Retry 2 in");
    expect(html).toContain("SHA-256 mismatch");
    expect(html).toContain("Checksum mismatch");
  });
});

describe("DownloadTaskRow selection and deletion", () => {
  it("renders a named native checkbox and a controlled selected row", () => {
    const html = renderDownloadRow({}, { selected: true, selectionMode: true });
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('data-selection-mode="true"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain('class="ui-checkbox"');
    expect(html).not.toContain('aria-selected="true"');
  });

  it("renders an unchecked row without a selected surface marker", () => {
    const html = renderDownloadRow();
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('data-selected="true"');
    expect(html).not.toContain('checked=""');
  });

  it.each(["queued", "running", "paused", "seeding", "completed", "failed", "cancelled"] as const)("offers deletion for a %s task", (status) => {
    expect(renderDownloadRow({ status })).toContain(`aria-label="${i18n.t("workspace.downloads.remove")}"`);
  });

  it("disables selection and mutation controls throughout a batch", () => {
    const html = renderDownloadRow({ status: "seeding" }, { selectionBusy: true });
    expect(html.match(/<input[^>]*disabled=""[^>]*type="checkbox"/u)).not.toBeNull();
    for (const label of ["Pause seeding", "Stop seeding", i18n.t("workspace.downloads.remove")]) {
      expect(html).toMatch(new RegExp(`<button[^>]*aria-label="${label}"[^>]*disabled=""`, "u"));
    }
    expect(html).not.toMatch(/<button[^>]*aria-label="Open target directory"[^>]*disabled/u);
  });

  it("disables other task mutations while a global action is pending", () => {
    const html = renderDownloadRow({}, { pendingAction: "pause:other-task" });
    expect(html).toMatch(/<button[^>]*aria-label="Pause download"[^>]*disabled=""/u);
    expect(html).toMatch(new RegExp(`<button[^>]*aria-label="${i18n.t("workspace.downloads.remove")}"[^>]*disabled=""`, "u"));
    expect(html).not.toContain('aria-busy="true"');
  });
});

describe("DownloadTaskRow target directory", () => {
  it.each(["queued", "running", "paused", "failed", "cancelled"] as const)(
    "hides the directory action before a %s task has published its files",
    (status) => {
      expect(renderDownloadRow({ status })).not.toContain('aria-label="Open target directory"');
    }
  );

  it.each(["verifying", "publishing"] as const)(
    "keeps the directory action hidden at 100 percent during %s",
    (phase) => {
      expect(renderDownloadRow({ phase, receivedBytes: 100, totalBytes: 100 }))
        .not.toContain('aria-label="Open target directory"');
    }
  );

  it.each(["completed", "seeding"] as const)("opens the directory after %s", (status) => {
    expect(renderDownloadRow({ status })).toContain('aria-label="Open target directory"');
  });

  it("keeps published torrent files accessible when seeding is paused", () => {
    expect(renderDownloadRow({
      sourceKind: "magnet",
      status: "paused",
      contentCompletedAt: "2026-09-24T00:01:00.000Z"
    })).toContain('aria-label="Open target directory"');
  });
});

describe("Torrent file selection", () => {
  it("renders stable checkboxes, selected totals, and select-all state", () => {
    const TorrentFileSelector = downloaderModule.TorrentFileSelector;
    expect(TorrentFileSelector).toBeTypeOf("function");

    const html = renderToStaticMarkup(createElement(TorrentFileSelector, {
      files: [
        { fileIndex: 0, path: "release/system.img", sizeBytes: 1_024 },
        { fileIndex: 1, path: "release/checksums.txt", sizeBytes: 128 }
      ],
      selectedFileIndices: [0],
      locale: "en",
      disabled: false,
      onChange: vi.fn()
    }));

    expect(html).toContain('aria-label="Torrent files"');
    expect(html).toContain("1 of 2 selected");
    expect(html).toContain("1.0 KB selected");
    expect(html).toContain("release/system.img");
    expect(html).toContain("release/checksums.txt");
    expect(html.match(/type="checkbox"/gu)).toHaveLength(3);
    expect(html.match(/checked=""/gu)).toHaveLength(1);
  });
});

function renderDownloadButton({
  storagePoolsLoading,
  pools
}: {
  storagePoolsLoading: boolean;
  pools: HttpDownloaderPool[];
}): string {
  const html = renderDownloader({ storagePoolsLoading, pools });
  const button = html.match(/<button[^>]*class="[^"]*\bpanel-header-action download-create-button\b[^"]*"[^>]*>[\s\S]*?<\/button>/u)?.[0];
  expect(button).toBeDefined();
  return button ?? "";
}

function renderDownloader({
  storagePoolsLoading,
  pools
}: {
  storagePoolsLoading: boolean;
  pools: HttpDownloaderPool[];
}): string {
  return renderToStaticMarkup(createElement(HttpDownloaderPanel, {
    pools,
    storagePoolsLoading,
    selectedStoragePoolId: pools[0]?.id ?? "",
    locale: "en",
    onSelectStoragePool: vi.fn(),
    onOpenDirectory: vi.fn(),
    onOpenStorage: vi.fn(),
    onNotifyError: vi.fn(),
    onNotifySuccess: vi.fn(),
    onNotifyWarning: vi.fn()
  }));
}

function visibleButtonText(button: string): string {
  return button.replace(/<[^>]+>/gu, "").trim();
}

const baseTask: DownloadTask = {
  id: "task-1",
  url: "https://example.com/archive.zip",
    storagePoolId: "pool-1",
  targetDirectory: "/cyberos/data/data",
  targetFileName: "archive.zip",
  targetPath: "/cyberos/data/data/archive.zip",
  partialPath: "/cyberos/data/data/.task-1.cyberos-download.part",
  status: "running",
  receivedBytes: 25,
  totalBytes: 100,
  speedBytesPerSecond: 10,
  etag: null,
  lastModified: null,
  error: null,
  workerId: "worker-1",
  leaseExpiresAt: null,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
  startedAt: "2026-09-24T00:00:00.000Z",
  finishedAt: null,
  lastProgressAt: "2026-09-24T00:00:00.000Z",
  fileOperationId: null,
  phase: "downloading",
  downloadMode: "single",
  expectedSha256: null,
  actualSha256: null,
  errorCode: null,
  errorRetryable: false,
  retryCount: 0,
  nextRetryAt: null,
  controlRequested: null,
  segmentCount: 0,
  sourceKind: "http",
  torrentInfoHash: null,
  torrentName: null,
  selectedFileCount: 0,
  uploadedBytes: 0,
  uploadSpeedBytesPerSecond: 0,
  peerCount: 0,
  seedRatioLimit: 1,
  seedTimeLimitSeconds: 7_200,
  contentCompletedAt: null,
  seedStartedAt: null
};

function renderDownloadRow(overrides: Partial<DownloadTask> = {}, controls: { selected?: boolean; selectionMode?: boolean; selectionBusy?: boolean; pendingAction?: string | null } = {}): string {
  return renderToStaticMarkup(createElement(DownloadTaskRow, {
    task: { ...baseTask, ...overrides },
    locale: "en",
    pendingAction: null,
    selected: false,
    selectionMode: false,
    selectionBusy: false,
    ...controls,
    onToggleSelection: vi.fn(),
    onAction: vi.fn(),
    onDelete: vi.fn(),
    onOpenDirectory: vi.fn()
  }));
}
