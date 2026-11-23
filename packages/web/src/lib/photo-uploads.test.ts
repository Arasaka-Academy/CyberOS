/**
 * [INPUT]: 依赖照片上传队列与模拟传输接口。
 * [OUTPUT]: 验证逐文件状态、XMP 顺序和部分失败。
 * [POS]: 照片上传队列的行为回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { describe, expect, it, vi } from "vitest";
import { uploadPhoto } from "../api.js";
import { uploadPhotoBatch, type PhotoUploadItem } from "./photo-uploads.js";

vi.mock("../api.js", () => ({ uploadPhoto: vi.fn() }));

describe("photo upload queue", () => {
  it("lists all files, uploads media before XMP, and continues after failures", async () => {
    const snapshots: PhotoUploadItem[][] = [];
    const files = [new File(["xx"], "same.xmp"), new File(["1234"], "same.jpg"), new File(["x"], "broken.jpg"), new File(["xx"], "same.jpg")];
    vi.mocked(uploadPhoto).mockImplementation(async (file, directory, onProgress) => {
      expect(directory).toBe("Photos");
      if (file.name === "broken.jpg") throw new Error("Disk full");
      onProgress?.({ loadedBytes: file.size / 2, totalBytes: file.size, lengthComputable: true });
      onProgress?.({ loadedBytes: file.size, totalBytes: file.size, lengthComputable: true });
      expect(snapshots.at(-1)?.find((item) => item.id === files.indexOf(file))?.status).toBe("processing");
      return { path: file.name, operation: {} } as Awaited<ReturnType<typeof uploadPhoto>>;
    });
    const result = await uploadPhotoBatch(files, "Photos", (items) => snapshots.push(items));
    expect(snapshots[0]?.map((item) => item.status)).toEqual(["queued", "queued", "queued", "queued"]);
    expect(vi.mocked(uploadPhoto).mock.calls.map(([file]) => file.name)).toEqual(["same.jpg", "broken.jpg", "same.jpg", "same.xmp"]);
    expect(snapshots.some((items) => items[1]?.uploadedBytes === 2 && items[1].status === "uploading")).toBe(true);
    expect(result.map((item) => item.status)).toEqual(["completed", "completed", "failed", "completed"]);
    expect(result[2]?.error).toBe("Disk full");
    expect(new Set(result.map((item) => item.id)).size).toBe(4);
    expect(snapshots[0]?.every((item) => item.uploadedBytes === 0)).toBe(true);
  });
});
