# tv-display/
> L2 | Parent: ../AGENTS.md

display.h: Weston 上下文与 IPC、输入、视图边界。
idle.h: 独立租约和闲置状态机的契约。
idle.c: 纯策略状态机；屏保请求先于 renderer 确认。
module.c: 合成器生命周期、DPMS 与 100ms 调度。
ipc.c: 同用户 0600 stream；PLAYBACK 请求编号直回与无编号广播。
input.c: 默认 grab 代理、原生键盘能力与完整首次手势吞噬。
原生 KEY 保留真实按住状态；向客户端发送短按，保留显式重复节奏。
每个 socket 键独立使用 10 秒租约，清除崩溃客户端的孤立状态。物理长按不超时。
views.c: 跟踪 surface 与桌面元数据；独立 overlay 保留原 shell 视图。
input-helper.c: CEC/手柄的受限 KEY 客户端；STATUS 预检不产生活动。
build.sh: 在匹配 ABI 开发环境编译模块与确定性测试。
Dockerfile: 匹配发行版与主机 CA 的可缓存构建环境。
build-matrix.sh: 匹配发行版容器构建 amd64/arm64 的三种 ABI。
test-idle.c: 租约、策略心跳、屏保请求、关屏独立计时回归。
test-input.c: 键盘重复/释放、鼠标按钮和多点触摸唤醒回归。
test-output.c: 仅供 headless 测试的 DPMS 回调，不打包。
test-socket.py: 请求编号隔离、旧命令兼容、renderer 握手与 DPMS 租约回归。
test-headless.sh: 隔离 Linux 容器的非 root Weston 集成测试。

屏保状态先通知网页准备内容。renderer=1 后才创建 overlay。
RENDERER 不重置闲置，也不唤醒已关屏的输出。
POLICY 与 PLAYBACK 各有 10 秒租约。相同心跳不重置闲置。
PLAYBACK 接受可选非零 u64 requestId。仅命令直回包含数字 requestId。
广播不带 requestId。播放器必须等匹配编号的 active 确认。
ABI 模块按 Weston 主版本选择，禁止跨主版本加载。
Debian 的公共输入客户端来自 ABI 10 环境，保留旧 libc 兼容性。

[PROTOCOL]: Update this header on change, then check AGENTS.md
