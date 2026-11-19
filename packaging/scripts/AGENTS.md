# scripts/
> L2 | Parent: ../AGENTS.md

成员列表
AGENTS.md: 本目录成员与脚本责任边界。
build-deb.sh: 在隔离目录构建 Debian 包与原生 TV 模块。
cyberos-configure-locale.sh: 设置系统 locale，备份配置并收窄 SSH 传递变量。
cyberos-configure-tailscale.sh: 校验发行版并安装官方 Tailscale stable 源。
cyberos-deploy: 备份状态，升级软件包并恢复服务；失败时回滚产物。
cyberos-deploy-bootstrap.sh: 创建受限部署账号与精确 sudoers 入口。
cyberos-mcp: 以 root 启动已安装的 Node MCP CLI。
cyberos-nas-acl.sh: 检查或应用存储池 ACL，拒绝嵌套挂载与只读池。
cyberos-nginx.sh: 生成并校验 Nginx 站点，接入 LAN 代理。
cyberos-refresh-groups.sh: 根据宿主能力生成 API 补充组与 libvirt 授权。
cyberos-share-acl.mjs: 执行共享 ACL 事务，保存备份并支持恢复。
cyberos-tv-cec: 将 HDMI-CEC 事件转换为白名单按键并发布健康状态。
cyberos-tv-chromium: 等待 API 与 Wayland 后启动 TV Chromium kiosk。
cyberos-tv-mode: 切换 TV 会话；持独占锁应用 HDMI 输出并支持回滚。
cyberos-tv-prepare: 配置前采样 EDID，生成 Weston 配置；停止时恢复 HPD。
cyberos-tv-weston: 启动匹配 ABI 的非 root Weston；新 socket 就绪后确认 EDID。
cyberos-tv-write-status: 校验组件与状态，原子写入 TV 健康文件。
install.sh: 准备 Debian 宿主，构建安装并激活原生服务。

[PROTOCOL]: Update this header on change, then check AGENTS.md
