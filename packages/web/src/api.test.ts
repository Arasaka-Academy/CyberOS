/**
 * [INPUT]: 依赖 Web 请求接口与模拟浏览器传输。
 * [OUTPUT]: 验证请求契约、照片上传进度与错误传播。
 * [POS]: Web 请求边界的回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./api.js";
import { createTerminalTab, initializeTerminalTabs, type TerminalTabState } from "./api.js";

const terminalState: TerminalTabState = {
  initialized: true,
  tabs: [],
  activeTabId: null,
  maxSessions: 4
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("photo upload requests", () => {
  function request() {
    const xhr = {
      open: vi.fn(), setRequestHeader: vi.fn(), send: vi.fn(), abort: vi.fn(),
      responseType: "", status: 201, statusText: "", response: { path: "Photos/a.jpg", operation: {} },
      upload: { onprogress: null as null | ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) },
      onload: null as null | (() => void), onerror: null as null | (() => void), onabort: null as null | (() => void)
    };
    vi.stubGlobal("XMLHttpRequest", vi.fn(function () { return xhr; }));
    return xhr;
  }

  it("reports real byte progress and waits for the server response", async () => {
    const xhr = request();
    const progress = vi.fn();
    const file = new File(["1234"], "a.jpg");
    let settled = false;
    const result = api.uploadPhoto(file, "Photos/旅行", progress).then((value) => { settled = true; return value; });
    expect(xhr.open).toHaveBeenCalledWith("PUT", "/api/photos/upload?name=a.jpg&directory=Photos%2F%E6%97%85%E8%A1%8C");
    expect(xhr.send).toHaveBeenCalledWith(file);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("Content-Type", "application/octet-stream");
    xhr.upload.onprogress?.({ loaded: 4, total: 4, lengthComputable: true });
    await Promise.resolve();
    expect(progress).toHaveBeenCalledWith({ loadedBytes: 4, totalBytes: 4, lengthComputable: true });
    expect(settled).toBe(false);
    xhr.onload?.();
    await expect(result).resolves.toEqual(xhr.response);
  });

  it("preserves server errors and rejects network failures", async () => {
    const xhr = request();
    const failed = api.uploadPhoto(new File(["x"], "a.jpg"));
    xhr.status = 409;
    xhr.response = { error: "Photo library is still scanning" } as unknown as typeof xhr.response;
    xhr.onload?.();
    await expect(failed).rejects.toThrow("Photo library is still scanning");
    const network = request();
    const disconnected = api.uploadPhoto(new File(["x"], "a.jpg"));
    network.onerror?.();
    await expect(disconnected).rejects.toThrow("Upload failed");
  });

  it("keeps file uploads on the same byte-progress transport and supports cancellation", async () => {
    const xhr = request();
    const file = new File(["1234"], "a.jpg");
    const onProgress = vi.fn();
    const controller = new AbortController();
    const uploading = api.uploadFile({ storagePoolId: "pool", path: "Photos/a.jpg", file, onProgress, signal: controller.signal });
    expect(xhr.open).toHaveBeenCalledWith("PUT", "/api/files/upload?storagePoolId=pool&path=Photos%2Fa.jpg");
    xhr.upload.onprogress?.({ loaded: 2, total: 4, lengthComputable: true });
    expect(onProgress).toHaveBeenCalledWith({ loadedBytes: 2, totalBytes: 4, lengthComputable: true });
    controller.abort();
    expect(xhr.abort).toHaveBeenCalledOnce();
    xhr.onabort?.();
    await expect(uploading).rejects.toMatchObject({ name: "AbortError" });
    const cancelled = request();
    await expect(api.uploadFile({ storagePoolId: "pool", path: "a.jpg", file, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled.send).not.toHaveBeenCalled();
  });
});

describe("terminal tab requests", () => {
  it("initializes tabs without declaring an empty JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(terminalState));
    vi.stubGlobal("fetch", fetchMock);

    await expect(initializeTerminalTabs()).resolves.toEqual(terminalState);

    expect(fetchMock).toHaveBeenCalledWith("/api/terminal/tabs/initialize", { method: "POST" });
  });

  it("creates a tab without declaring an empty JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(terminalState));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createTerminalTab()).resolves.toEqual(terminalState);

    expect(fetchMock).toHaveBeenCalledWith("/api/terminal/tabs", { method: "POST" });
  });
});

describe("torrent download requests", () => {
  it("creates Magnet and uploaded torrent previews with the correct wire shapes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ preview: torrentPreview }))
      .mockResolvedValueOnce(jsonResponse({ preview: { ...torrentPreview, sourceKind: "torrent" } }));
    vi.stubGlobal("fetch", fetchMock);
    const createMagnetPreview = Reflect.get(api, "createMagnetPreview") as unknown;
    const uploadTorrentPreview = Reflect.get(api, "uploadTorrentPreview") as unknown;

    expect(createMagnetPreview).toBeTypeOf("function");
    expect(uploadTorrentPreview).toBeTypeOf("function");
    if (typeof createMagnetPreview !== "function" || typeof uploadTorrentPreview !== "function") return;

    await createMagnetPreview("magnet:?xt=urn:btih:0123456789012345678901234567890123456789");
    const file = new File(["torrent"], "release.torrent", { type: "application/x-bittorrent" });
    await uploadTorrentPreview(file);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/downloads/torrent-previews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ magnet: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789" })
    });
    const uploadRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/downloads/torrent-previews");
    expect(uploadRequest.method).toBe("POST");
    expect(uploadRequest.headers).toBeUndefined();
    expect(uploadRequest.body).toBeInstanceOf(FormData);
    expect((uploadRequest.body as FormData).get("torrent")).toBe(file);
  });

  it("creates a selected-file torrent task with bounded seeding defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ task: { id: "task-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const createTorrentDownload = Reflect.get(api, "createTorrentDownload") as unknown;

    expect(createTorrentDownload).toBeTypeOf("function");
    if (typeof createTorrentDownload !== "function") return;

    await createTorrentDownload({
      torrentPreviewId: "preview-1",
      selectedFileIndices: [0, 2],
      storagePoolId: "pool-1",
      targetDirectory: "Downloads",
      fileName: "release",
      seedRatioLimit: 1,
      seedTimeLimitSeconds: 7_200
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/downloads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        torrentPreviewId: "preview-1",
        selectedFileIndices: [0, 2],
        storagePoolId: "pool-1",
        targetDirectory: "Downloads",
        fileName: "release",
        seedRatioLimit: 1,
        seedTimeLimitSeconds: 7_200
      })
    });
  });
});

const torrentPreview = {
  id: "preview-1",
  sourceKind: "magnet",
  sourceUri: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
  status: "queued",
  infoHash: null,
  name: null,
  totalBytes: null,
  fileCount: 0,
  isPrivate: false,
  error: null,
  workerId: null,
  leaseExpiresAt: null,
  createdAt: "2026-10-29T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
  expiresAt: "2026-10-29T00:30:00.000Z",
  files: []
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" }
  });
}
