/**
 * [INPUT]: 依赖浏览器通知设置的状态与操作语义。
 * [OUTPUT]: 提供通知权限、订阅和三类 Agent 事件的中英文文案。
 * [POS]: 通知设置独立资源；不包含会话内容。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export const browserNotificationsEn = {
  conversationUnavailable: "The conversation for this notification is no longer available",
  sectionTitle: "Notifications", sectionDescription: "Browser push and Agent notification preferences.",
  browserTitle: "This browser", enable: "Enable browser notifications", browserHelp: "Applies only to this browser and this CyberOS address. Push can arrive after closing the page while the browser and system allow background notifications.",
  privacyHelp: "System notifications contain only a generic status. Conversation text, tool output and secrets are never included.",
  permission: "Browser permission", connection: "Push connection", enabled: "Connected", disabled: "Disabled", loading: "Checking", busy: "Updating",
  permissions: { default: "Not requested", granted: "Allowed", denied: "Blocked", unavailable: "Unavailable" },
  categoriesTitle: "Agent events", categoriesHelp: "Choose which Agent events this browser receives. Events already displayed in the active conversation are not pushed again.",
  replies: "Agent replies", actionRequired: "Approvals and input required", failures: "Execution failures",
  test: "Send test notification", testSent: "Test queued. Check your system notifications.", retry: "Retry", refresh: "Refresh status",
  deliveryFailed: "The last push failed. Send a test notification or reconnect this browser.",
  reasons: {
    insecure: "Open CyberOS over HTTPS or localhost to use browser notifications.",
    unsupported: "This browser does not support Web Push. Use a current desktop Chrome, Edge, Firefox or Safari.",
    unavailable: "Push delivery is unavailable on this CyberOS host. Retry after the service is ready.",
    denied: "Notifications are blocked. Allow notifications in this site's browser settings, then refresh status.",
    dismissed: "Permission was not granted. Click enable to try again.",
    storage: "Browser storage is unavailable. Allow site storage, then retry to save this browser's subscription.",
    subscription: "This browser's subscription needs to reconnect. Enable notifications again.",
    request: "Could not update browser notifications. Check the connection and retry."
  }
};
export const browserNotificationsZh = {
  conversationUnavailable: "通知对应的会话已删除或无法访问",
  sectionTitle: "通知", sectionDescription: "浏览器推送与 Agent 通知偏好。",
  browserTitle: "当前浏览器", enable: "启用浏览器通知", browserHelp: "仅对当前浏览器和 CyberOS 地址生效。浏览器与系统允许后台通知时，关闭页面后仍可接收推送。",
  privacyHelp: "系统通知只显示通用状态，不包含会话文字、工具输出或秘密信息。",
  permission: "浏览器权限", connection: "推送连接", enabled: "已连接", disabled: "已停用", loading: "检查中", busy: "更新中",
  permissions: { default: "未申请", granted: "已允许", denied: "已阻止", unavailable: "不可用" },
  categoriesTitle: "Agent 事件", categoriesHelp: "选择当前浏览器接收的 Agent 事件。当前会话已展示的事件不会再次推送。",
  replies: "Agent 回复", actionRequired: "审批与补充输入", failures: "执行失败",
  test: "发送测试通知", testSent: "测试已排队，请查看系统通知。", retry: "重试", refresh: "刷新状态",
  deliveryFailed: "上次推送失败，请发送测试通知或重新连接当前浏览器。",
  reasons: {
    insecure: "请通过 HTTPS 或 localhost 打开 CyberOS，再启用浏览器通知。",
    unsupported: "当前浏览器不支持 Web Push。请使用新版桌面 Chrome、Edge、Firefox 或 Safari。",
    unavailable: "当前 CyberOS 主机的推送服务不可用。服务就绪后请重试。",
    denied: "通知已被阻止。请在浏览器的网站设置中允许通知，再刷新状态。",
    dismissed: "尚未获得通知权限，请点击启用后重试。",
    storage: "浏览器存储不可用。请允许网站存储，再重试保存当前浏览器的订阅。",
    subscription: "当前浏览器的订阅需要重连，请重新启用通知。",
    request: "浏览器通知更新失败，请检查连接后重试。"
  }
};
