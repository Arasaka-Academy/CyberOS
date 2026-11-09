---
title: 前端样式维护清单
description: Web 与 TV 的样式模块归属、公共控件复用和回归验证入口。
type: reference
status: current
audience: [developer]
sourceOfTruth:
  - packages/shared/src/appearance.ts
  - packages/ui/UPSTREAM.md
  - packages/ui/src/Card.tsx
  - packages/ui/src/cards.css
  - packages/web/src/styles/components/cards.css
  - packages/web/src/styles/components/card-details.css
  - packages/web/src/tv/styles/cards.css
  - scripts/test-card-surfaces.mjs
  - packages/web/src/styles/cyberui.css
  - packages/web/src/styles.css
  - packages/web/src/styles/workspace.css
  - packages/web/src/styles/settings.css
  - packages/web/src/styles/brand.css
  - packages/web/src/styles/hud-workspaces.css
  - packages/web/src/styles/responsive.css
  - packages/web/src/styles/architecture.test.ts
  - packages/web/src/components/common/CustomSelect.tsx
  - packages/web/src/styles/components/create-form.css
  - packages/web/src/tv/tv.css
  - scripts/test-web-styles.mjs
  - eslint.config.js
sidebar:
  order: 3
---

遵循[前端设计语言](/docs/reference/frontend-design/)。CyberUI 源码固定在 `packages/ui/src/vendor/`，保留许可证与 `UPSTREAM.md`。应用使用显式 variant 和原生事件的共享 `Button`，主题选择器直接使用 CyberUI Button；下拉、开关和模态保留现有交互契约。主题样式与宿主样式分层导入，不将 Tailwind 前缀传播到宿主工具类。

以下文件是兼容聚合入口，新增规则进入所属模块，不继续堆叠在入口末尾。

## 文件归属

| 聚合入口 | 规则归属 |
| --- | --- |
| `@cyberos/ui` | `Button`、`Field`、`InputGroup`、`Section`、`DescriptionList`、`Notice`、`EmptyState`、`StatusBadge`、`DialogHeader` 和 `DialogActions` 的结构和组件样式；由 `controls.css`、`sections.css`、`feedback.css`、`dialog.css` 维护。 |
| 卡片 | `@cyberos/ui` 导出的 `Card`、`CardHeader` 与 `cards.css` 定义 soft/frame；Web 的 `components/cards.css` 与 `card-details.css` 只适配业务家族，TV 的 `styles/cards.css` 适配远距焦点，文档的 `content.css` 适配 Starlight。 |
| `styles/cyberui.css` | 应用外壳与旧组件的主题映射；禁止推测按钮角色或重复定义共享控件状态。 |
| `@cyberos/shared/appearance.css` | 14 种主题的生成令牌；通过 `appearance.ts` 和生成脚本修改。 |
| `workspace.css` | `files/`、`downloads/`、`network/`、`storage/`、`docker/`、`shares/`、`terminal/`、`management/`，共享创建流程在 `components/create-form.css`。 |
| `settings.css` | `settings/` 下的外壳、分类布局、操作、资源、设备和蓝牙；公共字段视觉归 `@cyberos/ui`，`components/forms.css` 保留旧选择器兼容。 |
| `brand.css` | `foundation/` 的字体、画布和动效；公共控件归 `components/`，业务主题规则归所属模块。 |
| `hud-workspaces.css` | `chat/`、`files/`、`workspace/` 的最终布局及交互细节；共享 HUD 别名在 `foundation/hud-aliases.css`。 |
| `responsive.css` | 只导入各模块的响应式规则，应用骨架在 `foundation/responsive.css`；文件选择器和创建流程各有公共响应文件。 |
| `chat.css` | 导航、会话操作、弹窗、加载、消息、审批和输入区。 |
| `photos.css` | 媒体库、筛选、地图、时间轴、查看器和元数据。 |
| `monitoring-alerts.css` | 告警列表、规则编辑、事件详情和设置。 |
| `tv/tv.css` | `tv/styles/` 的导入、基础尺度、外壳、媒体、遥控和浮层；按钮、表单、下拉、反馈复用 Web 公共文件。 |

模块文件以 200–600 行为维护目标。小型、独立的公共职责可以更短，超过 800 行的文件必须继续拆分。聚合入口不包含声明，不使用编号文件名维持历史顺序。

## 整改与复用清单

| 优先级 | 已处理问题 | 公共归属及约束 |
| --- | --- | --- |
| P1 | 音乐页面覆盖所有按钮，尺寸和禁用/忙碌状态偏离公共控件。 | `@cyberos/ui/Button.tsx` 与 `controls.css` 统一命令与轻量操作；紧凑尺寸显式选择，业务不重置全部按钮。Docker、存储及文件选择器的底部命令也使用显式 variant 的公共按钮，删除局部透明度和颜色覆盖。 |
| P1 | 7 个未定义变量、16 处无回退引用。 | 改用现有边框、焦点、警告、成功和表面语义变量；Web/TV 完整解析入口均有自动检查。 |
| P1 | Web 黄色菜单与 TV 灰蓝菜单不一致，TV 缺少共享变量。 | 共用 `foundation/tokens.css` 和 `select.css`，筛选容器不覆盖控件尺度，保留 TV 的遥控热区及焦点环；照片、网络工具栏与播放栏显式选择公共紧凑尺寸。 |
| P2 | 11 个组件的 47 处原生下拉框。 | 迁移到 `CustomSelect`，保留数值转换、条件选项、禁用、必填和焦点引用；ESLint 对全部 Web TSX 禁止原生下拉。 |
| P2 | 音乐导航选中态与公共页签不一致。 | 复用 `view-tabs` 外观，导航继续使用 `aria-current`。 |
| P2 | 播放栏收起和 TV 音频输出按钮仍使用浏览器默认灰底。 | 复用 `plain-button` 的透明表面与公共状态，保留播放栏的触控及遥控尺寸。 |
| P2 | TV 搜索入口借用输入框容器类，图标和文字重叠。 | 复用公共按钮和现有 TV 搜索行布局，移除仅适用输入框的 `search` 类。 |
| P2 | 弹窗重复定义遮罩、表面、滚动与操作区。 | `modal.css` 提供公共规则，沿用 `ModalPortal` 与焦点管理；Docker/VM 创建流程复用同一模态焦点机制。图标操作复用公共透明表面，Docker 配置弹窗不再覆盖圆角和字段焦点；公共字段同时悬停和聚焦时保持青色焦点边框。 |
| P2 | Docker 借用 `vm-create-*`。 | 统一为 `create-form-*`，共享样式独立于 VM 业务模块。 |
| P2 | 状态、空状态、错误和元数据散落。 | 状态、错误和空状态复用 `@cyberos/ui` 的显式组件，元数据和兼容选择器保留在 `components/`；音乐、影视和文件选择器复用元数据外观。 |
| P2 | 业务、品牌和 HUD 层反复覆盖。 | 首轮纯拆分确认声明顺序等价；随后清除在所有消费入口均被后续同一规则覆盖的 137 条历史声明，统一调整由浏览器回归覆盖。 |

继续复用 `PanelHeader`、`MobileAppHeader`、`Switch`、`SearchFilterPopover`、`HelpTip`、`TooltipLayer` 和公共骨架。保留媒体海报、文件列表、终端和 TV 的业务布局与操作尺度。

## 卡片家族全量检查清单

卡片、独立工具和开放区块的具体尺度见[视觉契约](/docs/reference/frontend-design/#cardpanel-与-section-的视觉契约)。新增家族必须显式选择其中一种，不能在深色皮肤中追加通用 card 覆盖。

| 家族与入口 | 分类与视觉归属 | 保留的业务特征 |
| --- | --- | --- |
| Docker、VM、网络、存储、共享、监控 Dashboard | 拖拽外框为 frame，内部 Section 与资源记录开放，独立指标为 soft；`components/cards.css` | 布局持久化、键盘调整、内部滚动、骨架及状态图标。 |
| Docker 容器、镜像、网络、卷与 VM 详情/Compose | 详情分组开放，资源摘要 soft，IPAM/注册表/容器记录用分隔线；`card-details.css` | 表格、版本、日志、控制台、创建及删除确认。 |
| 网卡、Ethernet/Wi-Fi、流量详情 | 连接摘要 soft，地址事实与路由/资源为开放记录；`card-details.css` | 网络事务确认、草稿、扫描、连接和回退边界。 |
| 存储池、磁盘、SMART 与 iSCSI | 容量摘要 soft，详情及成员分组开放，磁盘选择保持选择语义；`card-details.css` | 健康图表、容量比例、危险确认、单一 Dashboard 外框。 |
| Share 服务与协议 | Section、DescriptionList 与开放列表，最外层 frame；`shares/` | 协议分组、编辑与删除弹窗、权限和焦点恢复。 |
| NVR 概览、摄像机、设备、录像与事件 | soft；`Card` 与 `nvr.css` | 16:9 预览、4 路上限、全宽概览/表单、PTZ 停止与播放器生命周期。 |
| NVR 筛选、策略与添加表单 | Section，透明底与分隔线 | 双列字段及窄容器单列、不新增嵌套卡片。 |
| Agent 审批 | frame，详情事实开放；`components/cards.css` | 风险文字、预览、允许/拒绝与审批边界；普通聊天消息保持开放。 |
| 设置概览、版本/身份、服务、策略、设备与资源 | Section，只有独立统计 soft；`sections.css`、`settings/` | 所有分类、嵌套编辑、加载、错误、保存、焦点和草稿。 |
| 影视海报与音乐专辑 | soft，图片区域结构线；`components/cards.css` | 2:3/1:1 图片、长标题省略、进度与收藏入口；曲目/艺术家/播放列表仍是记录。 |
| 照片时间轴与选择 | soft，选中主强调色内轨，焦点独立外环 | 相片比例、顺序、分页、选择与打开；地图和查看器保留专用框架。 |
| 下载、通知、告警、操作/传输记录 | 开放列表；未读用主强调色轨，无卡片投影 | 进度、状态、取消、筛选、阅读与通知生命周期。 |
| 手机主屏 App 入口 | 原生导航项，装饰层切角；`mobile.css` | 触控热区、路由、角标、安全区；不套 Card 或裁切焦点。 |
| 播放浮窗、文件/目录选择、终端工具 | 独立工具，沿用专用共享弹窗/工作台框架 | 全屏层、目录边界、终端连接、播放与焦点；不作为摘要卡片重绘。 |
| TV 海报、搜索结果与剧集 | soft，无投影，完整 3px/4px 遥控焦点环；`tv/styles/cards.css` | 操作面、字幕/音轨、搜索、IME 和遥控顺序。 |
| 文档 Card/LinkCard 与目录链接 | Card soft，交互链接保留外环；`docs/styles/content.css` | 阅读字号、目录导航；当前首页继续使用开放目录，不新增卡片网格。 |

`scripts/test-card-surfaces.mjs` 检查家族在 14 种主题、中英文与五种宽度下的计算外观、开放区块、草稿保留、相机打开及 TV 焦点。它使用隔离只读数据，不能替代实际页面、设备部署或物理摄像机/电视验收。

## 验证入口

```bash
npm run appearance:check

# 文件上限、导入环、未定义变量及现有组件测试
npx vitest run packages/web/src/styles packages/web/src/components/common packages/web/src/tv

# 实际 Chromium：公共控件、业务创建表单、必填与数值、菜单及嵌套模态
npm run test:styles-browser
npm run test:tv-browser
npm run test:chat-browser
node --test scripts/test-card-surfaces.mjs

# 完整应用移动布局及状态恢复
cd docs
npx playwright test --config mobile.playwright.config.mjs
cd ..

# 全量检查及文档站共享样式回归
make ci
npm run docs:browser
```

控件回归比较 default、disabled、busy 和 focus 的计算样式，覆盖中英文、`1440/820/560/390/320px`、短视口、长文案、减少动态效果、滚动、嵌套 Escape 和焦点恢复。浏览器测试不能代替真实电视观看距离与物理遥控器验收；设备部署结果单独记录。
