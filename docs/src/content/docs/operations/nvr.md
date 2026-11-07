---
title: NVR 监看与录像
description: 接入 CyberVisual 摄像机，配置独立录像服务、循环存储、事件和云台。
type: operation
status: current
audience: [operator]
sourceOfTruth: [crates/nvr, packages/api/src/routes/nvr.ts, packages/web/src/components/nvr, packages/db/src/migrations/nvr.json, packaging/systemd/cyberos-nvr.service]
---

NVR 面板通过 `#/app/nvr` 打开，包含实时、回放、事件和设备四个页签，最多接入四台 CyberVisual 摄像机。录像由独立的非 root `cyberos-nvr.service` 执行；关闭面板、浏览器或重启 API 不会停止录像。

## 接入设备

在 CyberVisual 启用网络摄像头输出，并在设备后台配置 ONVIF 用户名和密码。CyberOS 的设备页支持局域网 WS-Discovery 和手动输入 `http://camera:8000/onvif/device_service`。设备 UUID 来自摄像机持久身份；同一个 UUID 不能重复添加。

密码保存在 `state/secrets/nvr` 下的受限文件中，不进入公开设备对象、SQLite 文档或 FFmpeg 命令参数。修改密码需删除设备后用相同 UUID 重新添加；已有录像保留。此适配器使用 CyberVisual 的 `raw` / `annotated` profiles 和管理状态接口，尚不承诺任意厂商 ONVIF 摄像机兼容性。

添加后默认不录像。先选择已挂载存储池和目录并保存，再逐台点击“开始录像”。默认使用原始 H.264，允许改为 AI 标注流；FFmpeg 通过 RTSP/TCP 拉流并直接封装为约 60 秒的 MPEG-TS 分段，不重新编码。分段边界受源关键帧间隔影响。

实时默认显示 AI 标注 MJPEG，原始画面通过 HLS 监看。连接、视频、录像、AI 与云台状态分别显示。HLS 包含缓冲延迟；操作云台使用 MJPEG 预览。

面板通过同源 WebSocket 接收 MJPEG 中的 JPEG 帧，避免四路长驻预览与全局事件流耗尽浏览器的 HTTP/1 连接。接口为 `/api/nvr/devices/:id/preview-socket`；原 HTTP MJPEG 接口继续保留。后台验证帧头和长度、限制帧大小与排队缓冲，慢客户端丢弃旧帧，关闭页面即断开源预览。HLS 保留约一分钟的滑动分段，并优先加载视频，适应中继链路的请求排队；实际起播时间仍受网络和源关键帧影响。

## 存储与回放

默认保留 7 天，NVR 总配额 100 GiB，先达到的限制触发清理。清理仅处理数据库登记的分段，正在写入、回放或下载的文件受保护。存储池离线、挂载或目录身份变化、可用空间不足 256 MiB、受保护片段导致配额无法释放时暂停录像，恢复条件满足后重连。配额检查以秒为单位，当前分段可能带来短暂超额。

回放按设备和本地日期查询，时间轴及事件可定位录像。HLS 回放与片段下载支持 Range 请求。删除设备默认保留录像，仍可在回放和事件列表按设备查询。进程重启会检查已登记的录像任务，恢复有效 H.264 片段，将缺失或异常片段标记出来；不会扫描并收录目录里的无关文件。

PullPoint 的初始化消息仅刷新指示状态，不再次产生 AI 告警。事件保留精确时间与来源 ID，队列溢出、订阅故障和重启后的重新覆盖以缺口标记显示。事件与录像通过摄像机 UUID 和 UTC 时间关联；请同步摄像机和 NAS 的时钟。

## 云台

REST 和 ONVIF 使用 CyberVisual 的同一个控制器。按住方向时每 500 ms 续约，租约最长 2 秒；松开、失焦、离线、隐藏页面和离开实时页都会发送停止。停止未确认时以故障显示，不能推断电机已经停止。

PD42S1 的硬件链路为 Jetson Nano → USB 转 RS485 → 两轴驱动器，计划地址 1/2，115200 8N1。每次驱动重启或参考失效后必须手动确认中心，重新标定清除旧预置位。CyberVisual 已核对官方 V1.2 文件并接入原生串口、有限目标与停止优先处理；每轴机械参数和资料中有歧义的使能反馈位必须按实物确认，未知时禁止运动。配置、官方文件哈希与资料差异见 CyberVisual 的 `docs/pd42s1.md`。协议与伪终端测试不代表真实电机方向、限位、保持力或退出边界验收。

## 服务与升级

API 通过 Unix socket `/run/cyberos/nvr.sock` 连接录像服务。数据库迁移由现有 CyberOS 状态初始化流程执行，NVR 本身不会修改 schema。新增服务和迁移需要备份后的 Debian 包升级，不能使用组件热替换代替。

```bash
sudo systemctl status cyberos-nvr.service
sudo journalctl -u cyberos-nvr.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3010/api/nvr
```

开发环境使用独立 `CYBEROS_ROOT`；运行 `npm run dev` 会启动 NVR。需要本机 FFmpeg/FFprobe，Rust 协议绑定通过 `npm run protocol:generate` 生成。

## 验证边界

`cargo test -p cyberos-nvr` 覆盖路径、挂载身份、凭据、设备限制、事件去重、清理保护、下载生命周期与范围请求。带 FFmpeg 的恢复检查使用：

```bash
cargo test -p cyberos-nvr recovers_interrupted -- --ignored
node --test scripts/test-nvr-browser.mjs
```

浏览器测试覆盖中英文在 1440/820/560/390/320px 的四个页签、四路 JPEG 解码与预览连接清理，以及云台按住、松开、失焦、切页停止、录像启停和事件跳转。四路软件摄像头的 RTSP、HLS、录像与回放互通是单独的媒体验证。四路 24 小时、NAS 包升级、真实电机方向/角度/限位/标定/拔插/退出边界必须分别验收，不能由单元测试代替。
