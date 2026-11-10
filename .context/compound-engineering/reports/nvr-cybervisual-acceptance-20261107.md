# CyberOS NVR / CyberVisual PD42S1 实施与验收记录

日期：2026-11-07。此记录区分已实现的软件、软件互通、设备包升级与物理验收。软件与设备部署已完成；电机实物验收按用户要求延期，四路真实摄像机 24 小时验收尚未完成。

## 源码范围

- CyberOS 任务开始基线：`54f7859cbcb4be5fcd443bd85e76ffb8782c9938`。用户随后授权提交、合入 main 与推送；最终 `main` 为 `eccde69c4223f23ff090c5437ada52984b918ea2`，已核验远端 main 一致，版本按仓库规则推进为 `2.3.44`。提交 95 个文件，包含 61 个功能文件及 37 个统一版本文件（其中三个重叠）；其他任务的修改保留在工作区，未混入提交。
- CyberVisual 任务开始基线：`c4f005399ab5f2c168e9183a380bb680d2ae88d6`。并发 UI 工作后来已进入 `ffb5883fa9a21547b02f8d65e630bae245249041`。用户授权后，29 个任务文件提交为 `33535a1a8443ee683595f54dca7f2e9e9f5e28c4`，再按该仓库 CI 要求从干净源码生成已跟踪的设备前端资源，最终 `main` 为 `909f3a7d59427b2fc5eed7c379022c3694eef4d1`，已推送并核验远端一致。原有快照和不同的本地构建文件保留不变。Jetson 部署使用最初基线加上述 29 个任务文件；运行包与后续补丁分别记录哈希，不能仅用初始包哈希代表最终部署。未创建 tag 或正式 release。
- arm64 测试包使用隔离源码：基线加本任务的 58 个文件，排除开始任务前的无关修改。六个混合修改文件按任务差异提取，未整文件覆盖。随后浏览器传输修复更新其中七个文件并新增三个文件，最终任务范围为 61 个文件；原包源码哈希与补丁哈希分别保留。

## 已实现

CyberOS 新增独立、非 root 的 `cyberos-nvr`，通过 Unix socket 与 Fastify `/api/nvr` 接入。服务负责 ONVIF 发现与设备身份、受限凭据、双路媒体、PullPoint、录像与恢复、循环清理、事件、HLS、下载和 PTZ 适配。API 或浏览器关闭后录像继续。适配对象为 CyberVisual，尚不承诺任意 ONVIF 厂商兼容。

原生 NVR 面板包含实时、回放、事件、设备四页签，接入桌面与移动导航，支持 `#/app/nvr` 和中英文。默认标注 MJPEG 用于云台预览，原始流通过 HLS 观看；四台设备分别显示连接、视频、录像、AI 和云台状态。支持时间轴、事件跳转、下载及按住云台方向。

浏览器实测暴露了 HTTP/1 连接排队问题：全局四个长驻事件流与状态轮询会推迟 HLS 请求，部分请求在发出前即超过默认十秒首字节期限。面板现通过同源 WebSocket 传输 MJPEG 的完整 JPEG 帧，防止四路长驻预览占满连接池；原 HTTP MJPEG 接口保留。后台限制帧头、长度、大小和发送缓冲，慢客户端丢弃完整旧帧；跨源请求在连接源摄像头前拒绝，断开后销毁上游。状态 GET 降低优先级，HLS 使用优先 FetchLoader、30 秒首字节 / 60 秒总加载期限，后台保留 30 个滑动分段。该改动不更换摄像头凭据或录像策略。

默认不启用录像。选择已挂载存储池及目录后才能启用，默认 raw、七天、总计 100 GiB。录像用 RTSP/TCP、H.264 直接封装为约 60 秒 MPEG-TS 分段。仅清理登记片段，保护写入、播放会话及下载响应；目录身份、挂载与容量异常会暂停写入。新增 `015_nvr` 迁移、systemd、安装/卸载、开发启动及协议生成接入。

CyberVisual 已接入 `pd42s1` 配置、手动中心确认、反馈坐标与有限目标监督、最长两秒连续租约、停止保持力契约、故障失效参考，以及共享 REST/ONVIF 的状态与操作门槛。响应保留原字段并增加就绪、标定和故障信息；串口故障隔离于视频服务。

## 官方原生协议与安全决定

来源为 [正点原子官方资料目录](https://www.openedv.com/docs/industry/MotorDriver/PD42S1.html) 及其百度分享。

- `PD42S1步进电机闭环驱动器用户手册_V1.2.pdf`：5,905,555 字节，SHA-256 `2d53c17cb5f46ee518aa995f8df3a5c9a5e62e0618f2a043d5ae418d624c1f24`。
- `正点原子步进电机驱动器控制协议V1.2.xlsx`：32,963 字节，SHA-256 `cc7c76f42a10378f386646ece58f0cd3338ff120411954f644e1dada7f98740a`。
- 官方 Modbus 表另行留存，未用来替代原生串口协议。

用户已将官方文件下载到 Downloads。已逐项核对手册、XLSX 和官方 C 示例，并查看停止指令页；协议出处、哈希、页码和矛盾完整记录在 CyberVisual `docs/pd42s1.md`。

已实现 Python 3.6 / pyserial 3.5 的真实串口适配器：单总线所有者、固定应答长度、地址/功能/校验/结果检查、整帧单次写入、停止优先与旧运动失效、超时不重放。反馈为有符号 int32、每圈 51200 counts。每次 F3 相对目标的距离不超过配置速度乘 0.2 秒，上一目标到位才继续；重启、参考突变、越限和失联均使标定失效。标定同时检查整个机械范围可由 int32 反馈表示。

官方 `2F` 使能位说明存在矛盾，新增每轴 `enabled_feedback: null | 0 | 1`，必须根据实物确认；未知时不打开串口。`32` 参数应答只接受工作簿与正文的 V1.2 45 字节布局。F3 采用工作簿和手册黄金帧，未采用有额外字节的旧 C 例程。

停止用 F3 零位移目标覆盖旧目标，反馈确认静止并保留位置环保持力；不发送 FC 长时间刹车、FA 失能或 FB 自动清故障。手册明确警告 FC 严重发热。有限目标约束的是剩余距离，机械停止时间和俯仰保持力仍需实机验证。

## 已通过的软件验证

| 验证 | 结果与边界 |
| --- | --- |
| CyberOS 全量本机测试 | 最终 264 个 Vitest 文件，1778 通过、5 跳过；Rust workspace 通过。 |
| Linux arm64 包构建 | 所有 Rust 测试、263 个 Vitest 文件 / 1770 测试通过，Debian 包完成。 |
| 协议 / 类型 / lint / build / version | 功能实现本机全门禁通过，初始测试包版本 2.3.43。main 交付推进到 2.3.44 后，从干净提交重新完成版本策略、协议、类型、30 项版本/打包专项、API/Web/docs 构建与 Linux arm64 NVR 构建。 |
| NVR Rust | 12 通过、2 默认忽略；FFmpeg 中断片段恢复另行执行通过，另一个忽略项用于生成绑定。 |
| NVR 浏览器 | 最终 13 通过：中英文、1440/820/560/390/320px、四页签、四画面同屏与 JPEG 解码、预览切页断开/返回重连、录像启停、事件回放与 gap、云台续约/松开/失焦/切页停止。 |
| 预览传输专项 | API 与前端相关 15 项通过，包含逐字节分包、JPEG 内伪边界、超长/重复帧头、坏帧、四路源连接与取消、跨源拒绝及认证失败不回传源内容。 |
| 真实摄像头浏览器 | 已部署的 CyberMachine Nginx 入口、实际 Chrome、en/zh-CN × 1440/820/560/390/320px 共 10 项通过；每项均解码实际 Jetson 标注 JPEG 并检查四页签，无页面错误或设备/录像写请求。宽屏另验证 640×480 原始 HLS 持续播放。 |
| 文档浏览器 | 20 通过。 |
| CyberVisual 后端 | Docker 中全套 174 项通过，包含串口、媒体、Python 3.6 SOAP 与 Pillow 兼容回归；最后仅增加 Jetson IDR 间隔配置后，16 项媒体互通回归通过。串口/驱动/PTZ/REST 专项 78 项通过。 |
| CyberVisual 前端 | 全套 126 项通过；独立源码中 TS/Vite 构建与两项标定/重连门槛测试通过。 |
| 原生串口软件测试 | 官方黄金帧、分包、错地址、校验失败、超时、短写不重放、停止抢占、两轴停止尝试，以及真实 pyserial + Linux 伪终端应答器通过。伪终端不等于电机。 |
| Python 兼容性 | 3.6 语法检查通过；实际 Jetson Python 3.6.9 上原生协议帧、未配置门槛、SOAP 与 Pillow 8.4 标注 JPEG 检查通过。未打开串口，不等于真实电机验证。 |

四路软件媒体联调使用 synthetic source、mock AI、simulated PTZ，检查了认证失败、UUID 与重复登记、默认不录像、密码不泄露、JPEG、模拟 PTZ、live HLS、四路同时分段、回放、Range 206、完整下载大小与哈希。

生命周期结果：停止 Fastify 后四个录像任务不变且字节继续增长；重启 NVR 后四路恢复并各恢复一个中断片段；暂停源后四路暂停，源恢复后四路重连；替换存储池目录后四路暂停、替代目录零文件，原目录恢复后四路继续；记录 24 个事件覆盖缺口/恢复标记。目录替换不等于物理卸载，软件摄像头不等于真实摄像机或电机。

## 测试包

包：`.cyberos/nvr-upgrade/cyberos_2.3.43_arm64.deb`，109,965,596 字节。

SHA-256：`f30489f0a6949d55e4683f03adda8b88d5638f5c5f315dc7703ae041f8066649`。

已检查 ELF 为 AArch64、服务用户为 `cyberos`，包含 NVR 程序、面板与文档。构建信息标记 `source=local`、`dirty=true`、无 tag；此包用于测试升级，不是正式 release。

## CyberMachine 升级与设备浏览器

已按备份后的包升级流程完成 **2.3.42 → 2.3.43**。升级退出码 0；非 root NVR 常驻服务稳定，重启 API 后 NVR PID 保持不变；存储池 ready，`systemctl --failed` 为空。系统设置前后 SHA-256 相同。health 中 `stale_index` 为升级前已有状态。

设备备份目录 `/cyberos/system-backups/nvr-20261107`。保留当前运行文件重建的 2.3.42 恢复包，64,920 个文件逐文件校验通过；它不是原始 release 包。状态以已保留基准 tar + vcdiff 保存，重建 5,527,705,600 字节完整冷备份，SHA-256 与原备份一致，SQLite quick_check 通过。恢复步骤见本地 `.cyberos/nvr-upgrade/RESTORE.md`，不能仅降级程序而忽略数据库。

实际 CyberMachine Nginx 浏览器检查 **10/10**：en/zh-CN × 1440/820/560/390/320px，四页签、API 200、无页面错误或写请求；已查看宽屏和 320px 截图。此轮是空设备布局检查，与前述带四路夹具的交互验收分开。

官方协议更新后的 NVR 文档已通过构建、内容测试并单独部署。部署记录 `dev-20261107035649479-31013`；实际 `/docs/operations/nvr/` 返回 200，已读回核验协议文案。未改变 API、NVR 或数据库。

浏览器传输修复随后部署到 API、NVR、Web、docs，部署记录 `dev-20261107050957-nvr-preview`，备份与收据保留在 `/cyberos/dev-deploy/dev-20261107050957-nvr-preview`，状态为 `applied`。该补丁未包含在前述初始 `.deb` 内；最终运行版本由测试包及本次补丁共同组成。对照已安装测试包的隔离源码，125 个数据库、unit、依赖、lockfile 和部署运行时文件完全一致，使用既有部署锁、备份、稳定性检查与自动回退流程，未放宽源码部署限制。

补丁后实际 Chrome 浏览器检查 **10/10**：中英文各五档宽度、真实标注预览、四页签与页面边界均通过。原始 HLS 解码为 640×480，播放时间从 1.0197 秒推进至 3.0271 秒且未暂停；已人工查看宽屏 HLS 和 320px 中文实时页。结束时删除临时 HLS 会话，未启用录像或发送云台命令。最终 `2026-11-07T05:18:11Z` 核对：API PID 3130346、NVR PID 3130374，均为 `cyberos` 用户、active/running、NRestarts=0；failed units 为空，当前进程 error journal 均为零，实际 NVR 文档返回 200。真实设备连接、视频与 AI 可用，录像关闭，云台未标定且不可用。

## Jetson 部署与真实视频

已通过 Tailscale 实时发现并登录 `nvidia-jetson-nano.civet-beta.ts.net`。设备为 Jetson Nano / Python 3.6.9。原 `jetson-yolo-web.service` 位于 `/opt/jetson-yolo-web`，旧源码为 `326f9e2974c0976d20c7a4d73e76b4e2c5b0d7bc`，原实际配置有用户修改，保留不变。

原应用、模型和约 213 MiB 抓拍已完整归档到 `/var/backups/cybervisual/nvr-20261107/legacy-jetson-yolo-web.tar`，SHA-256 `d64bd34fafe84aa5e3550744d23c7490d5a73bcd9ab94a1d2f71a3c223466100`，同时保留旧 systemd unit。新源码已隔离构建并部署到 `/opt/cybervisual`；`cybervisual.service` 已启用，以 `zhubby` 非 root 运行，附加 `video dialout` 组。旧服务已停用，旧目录与数据仍保留。初次失败时曾自动恢复旧服务，兼容问题修复后完成切换。

真实 USB 摄像头位于 `/dev/video1`；新配置使用索引 1，TensorRT 复用原模型，最终检查约 5.8 FPS。独立 venv 使用 NumPy 1.19.5、Pillow 8.4.0，并设置 `PYTHONNOUSERSITE=1`、`OPENBLAS_CORETYPE=ARMV8` 与单线程 BLAS。配置和后台 ONVIF 凭据为 0600，运行状态目录为 0700；凭据未写入接口结果和部署收据。

已修复并部署三处实机兼容问题：Python 3.6 XML 序列化改用 `ElementTree.write`；Pillow 8.4 bitmap 字体的 `textbbox` 失败后回退 `textsize`；Jetson `nvv4l2h264enc` 显式将 `idrinterval` 与 FPS/GOP 对齐，保证晚加入客户端和 HLS 片段收到可解码的 SPS/PPS。保留原 `h264parse` 和 RTP payloader 配置。GPU 编码 90 帧检测到三个 IDR；真实 HLS 首次与晚加入会话各下载一个 TS，ffprobe 均为 H.264 / 640×480，FFmpeg 均解出 921600 字节 RGB 帧且无解码错误。

已将实际设备登记到 CyberMachine NVR，名称 `Jetson Nano`，稳定 UUID `8411b96a-eeca-4845-9e63-a4ff39497da7`；raw/annotated、标注 MJPEG、ONVIF、PullPoint 与 AI 正常。录像保持关闭，未选择录像存储池，策略仍为七天 / 总配额 100 GiB。单路短时互通不等于四路长期录像。

最终检查时间 `2026-11-07T05:15:07Z`：服务 PID 7946、NRestarts=0、32 个运行文件 SHA-256 一致、摄像头与 TensorRT 正常、当前进程 error journal 为空、旧配置哈希未变。完整收据见 `jetson/final.json`。

用户明确电机尚未安装，要求先略过。未打开串口、未发送运动指令；`pd42s1` 保持 `serial_port_unconfigured`、未标定、`hardware_ready=false`、位置未知和禁止移动。不再以接线或轴参数阻塞软件交付。

## main 提交、推送与本轮快速部署

用户后续明确授权两个仓库提交、合入 main、推送，并要求 CyberOS 快速部署。两个主工作区原本就在 main，因此直接提交经过快照核对的本任务内容；已通过 `git ls-remote` 核验本地与远端 main 一致。CyberOS 的 origin/upstream 指向同一仓库，upstream/main 也已刷新到本次提交。未提交无关的现有修改、私有验收数据或快照，未创建 tag。

- CyberOS：`eccde69c4223f23ff090c5437ada52984b918ea2`，统一产品版本 `2.3.44`。
- CyberVisual：功能提交 `33535a1a8443ee683595f54dca7f2e9e9f5e28c4`，设备前端资源提交 `909f3a7d59427b2fc5eed7c379022c3694eef4d1`。该仓库 CI 明确要求已跟踪的 dist 与源码同步，因此资源从干净功能提交重新构建；主工作区原有的不同构建输出和主题快照仍保留。

CyberOS 从干净提交隔离构建，版本规则（以前一 main 为 base）、协议、类型、30 项版本/打包专项、API/Web/docs 构建均通过。原生 NVR 在本机已有的 Linux arm64 / Rust 1.95.0 容器中离线构建，验证为 AArch64 ELF、最大 GLIBC 2.34；SHA-256 `9e9933d9e96f888b2279f39aef30ebc083e671a1ed50558cda90612e8301d7d1`，与设备运行文件一致。最初镜像源 TLS 超时未触及服务，随后复用已验证的本地构建环境完成。

本轮快速部署记录 **`dev-20261107053500-nvr-main`**，组件为 **api、nvr、web、docs**，状态 `applied`。构建来源为上述 main，`dirty=false`；备份与收据位于 `/cyberos/dev-deploy/dev-20261107053500-nvr-main`。已安装的初始 NVR 测试包保留为 `2.3.43`，本轮通过快速组件替换运行 `2.3.44` 源码，未安装新 `.deb`。由于旧测试包从未提交源码构建，其 Git 基线不能单独代表已安装 schema；本轮继续核对保留的包源码：125 个受保护文件中 90 个逐字节一致，35 个仅包含标准版本工具生成的产品版本信息变化，依赖内容、schema、unit、安装器行为均未改变。部署沿用仓库原有的锁、备份、服务恢复、健康/稳定性检查和自动回退实现，未修改或放宽仓库 guard。

最终设备检查 `2026-11-07T05:38:55Z`：API PID 3146813、NVR PID 3146843，均为非 root、active/running、NRestarts=0，failed units 为空，当前进程 error journal 均为零。存储与存储池均 ready；health 仍只有升级前已有的 `stale_index`。已核验 Nginx 返回的 Web 首页 SHA-256 与本次构建一致，NVR 文档返回 200，原生程序哈希与本次构建一致。

部署后的真实 Chrome 复验 **4/4**：en/zh-CN × 1440/320px，四页签、实际标注 JPEG 解码、页面边界与禁用云台门槛均正常。原始 HLS 解码为 640×480，时间从 1.0198 秒推进到 3.0313 秒。HLS 创建初期的片段等待返回 503，客户端自动重试后正常起播；没有页面脚本异常。临时 HLS 会话已删除，未发送设备、录像或电机写命令。此前五档宽度真实浏览器 10/10 仍作为完整布局验收。

CyberVisual 最新 main 的云端 CI 已全部通过（Linux 摄像头互通、前端测试/构建、浏览器和设备资源一致性）。CyberOS 云端 Quality 已完整通过，覆盖版本、协议、类型、lint、测试和完整构建；自动触发的 amd64/arm64 包构建与文档浏览器检查仍在运行，当前状态单独记录在 `main-delivery/cyberos-ci.json`，未将进行中的包构建记为通过。

本轮组件回退可使用 `npm run deploy:cybermachine -- --peer cybermachine --user zhubby --rollback dev-20261107053500-nvr-main`。此前包级升级的冷备份与恢复说明继续保留，组件回退不代替数据库恢复。完整本轮证据位于 `.cyberos/nvr-upgrade/main-delivery/verification.json`。

## 仍待验收

- 电机实物验收按用户要求延期：USB RS485 连接、两轴实物参数与使能反馈位，以及真实方向/角度、软限位、中心、预置位、拔插、停止保持力和进程退出边界。
- 四路真实摄像机连续录像 24 小时及真实挂载丢失/恢复。

## 本地证据

以下均为忽略的测试输出，未作为源码提交：

- `.cyberos/nvr-test-final.log`、`nvr-lint-final.log`、`nvr-build-final.log`。
- `.cyberos/nvr-package-finish.log`、`nvr-package-source-path`。
- `.cyberos/nvr-browser-final.log`、`nvr-docs-browser.log`、`nvr-browser/`。
- `.cyberos/nvr-validation/verified-pass.json`、`lifecycle.json`。
- `.cyberos/nvr-cybervisual-frontend-tests.log`、`nvr-cybervisual-frontend-build.log`。
- `.cyberos/nvr-upgrade/package-verified.json`、`pd42s1-fetch.log`、`pd42s1-fetch-device.log`。
- `.cyberos/nvr-cybervisual-backend-native.log`、`nvr-cybervisual-frontend-tests-native.log`、`nvr-cybervisual-frontend-build-native.log`。
- `.cyberos/nvr-upgrade/acceptance.json`、`upgrade-run.log`、`upgrade-device.log`、`nvr-journal.log`。
- `.cyberos/nvr-upgrade/device-browser-verified.json`、`browser/`、`docs-deployment-verified.json`。
- `.cyberos/nvr-transport-final-gates.log`、`.cyberos/nvr-upgrade/browser-transport-verification.json`、`browser-transport-deployment.json`、`browser-transport-deployment-receipt.json`、`browser-transport-compatibility.json`、`browser-transport-source-manifest.json`、`browser-transport-source-patches.json`。
- `.cyberos/nvr-upgrade/real-camera-browser-verified.json`、`jetson/nvr-final.json`；真实摄像头 10 项通过，修复前的诊断文件仅保留为历史证据。
- `.cyberos/nvr-upgrade/main-delivery/`：两仓库提交/远端核验、版本改动、干净源码构建、包兼容哈希、原生构建、快速部署收据、最终设备检查、四项真实浏览器复验与云端 CI 状态。
- `.cyberos/nvr-upgrade/jetson-source-manifest.json`、`jetson-artifact.json`、`jetson-wheels.json`、`jetson-deploy.py`。
- `.cyberos/nvr-upgrade/jetson-source-patches.json`、`jetson-deployed-source-manifest.json`、`jetson-runtime-manifest.json`、`pd42s1-verification.json`。
- `.cyberos/nvr-upgrade/jetson/`：原设备检查、备份、部署与最终收据、`hls-media.json`、`nvr-link.json`；`real-camera-browser/` 为私有摄像头验收截图，不发布。

后续升级记录与备份清单保留在 `.cyberos/nvr-upgrade/`，凭据或用户数据不写入本报告。
