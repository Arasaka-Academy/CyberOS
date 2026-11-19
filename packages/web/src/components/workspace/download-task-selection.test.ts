/**
 * [INPUT]: 下载选择和批次删除纯状态边界。
 * [OUTPUT]: 验证加载快照、选择校准、串行执行及部分失败。
 * [POS]: 下载多选与删除的数据行为回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { describe, expect, it } from "vitest";
import { deleteDownloadBatch } from "./download-task-deletion.js";
import { loadedDownloadSelection, retainDownloadSelection, toggleDownloadSelection } from "./download-task-selection.js";

describe("loaded download selection", () => {
  it("selects IDs once and does not select later pages or newly arrived tasks", () => {
    const selected = loadedDownloadSelection([{ id: "a" }, { id: "a" }], new Set()).ids;
    expect([...selected]).toEqual(["a"]);
    expect(loadedDownloadSelection([{ id: "a" }, { id: "b" }], selected)).toMatchObject({ count: 1, checked: false, indeterminate: true });
    expect([...toggleDownloadSelection(selected, "a")]).toEqual([]);
    expect([...selected]).toEqual(["a"]);
  });
  it("retains the same selection through scrolling and removes tasks that leave the filter", () => {
    const selected = new Set(["a", "b"]);
    expect(retainDownloadSelection(selected, [{ id: "b" }, { id: "a" }])).toBe(selected);
    expect([...retainDownloadSelection(selected, [{ id: "b" }])]).toEqual(["b"]);
    expect(loadedDownloadSelection([], new Set())).toMatchObject({ checked: false, indeterminate: false, count: 0 });
  });
});

describe("download deletion batch", () => {
  it("runs one request at a time, deduplicates targets, and continues after a failure", async () => {
    let active = 0;
    const calls: string[] = [];
    const progress: number[] = [];
    const targets = ["a", "b", "a", "c"].map((id) => ({ id, targetFileName: id }));
    const result = await deleteDownloadBatch(targets, async (task) => {
      expect(active++).toBe(0);
      calls.push(task.id);
      await Promise.resolve();
      active--;
      if (task.id === "b") throw new Error("Stop could not be confirmed");
    }, (value) => progress.push(value.completed));
    expect(calls).toEqual(["a", "b", "c"]);
    expect(result.deletedIds).toEqual(["a", "c"]);
    expect(result.failures).toEqual([{ task: { id: "b", targetFileName: "b" }, message: "Stop could not be confirmed" }]);
    expect(progress).toEqual([0, 1, 1, 2, 2, 3]);
  });
});
