/**
 * [INPUT]: 依赖 TV 设置、待机和音乐页面的翻译键。
 * [OUTPUT]: 提供 TV 新增功能的中英文文案。
 * [POS]: resources 的 TV 领域词表。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export const tvIdleEn = {
  title: "TV", description: "Local display, screensaver and screen power.",
  idle: "Idle display", source: "Screensaver source", builtin: "Built-in geometry", directory: "NAS image folder",
  videoDirectory: "NAS video folder", chooseDirectory: "Choose folder", folderMissing: "Choose a folder", pickerTitle: "Choose screensaver folder",
  pickerDescription: "Use this folder and its subfolders for the selected screensaver type.", pickerList: "Folders", pickerEmpty: "No folders", useDirectory: "Use this folder",
  saverAfter: "Start screensaver after", offAfter: "Turn screen off after", never: "Never", minutes: "{{count}} minutes",
  screensaverEnabled: "Screensaver", screenOffEnabled: "Screen off", automatic: "Automatic", systemDefault: "System default",
  connected: "Connected", disconnected: "Disconnected", notDetected: "Not detected", refreshOutputs: "Refresh devices",
  drmUnavailable: "Display device list unavailable", audioUnavailable: "Audio device list unavailable",
  applyOutput: "Apply and restart TV", applyOutputConfirm: "Restart the TV display using the saved output? End any media session before applying. If startup fails, the previous output is restored.",
  audioHelp: "Used for the next local TV movie or music session. Explicit Bluetooth output takes priority.",
  drmHelp: "Save first, then apply and restart TV. Automatic uses the existing HDMI selection policy.",
  videoHelp: "MP4/WebM videos play silently in sequence. Unsupported files are skipped.",
  outputApplied: "TV output applied", outputPending: "The saved display output has not been applied.", saveOutputFirst: "Save the display output before applying.",
  invalidTimers: "Screen-off time must be later than screensaver time.",
  display: "Display", active: "Active", screensaver: "Screensaver", off: "Screen off", unsupported: "Display control unavailable",
  music: "Music", queue: "Play queue", close: "Close", mode: "Playback mode", clock: "Clock",
};
export const tvIdleZh = {
  title: "电视", description: "本机显示、屏保与熄屏。",
  idle: "待机显示", source: "屏保来源", builtin: "内置几何", directory: "NAS 图片目录",
  videoDirectory: "NAS 视频目录", chooseDirectory: "选择目录", folderMissing: "请选择目录", pickerTitle: "选择屏保目录",
  pickerDescription: "使用此目录及其子目录中的对应类型素材。", pickerList: "目录", pickerEmpty: "没有目录", useDirectory: "使用此目录",
  saverAfter: "屏保等待时间", offAfter: "熄屏等待时间", never: "永不", minutes: "{{count}} 分钟",
  screensaverEnabled: "屏保", screenOffEnabled: "熄屏", automatic: "自动", systemDefault: "系统默认",
  connected: "已连接", disconnected: "未连接", notDetected: "未检测到", refreshOutputs: "刷新设备",
  drmUnavailable: "无法读取显示设备列表", audioUnavailable: "无法读取音频设备列表",
  applyOutput: "应用并重启 TV", applyOutputConfirm: "使用已保存的输出重启 TV 显示？请先结束媒体播放会话。启动失败时恢复之前的输出。",
  audioHelp: "下次本地 TV 影视或音乐播放时生效。显式选择的蓝牙输出优先。",
  drmHelp: "先保存，再应用并重启 TV。自动模式沿用现有 HDMI 选择策略。",
  videoHelp: "MP4/WebM 视频按顺序静音播放，不兼容的文件会被跳过。",
  outputApplied: "TV 输出已应用", outputPending: "已保存的显示输出尚未应用。", saveOutputFirst: "请先保存显示输出，再应用。",
  invalidTimers: "熄屏时间必须晚于屏保时间。",
  display: "显示状态", active: "使用中", screensaver: "屏保", off: "已熄屏", unsupported: "显示控制不可用",
  music: "音乐", queue: "播放队列", close: "关闭", mode: "播放模式", clock: "时钟",
};
