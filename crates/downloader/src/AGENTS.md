# crates/downloader/src/
> L2 | Parent: ../AGENTS.md

lib.rs: 导出下载器及其模块。
main.rs: 配置日志、退出信号和服务入口。
config.rs: 解析根目录、业务库和生产约束。
db.rs: SQLite actor、任务类型、领取和控制。
db/: BT、HTTP 检查点、发布和数据库测试。
download.rs: 调度、HTTP 续传、分段和恢复。
error.rs: 定义稳定错误码与可重试分类。
network.rs: 校验公网目标、重定向和 Range。
p2p.rs: BT 引擎、预览、任务控制和发布；引擎停止成功后确认控制。
p2p/: 区分校验与下载进度并验证本地 peer。
retry.rs: 计算退避和 Retry-After。
storage.rs: 约束路径、挂载、句柄与无覆盖发布。

[PROTOCOL]: Update this header on change, then check AGENTS.md
