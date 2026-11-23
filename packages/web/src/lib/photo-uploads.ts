/**
 * [INPUT]: 依赖照片上传接口、媒体扩展名与统一错误转换。
 * [OUTPUT]: 提供逐文件上传快照与串行批次执行。
 * [POS]: 照片上传状态边界；媒体先于 XMP，单项失败不终止批次。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { PHOTOS_XMP_EXTENSION, photoExtension } from "@cyberos/shared/photos-config";
import { uploadPhoto } from "../api.js";
import { toErrorMessage } from "./format.js";

export interface PhotoUploadItem {
  id: number;
  name: string;
  sizeBytes: number;
  uploadedBytes: number;
  status: "queued" | "uploading" | "processing" | "completed" | "failed";
  error: string | null;
}

export async function uploadPhotoBatch(
  files: readonly File[],
  directory: string,
  onUpdate: (items: PhotoUploadItem[]) => void
): Promise<PhotoUploadItem[]> {
  let items: PhotoUploadItem[] = files.map((file, id) => ({
    id, name: file.name, sizeBytes: file.size, uploadedBytes: 0, status: "queued", error: null
  }));
  onUpdate(items);
  const update = (id: number, patch: Partial<PhotoUploadItem>) => {
    items = items.map((item) => item.id === id ? { ...item, ...patch } : item);
    onUpdate(items);
  };
  const ordered = files.map((file, id) => ({ file, id })).sort((left, right) =>
    Number(photoExtension(left.file.name) === PHOTOS_XMP_EXTENSION)
      - Number(photoExtension(right.file.name) === PHOTOS_XMP_EXTENSION));
  for (const { file, id } of ordered) {
    update(id, { status: "uploading" });
    try {
      await uploadPhoto(file, directory, (progress) => {
        const uploadedBytes = Math.min(file.size, Math.max(0, progress.loadedBytes));
        update(id, { uploadedBytes, status: uploadedBytes >= file.size ? "processing" : "uploading" });
      });
      update(id, { status: "completed", uploadedBytes: file.size });
    } catch (error) {
      update(id, { status: "failed", error: toErrorMessage(error) });
    }
  }
  return items;
}
