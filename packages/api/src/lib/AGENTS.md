# packages/api/src/lib/
> L2 | Parent: ../AGENTS.md

成员列表
AGENTS.md: API 领域服务的成员导航与依赖边界。
agent-mcp-service.ts: 保存服务端 MCP 凭据，生成公开视图并验证连接。
agent-mcp-settings.ts: 配置和对齐 Agent MCP 服务的启用状态。
agent-skills.test.ts: 验证 Agent 技能导入、安装和项目检查边界。
agent-skills.ts: 从 ZIP 或 Git 暂存技能，校验后安装到受控目录。
audio-client.test.ts: 验证语音服务请求、错误映射和文本分块。
audio-client.ts: 调用语音模型服务并按语音输出边界拆分文本。
audio-coordinator.test.ts: 验证语音会话、设备占用和播放焦点协调。
audio-coordinator.ts: 串行协调语音输入、模型响应和设备输出生命周期。
audio-focus.ts: 通过共享播放器租约暂停与恢复被语音占用的媒体。
audio-runtime.test.ts: 验证原生音频服务客户端和设备选择契约。
audio-runtime.ts: 通过 Unix socket 调用原生音频服务并校验设备选择。
backup-directories.test.ts: 验证备份目录枚举的配置与路径边界。
backup-directories.ts: 为备份设置列出允许选择的目录。
bluetooth-manager.test.ts: 验证蓝牙宿主请求和不可用状态映射。
bluetooth-manager.ts: 通过 hostd 查询和配置蓝牙设备。
build-info.test.ts: 验证构建元数据解析和未知版本回退。
build-info.ts: 加载构建元数据并生成版本诊断视图。
capability-adapters.ts: 将授权能力请求装配到 API 领域服务。
capability-io.ts: 校验能力输入，约束 JSON 结果并计算修订摘要。
docker-client.test.ts: 验证 Docker Engine 请求、流与响应转换。
docker-client.ts: 提供 Docker Engine 容器、镜像、卷和执行流客户端。
docker-compose.test.ts: 验证 Compose 校验、物化与运行命令边界。
docker-compose.ts: 校验 Compose 项目并在受控目录物化部署配置。
docker-create.ts: 准备容器创建计划并绑定宿主访问授权后执行。
docker-daemon.test.ts: 验证 Docker 宿主服务配置与状态读取。
docker-daemon.ts: 通过 hostd 配置 Docker daemon 并汇总运行状态。
docker-host-access-control.test.ts: 验证受限宿主访问控制客户端。
docker-host-access-control.ts: 将容器宿主访问变更提交给受限控制服务。
docker-host-access.test.ts: 验证容器宿主路径策略与运行状态对齐。
docker-host-access.ts: 校验容器宿主访问策略并对齐运行容器声明。
docker-registry.test.ts: 验证镜像名称、仓库地址和凭据选择。
docker-registry.ts: 规范化镜像与仓库标识，生成 Docker 认证配置。
docker-service.test.ts: 验证 Docker 汇总视图、占用判断和业务操作。
docker-service.ts: 组合 Engine、Compose 和持久操作生成容器业务视图。
download-lifecycle.ts: 串行执行每任务命令，在原租约截止前等待停止确认。
ethernet-manager.test.ts: 验证以太网配置输入和宿主请求。
ethernet-manager.ts: 校验有线网络配置并通过 hostd 提交变更。
events.test.ts: 验证 Agent 事件起点和消息显示转换。
events.ts: 将 Agent 事件与作业失败转换为会话显示消息。
file-batch-runner.test.ts: 验证文件批处理租约、执行与收尾。
file-batch-runner.ts: 从持久队列领取文件批处理项并推进执行状态。
files.ts: 提供文件预览、范围流和索引结果转换。
git.test.ts: 验证 Git 状态解析和目录视图。
git.ts: 读取目录 Git 状态并与文件条目合成视图。
hostd-client.test.ts: 验证 hostd 请求关联、超时和错误转换。
hostd-client.ts: 提供版本化 hostd Unix socket 请求客户端。
iscsi-manager.ts: 校验 iSCSI 操作并调用 hostd 目标服务。
mcp-resources.test.ts: 验证文件和照片 MCP 资源的版本与访问边界。
mcp-resources.ts: 创建受控文件和照片资源，校验修订后提供内容。
media-capabilities.test.ts: 验证媒体能力、结果裁剪和资源链接。
media-capabilities.ts: 将媒体读取与变更能力绑定到业务 API。
monitoring-events.test.ts: 验证监控事件订阅和状态恢复。
monitoring-events.ts: 将监控事件与当前状态广播给 API 订阅者。
music-player.ts: 为 API 请求解析共享原生音乐播放运行时。
network-manager.test.ts: 验证无线网络扫描、配置和宿主状态转换。
network-manager.ts: 通过 hostd 查询和配置无线网络。
nvr-capabilities.test.ts: 验证 NVR 能力资源创建和内容响应。
nvr-capabilities.ts: 将 NVR 媒体资源绑定到受控 MCP 响应。
operations-management.ts: 通过 hostd 提交维护操作并规范化失败信息。
operations.ts: 执行回收站恢复与已应用文件操作的回滚。
photos-map.test.ts: 验证照片地图数据下载与归档安装。
photos-map.ts: 下载并安装受控地图归档，提供照片离线地图来源。
photos-metadata-fields-worker.ts: 在线程中读取照片元数据字段，隔离数据库查询。
photos-metadata-fields.test.ts: 验证照片字段读取、并发和线程响应。
photos-metadata-fields.ts: 调度照片元数据字段读取并约束并发请求。
photos-search-engine.test.ts: 验证照片检索排序、游标和地图条件。
photos-search-engine.ts: 组合照片检索条件、排序与分页游标。
photos-search-worker.ts: 在线程中执行照片检索并返回有界结果。
photos-search.test.ts: 验证照片检索服务的请求与线程生命周期。
photos-search.ts: 调度照片检索线程并关联请求响应。
power-management.ts: 校验电源动作并通过 hostd 执行关机或重启。
proxy-http.test.ts: 验证 HTTP 代理请求与失败传播。
proxy-http.ts: 提供 API 领域服务共用的代理 HTTP 客户端。
settings-upgrade.test.ts: 验证设置升级和共享凭据转换。
settings-upgrade.ts: 验证设置升级摘要并迁移共享服务凭据。
settings.ts: 生成公开设置视图与默认配置，隔离敏感字段。
share-credentials.ts: 组合持久共享设置和独立口令存储。
share-protocol-mutations.ts: 校验共享修订并执行协议共享变更。
share-service.test.ts: 验证共享服务状态、串行变更和配置提交。
share-service.ts: 通过 hostd 汇总共享状态并串行执行共享操作。
share-settings.test.ts: 验证共享目录与协议设置规范化。
share-settings.ts: 将共享设置输入规范化为受控存储池目录。
storage-scope.ts: 将存储池库存转换为路径边界并拒绝跨池访问。
storage-service.test.ts: 验证存储池创建、删除计划和宿主执行。
storage-service.ts: 构建存储池变更计划并提交受控宿主操作。
system-capabilities.test.ts: 验证系统能力的参数和授权执行边界。
system-domain-integration.test.ts: 验证系统能力与持久领域操作的集成。
system-info.ts: 汇总操作系统和设备信息。
system-management.ts: 装配宿主命令依赖并汇总网络、流量和存储库存。
system-mutation-capabilities.ts: 校验系统变更能力并绑定持久领域操作。
system-read-capabilities.ts: 将只读系统能力绑定到宿主状态查询。
tailscale-manager.ts: 通过 hostd 查询和配置 Tailscale 状态。
task-capabilities.ts: 为受控 Agent 作业提供取消能力。
terminal-client.test.ts: 验证原生终端客户端的请求和事件契约。
terminal-client.ts: 为 API 装配独立原生终端运行时。
terminal-sessions.test.ts: 验证终端会话租约、复用和空闲回收。
terminal-sessions.ts: 为 WebSocket 连接分配和回收终端会话租约。
terminal.test.ts: 验证终端尺寸、进程与运行时边界。
terminal.ts: 定义终端运行时、PTY 契约与尺寸限制。
tmdb-client.test.ts: 验证 TMDB 查询与候选结果转换。
tmdb-client.ts: 查询 TMDB 媒体候选并约束外部响应。
tv-display.test.ts: 验证显示策略同步、渲染握手与失联降级。
tv-display.ts: 向 Weston 模块续租显示策略并发布原生状态。
tv-mode.ts: 通过 hostd 启停 TV 模式或独立重配 HDMI 输出。
tv-output-monitor.ts: 比较稳定 EDID 与启动快照，空闲时重新匹配已应用输出。
tv-output-monitor.test.ts: 验证热插屏恢复、播放会话保护、退避与关闭。
tv-outputs.ts: 只读枚举 HDMI 和 ALSA 候选，并比较已应用输出。
tv-outputs.test.ts: 验证真实输出枚举、独立失败与待应用状态。
tv-settings-lock.ts: 按数据库串行执行 TV 保存与输出应用。
tv-screensaver.test.ts: 验证素材路径、视频描述符和图片缓存边界。
tv-screensaver.ts: 枚举受控图片或视频目录，提供图片预览和安全视频描述符。
video-cache.test.ts: 验证视频预览转码、缓存复用与容量回收。
video-cache.ts: 为浏览器视频预览提供有界转码与缓存。
vm-service.test.ts: 验证虚拟机视图、QEMU 参数与业务操作。
vm-service.ts: 组合 QEMU 状态和持久操作生成虚拟机业务视图。
vod-player.ts: 为 API 请求解析原生视频播放运行时。
voice-media.test.ts: 验证语音上传、格式规范化和媒体持久化。
voice-media.ts: 约束语音上传，转换音频并保存会话媒体。
wifi-voice-codec.ts: 编解码 Wi-Fi 语音 ADPCM、校验和与 PCM 波形。
wifi-voice-output.test.ts: 验证 Wi-Fi 语音分段发送和设备输出。
wifi-voice-output.ts: 将语音分段发送至已选择的 Wi-Fi 扬声器。

[PROTOCOL]: Update this header on change, then check AGENTS.md
