# systemd/
> L2 | Parent: ../AGENTS.md

成员列表
AGENTS.md: 本目录成员与服务隔离边界。
cyberos-alerter.service: 启动原生监控告警计算与投递进程。
cyberos-api.service: 启动 Node API 并提供 Web 静态资源。
cyberos-audiod.service: 启动蓝牙语音输入与宿主语音输出进程。
cyberos-backup-daily.service: 使用口令文件执行 restic 每日备份。
cyberos-backup-daily.timer: 每天触发每日备份服务。
cyberos-backup-weekly.service: 使用口令文件执行 restic 检查与保留策略。
cyberos-backup-weekly.timer: 每周日 03:30 触发每周备份服务。
cyberos-bluetoothd.service: 在 D-Bus 会话内启动蓝牙传输进程。
cyberos-downloader.service: 启动 HTTP 与 BitTorrent 下载进程。
cyberos-health.service: 执行单次健康评估。
cyberos-health.timer: 开机六分钟后启动，随后每十五分钟评估健康。
cyberos-host-accessd.service: 启动受限容器宿主访问代理。
cyberos-hostd.service: 在精确权限边界内启动 root 宿主集成进程。
cyberos-indexer.service: 启动 NAS 索引进程。
cyberos-iscsi-prepare.service: 加载 iSCSI 内核模块，容忍可选模块缺失。
cyberos-maintenance.service: 执行 SQLite 与恢复暂存维护。
cyberos-maintenance.timer: 每天 04:30 触发维护服务。
cyberos-media-streamer.service: 启动浏览器媒体流服务。
cyberos-monitor.service: 启动宿主与服务指标采集进程。
cyberos-nvr.service: 启动网络录像进程。
cyberos-photos-embeddings.service: 启动 Node 照片向量计算 worker。
cyberos-photos.service: 启动原生照片媒体 worker。
cyberos-state-init.service: 初始化状态数据库，供依赖服务启动。
cyberos-tailscale-forwarding.service: 存在配置时应用 Tailscale 网关转发。
cyberos-terminald.service: 启动原生终端进程。
cyberos-tv-cec.service: 随 TV target 提供 HDMI-CEC 遥控输入。
cyberos-tv-chromium.service: 等待 Weston 与 API，启动 TV Chromium。
cyberos-tv-gamepad.service: 随 TV target 提供手柄输入。
cyberos-tv-prepare.service: 准备 TV 运行目录与 HDMI；停止时恢复 HPD。
cyberos-tv-weston.service: 等待 TV 准备后启动非 root Weston kiosk。
cyberos-tv.target: 聚合 TV 显示、播放器、遥控与手柄服务。
cyberos-vod-player.service: 独立运行非 root 音乐与影视共享播放器。
cyberos-webdav.service: 使用独立 Apache 配置提供 WebDAV。
cyberos-worker@.service: 启动指定实例的 Node Agent worker。
minidlna.service.d/: 为 MiniDLNA 固定 CyberOS 配置与 PID 路径。
rtslib-fb-targetctl.service.d/: 仅在 LIO 内核接口存在时恢复 target 配置。
smbd.service.d/: 为 Samba 固定 CyberOS 共享配置。
tailscaled.service.d/: 在 Tailscale 启动前应用网关转发配置。
vsftpd.service.d/: 为 FTP 固定 CyberOS 共享配置。

[PROTOCOL]: Update this header on change, then check AGENTS.md
