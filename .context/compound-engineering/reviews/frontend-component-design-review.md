# 前端组件与设计审查验收

状态：本轮设计审查、组件重构与设备静态资源部署完成。日期：2026-11-07（Asia/Shanghai）。

规范：`docs/src/content/docs/reference/frontend-design.md`。CyberUI v0.2.2 固定 commit `014c3b88ce25a874b12986ccc8f2499eb8dbad43`，来源、适配及许可证见 `packages/ui/UPSTREAM.md`。

工作树：`codex/cyberui-visual-rebuild`，基线 `470041f57ab9370ba54ce971fbc82633523b9c29`。以下功能与设备证据采集于提交前的 dirty=true 源码；原始 checkout 的用户改动未纳入。此前完整包部署与本轮组件重构的静态部署分别留证。用户于 2026-11-07 授权提交、合并 main 和推送，整合后的验证另行记录。

## 结构整改

| 原问题 | 最终呈现所有者与整改 | 状态 |
| --- | --- | --- |
| Button 从旧 class 推断角色，外部覆盖状态 | `Button.tsx`/`controls.css`；604 处 UiButton 显式 variant，182 处 iconOnly 有无障碍名称；生产 Web/TV TSX 无原生 button；保留原生事件、ref、submit、required、disabled。封面/导航用 ghost 保留业务布局 | 已完成 |
| label/help/error 与字段布局重复 | `Field`/`Input`/`Textarea`/`Checkbox`/`InputGroup`；228 处 Field 统一关联，合并原有 aria-describedby；CustomSelect 接入相同契约；代码编辑器、Composer、上传、提交式滑杆保留专用结构 | 已完成 |
| 设置区块重复套卡片、标题/操作错位 | `Section`/`SectionHeader`；69 处 Section、全宽纵向结构线和固定标题/说明/操作槽位；可编辑管理组件保留必要框架 | 已完成 |
| 反馈、空态、徽标重复 | `Notice`/`EmptyState`/`StatusBadge`；57 处 Notice、55 处 EmptyState；错误 danger、成功 success、确认/未配置 warning；后台状态不额外反复 alert | 已完成 |
| 弹窗标题、底栏、键值详情重复 | 58 处 DialogHeader、35 处 DialogActions、4 处 DescriptionList；复用 ModalPortal/useModalDialog；标题 ID、Escape、焦点仍由既有机制管理 | 已完成 |
| 规范中固定色/仅深色/无主题旧描述矛盾 | 统一七配色 × 明暗模式，明确组件所有者、InputGroup、移动设置标题唯一归属、Portal 视口断点、第三方 CSS 命名层 | 已完成 |

调用数为生产 Web/TV TSX 消费点，不是独立组件数。适配层位于 `packages/ui/src/`，不自动覆盖固定版本的 vendor 源码。

## 全前端完成矩阵

| 范围 | 完成内容 | 验证证据 |
| --- | --- | --- |
| 共享控件 | Button/IconButton、字段、输入附属操作、CustomSelect、Switch、tooltip、反馈/骨架；直角、焦点、busy、错误语义 | 样式浏览器 30/30，原生提交/必填/ref、标签/说明/错误、嵌套 Escape、长文案短视口 |
| 全部设置 | 25 分类：外观、模型、Pi Agent、MCP、Skills、Audio、网络/代理/Tailscale/蓝牙、Docker/VM/共享、运维/监控/告警/备份、文件/索引/照片/媒体/下载 | 25 × 中英文 × 5 宽度 = 250 记录；异步 Audio/蓝牙/媒体等补查数据就绪 |
| 管理页 | Docker/VM/网络/存储/共享/下载/监控的标题、列表、字段、详情、创建/确认；保留表格、可编辑组件及业务流程 | 真实 API 加载后巡检；字段/弹窗/下拉/创建流程检查；未执行设备破坏性操作 |
| 文件/预览/编辑器 | 命令、字段、选择器、工具栏、预览/编辑弹窗结构统一；保留审批、安全路径、目录异步状态 | 真实文件页中英文/5 宽度；共享模态/焦点浏览器检查及相关 Vitest |
| 照片 | 搜索槽位、筛选、墙面、地图、查看器、元数据、空态；修复 Portal 断点失效致手机图片 0 宽、MapLibre 无层级 CSS 致地图 0 高、筛选浮窗大面积命令色 | 设备 14 组交互：中英文 1440/390/320，查看器 Escape/焦点、嵌套菜单、混合搜索、日期空态、重置保留文本、地图 ready；回归检查先失败后通过 |
| 音乐/影视 | 搜索/筛选/导航、专辑/艺术家/歌单封面、影视海报/详情/选集、来源管理；保留媒体布局 | 真实 API 加载后中英文/5 宽度；music/video 巡检顺序、报告及截图已校正；播放/TV 测试 |
| Chat/语音/通知 | 会话操作、Composer、审批、语音/通知抽屉与反馈；保留草稿、滚动、生命周期 | Chat/语音/下载/照片 feature 浏览器合计 62/62；相关 Vitest、真实聊天上下文 |
| 播放/TV | 播放控制、输出/队列/弹层、TV 搜索/空态/外观；48px 目标、远距离字号、内容提交后恢复焦点 | TV 浏览器 62/62；设备原生主题命令 33 次成功；14 主题切换期间终端连接 1、关闭 0；切换后输入输出成功，播放器 session/state/path/volume 保持 |
| 手机 | 启动器、Dock、导航、全部 App/设置；104px 双层标题、44px 触控、历史栈/安全区；消除设置重复标题 | Mobile/appearance 30/30；真实 820/560/390/320 中英文及设备主屏 |
| Docs | 14 主题、字体/直角控件、Web 同源偏好、目录/正文/搜索/Mermaid | Docs 浏览器 19/19；42 页构建、链接/Pagefind 校验；设备 Mermaid/深浅模式 |

真实 API 矩阵最终 **370 记录、0 布局检查失败、0 页面异常、0 API HTTP 错误**：25 设置分类 + 12 业务面板，分别覆盖中英文和 1440/820/560/390/320px。检查页面溢出、字段关联、重复 ID、输入图标留白、Section 表面及移动重复标题。照片和管理组件补查等待真实骨架消失；未把骨架当内容验收。该矩阵与功能测试互补，不代表全部业务状态在设备逐项执行。

## 最终验证

证据目录 `.cyberos/component-review/`（生成证据不提交）：

| 检查 | 结果 | 文件 |
| --- | --- | --- |
| make ci | exit 0；260 个 Vitest 文件，1712 passed / 5 skipped；Rust/Python/协议/TS/Astro/fmt/clippy/ESLint/全部构建通过 | `make-ci-final.log` |
| 版本 | 2.3.5 通过 | `npm run version:check` |
| 组件样式 | 30/30 | `styles-browser-final.log` |
| Chat/语音/下载/照片 | 62/62 | `features-browser-final.log` |
| TV / Mobile / Docs | 62/62、30/30、19/19 | `tv-browser.log`、`mobile-browser-final.log`、`docs-browser.log` |
| 真实页面 | 370，补查后零失败/异常 | `review-final.json`、`matrix-supplement.log`、`matrix-management-loaded.log`、`matrix-settings-loaded.log` |
| 设备照片 | 14 组，零 pageErrors，两个语言地图均 ready | `photos-device-report.json`、`screenshots/photos-device/` |
| 设备主题/会话 | 14 主题、Web/Docs 同步、TV 独立持久化、终端/播放保持 | `device-browser-report.json`、`screenshots/device/` |
| 资源一致性 | 本地、设备、收据哈希一致 | `artifact-verification.json` |

## 设备交付

- 重新通过 Tailscale 发现 `CyberMachine`，管理员 `zhubby`，既有非交互 sudo。
- 最终部署 `dev-20261106164401532-39356`，组件 web,docs（含 TV）。备份/收据 `/cyberos/dev-deploy/dev-20261106164401532-39356`。中间部署 `dev-20261106163005417-29839` 已被替代。
- Web SHA-256：`39d4f1c5ecd8cb186741826bf878fa57946ea955f9052c2902a6609b27cc467a`；Docs：`41a4b0b7c4bcde5c496774a27e7e3c126948cf117bf8edab176efbf6ed03c004`。
- health/storage/readiness/Web/Docs 成功；API、worker、terminald、hostd、vod-player active、NRestarts=0；API/worker 检查区间无 error journal。未停止 API 或替换原生依赖。
- 主题/终端/播放通过真实 Nginx 域名检查；部分异步设置/照片补查通过本地 HTTP/2 代理读取同一设备静态文件与真实 API，规避下面的既有 HTTP/1.1 限制。设备 Nginx 配置未改。
- 临时终端 tab 及无害 printf 由脚本 finally 删除并恢复原 active tab；未执行媒体播放/暂停、存储写入或服务重配。

## 已记录边界

1. **既有 HTTP/1.1 SSE 同源连接限制仍在**。前序验收已有记录；本轮蓝牙页复现 4 条常驻 Web SSE + 2 条蓝牙 SSE 时初始 fetch 排队。直连设置 API 为 200，HTTP/2 补查加载完成。证据 `bluetooth-live-diagnostic.json`，待办 003；本轮未改写订阅生命周期。
2. **物理验收独立**：浏览器方向键/焦点和原生主题命令成功，不等于实体遥控、HDMI 观看距离或可听音频通过。
3. 设备根盘仍较满；未清理用户数据或已有备份，仅增加静态资源备份。
4. 上述设备证据对应提交前源码；合并和推送后的 Git 状态、验证与上游 CI 必须单独核实，不从设备测试推断。

## main 整合验收（2026-11-07）

- 重构提交：`e8946577`。整合远端 `main` 的 `6a0c24d500a8138df295bfd340b81122e3c95f8f`，保留基线之后全部 33 个后端修复；48 个传入后端/文档源码路径与该远端提交逐字节一致。
- 唯一合并冲突是依赖锁文件中的版本条目。新增 UI 包随项目统一版本；按 CI 版本策略从 `2.3.38` 推进到 `2.3.39`，相对原远端 main 的版本检查通过。
- 整合树完整 `make ci` exit 0：260 个 Vitest 文件，1754 passed / 5 skipped；协议、外观生成、TypeScript/Astro、Rust/Python、fmt/clippy、ESLint、所有构建及 42 页文档链接/Pagefind 检查通过。日志：`.cyberos/component-review/make-ci-main-integration-recheck.log`。
- 整合后浏览器复核：共享样式 30、TV 62、Mobile/appearance 30、Docs 19，共 141 项通过。日志：`browser-main-integration.log`、`mobile-browser-main-integration.log`、`docs-browser-main-integration.log`。
- 首次完整检查在既有 `terminald` 陈旧 socket 测试失败一次；单项及完整模块 30 次复跑全部通过，随后默认配置完整 `make ci` 通过。没有稳定复现或确认根因，没有为通过检查改动运行代码。首次失败与复跑日志分别保留，不能将这项记录描述为已修复。
- 原 main 工作树另有 15 个已跟踪文件改动与 8 个未跟踪文件，均已单独备份并核对哈希；它们不属于重构提交。主分支更新与恢复结果由交付时的 Git/哈希核验记录证明。
- 本节验证源码整合；前述设备仍对应已验收的提交前测试构建，不能据此声称设备已升级到 `2.3.39` 或上游 CI 已完成。
