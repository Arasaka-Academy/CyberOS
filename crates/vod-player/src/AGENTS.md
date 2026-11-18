# crates/vod-player/src/
> L2 | Parent: ../AGENTS.md

成员列表
AGENTS.md: 播放器源码导航与依赖方向。
lib.rs: 组合原生播放器模块并导出服务边界。
main.rs: 装配配置、日志、信号和服务入口。
config.rs: 只读解析 TV、蓝牙与运行配置；兼容旧空闲字段。
controller.rs: 串行拥有 mpv 会话；处理命令和即时事件；续租显示抑制。
music_controller.rs: 实现控制器的音乐队列、切曲和播放历史。
display.rs: 以请求编号关联原生唤醒确认；续租或释放播放抑制。
audio_route.rs: 将实际 PCM 描述符和进程子设备身份转为路由证据。
audio_route_alsa.rs: Linux 动态加载 ALSA；只读枚举精确 PCM ELD。
error.rs: 统一播放错误码、状态码和恢复判定。
mpv.rs: 通过继承 FD 启动 mpv；关联响应并传递即时输入意图。
music.rs: 定义队列、持久化检查点和播放事件。
preferences.rs: 原子保存音量、静音、输出偏好和音频延迟。
progress.rs: 验证媒体身份并异步写入观看进度。
protocol.rs: 定义 v3 命令、状态、实际路由及生成的 TypeScript 类型。
server.rs: 校验 Unix 客户端身份、帧大小与并发连接。
session.rs: 原子保存视频会话并隔离损坏检查点。
storage.rs: 在配置存储池内安全打开音频与视频。
tv_controls.rs: 创建和回收内嵌 Lua 控制脚本。
tv-controls.lua: 绘制原生控制界面；暂停与继续交由控制器执行。

[PROTOCOL]: Update this header on change, then check AGENTS.md
