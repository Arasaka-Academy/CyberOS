# crates/downloader/src/db/
> L2 | Parent: ../AGENTS.md

publish.rs: 持久化空间预留、发布 journal 和恢复。
torrent.rs: 持久化 BT 领取、预览、进度和发布。
transfer.rs: 持久化 HTTP 检查点、阶段和分段。
test_schema.rs: 提供隔离数据库表。
tests.rs: 验证共享控制、领取和 HTTP 检查点。
torrent_tests.rs: 验证 BT 所有权、预览和做种状态。

[PROTOCOL]: Update this header on change, then check AGENTS.md
