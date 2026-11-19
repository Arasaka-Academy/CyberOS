# packaging/
> L2 | Parent: ../AGENTS.md

成员列表
AGENTS.md: 原生交付目录与声明测试的导航。
debian/: Debian 元数据、依赖和生命周期脚本。
etc/: 安装到系统的静态配置。
helpers/: 受限宿主操作脚本及其单元测试。
modules-load.d/: 内核模块加载配置。
native/: 原生 TV 显示与输入模块。
nginx/: LAN 代理与静态文件配置。
scripts/: 构建、安装、部署与 TV 运行脚本。
systemd/: 原生进程和周期任务的隔离边界。
tmpfiles.d/: 运行目录与文件权限声明。
iscsi-kernel-source.json: 固定并校验 iSCSI DKMS 源码。
audio.test.ts: 原生音频服务与依赖声明测试。
iscsi-install.test.ts: iSCSI 安装与能力探测测试。
nas-acl.test.ts: NAS 权限初始化测试。
nvr.test.ts: NVR 安装与隔离声明测试。
packaging.test.ts: 包交付路径、宿主权限和恢复顺序测试。
share-acl.test.ts: 共享目录权限配置测试。
tailscale-install.test.ts: Tailscale 安装与恢复测试。
terminal-home.test.ts: 终端 home 目录迁移测试。
tv-fonts.test.ts: TV 字体依赖与加载测试。
tv-mode.test.ts: TV 模式切换、输出应用和回滚测试。
tv-prepare.test.ts: HDMI 选择、配置前 EDID 采样与 HPD 回退测试。
tv-weston.test.ts: 新合成器就绪后确认 EDID，启动失败保留快照。

[PROTOCOL]: Update this header on change, then check AGENTS.md
