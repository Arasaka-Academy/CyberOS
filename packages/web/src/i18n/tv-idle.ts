/**
 * [INPUT]: 依赖 TV 设置、待机和音乐页面的翻译键。
 * [OUTPUT]: 提供 TV 新增功能的中英文文案。
 * [POS]: resources 的 TV 领域词表。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export const tvIdleEn = {
  title: "TV", description: "Local display, screensaver and screen power.",
  idle: "Idle display", source: "Screensaver source", builtin: "Built-in geometry", directory: "NAS image folder",
  chooseDirectory: "Choose image folder", folderMissing: "Choose a folder", pickerTitle: "Choose screensaver images",
  pickerDescription: "Images in this folder appear on the TV while idle.", pickerList: "Image folders", pickerEmpty: "No folders", useDirectory: "Use this folder",
  saverAfter: "Start screensaver after", offAfter: "Turn screen off after", never: "Never", minutes: "{{count}} minutes",
  invalidTimers: "Screen-off time must be later than screensaver time.",
  display: "Display", active: "Active", screensaver: "Screensaver", off: "Screen off", unsupported: "Display control unavailable",
  music: "Music", queue: "Play queue", close: "Close", mode: "Playback mode", clock: "Clock",
};
export const tvIdleZh = {
  title: "电视", description: "本机显示、屏保与息屏。",
  idle: "待机显示", source: "屏保来源", builtin: "内置几何", directory: "NAS 图片目录",
  chooseDirectory: "选择图片目录", folderMissing: "请选择目录", pickerTitle: "选择屏保图片",
  pickerDescription: "待机时在电视显示此目录的图片。", pickerList: "图片目录", pickerEmpty: "没有目录", useDirectory: "使用此目录",
  saverAfter: "屏保等待时间", offAfter: "息屏等待时间", never: "永不", minutes: "{{count}} 分钟",
  invalidTimers: "息屏时间必须晚于屏保时间。",
  display: "显示状态", active: "使用中", screensaver: "屏保", off: "已息屏", unsupported: "显示控制不可用",
  music: "音乐", queue: "播放队列", close: "关闭", mode: "播放模式", clock: "时钟",
};
