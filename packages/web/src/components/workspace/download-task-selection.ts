/**
 * [INPUT]: 依赖已加载任务 ID 与面板选择集合。
 * [OUTPUT]: 提供单项切换、选择校准和全选半选状态。
 * [POS]: 下载选择的纯状态边界；不依赖虚拟行挂载。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
type TaskId = { id: string };

export function toggleDownloadSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function retainDownloadSelection(selected: Set<string>, tasks: readonly TaskId[]): Set<string> {
  const loaded = new Set(tasks.map((task) => task.id));
  const next = new Set([...selected].filter((id) => loaded.has(id)));
  return next.size === selected.size ? selected : next;
}

export function loadedDownloadSelection(tasks: readonly TaskId[], selected: ReadonlySet<string>) {
  const ids = new Set(tasks.map((task) => task.id));
  const count = [...ids].filter((id) => selected.has(id)).length;
  return { ids, count, checked: ids.size > 0 && count === ids.size, indeterminate: count > 0 && count < ids.size };
}
