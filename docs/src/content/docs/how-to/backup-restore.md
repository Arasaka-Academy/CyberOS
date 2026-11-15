---
title: 备份与恢复
description: 使用 restic 完成校验、初始化、日常备份、检查和 staging 恢复。
type: how-to
status: current
audience: [operator]
sourceOfTruth: [packages/backup/src/index.ts, packages/backup/src/backup.ts, packaging/systemd/cyberos-backup-daily.timer]
sidebar:
  order: 2
---

备份是显式 opt-in 能力。生产 Restic repository 固定为独立挂载的 `/cyberos/backup`；先配置受保护的 password file，再执行 validate 和一次性的 init。daily/weekly timer 永远不会隐式初始化仓库。备份开始前会确认 repository 与每个 `/cyberos/data/<pool-id>` 都是精确挂载点，避免磁盘掉线后读写系统盘目录。

备份包括 storage pools、SQLite 在线快照、trash 状态和 v2 manifest。恢复首先写入新的 0700 staging 目录，校验 data root 身份与 SHA-256；非 v2 manifest 会被拒绝，恢复不会覆盖活动 storage pool、数据库目录或备份仓库。

## 通过内置 Pi 恢复到 staging

先读取 `cyberos.backup.status` 和 `cyberos.backup.coverage`，确认 repository、password file 和保护范围，再用 `cyberos.backup.snapshots` 分页选择快照。仓库仍可用时，关闭定时备份不会禁止快照浏览或 staging 恢复。源存储池离线也不妨碍读取独立的备份仓库。

快照返回完整 `id`、时间、标签、匹配的 `runId`、`kind` 和 `restoreSnapshotIds`，不公开宿主机路径或仓库密码。仅在一次已完成的 backup run 恰好对应两个无歧义快照时配对 data/state；优先选择这种快照，使用完整 ID 避免前缀冲突。

```json
{"request":{"operation":"restore","snapshotId":"从 snapshots 取得的完整快照 ID"},"idempotencyKey":"restore-drill-001"}
```

`cyberos.backup.restore-propose` 只允许内置 Pi 提案，必须经第一方明确确认。恢复与备份／检查使用同一执行锁，先恢复并校验 state manifest，再将配对的数据快照恢复到 staging 内的 `data-snapshot`。失败时清理本次 staging，成功返回 `stagingPath`、`snapshotIds`、`verified` 和 `liveDataChanged: false`。恢复执行期间使用 `runs.get/wait` 观察能力状态；此操作不提供中途取消。

`verified: true` 表示仓库检查、state v2 manifest／SHA-256 和 Restic 恢复检查通过，不证明源应用的一致性，也不代表已切换活动数据。未配对的旧快照只有通过 v2 manifest 校验后才能作为 state 恢复；普通 data-only 快照会被拒绝。恢复后的人工检查、应用恢复演练和活动数据切换是独立步骤。

## iSCSI 磁盘

存储池中的 `.cyberos/iscsi` 是受保护的 LUN 镜像目录，普通文件备份明确排除整个目录，避免读取运行中的磁盘镜像并误报为一致备份。日常 restic 备份也不保存 `/cyberos/state/hostd/iscsi` 的 Target 配置及 CHAP 凭据。需要保护 iSCSI 数据时，在连接端使用文件系统或应用支持的一致性备份；重装前单独保管受限的 Target 配置，并核实原镜像与存储池身份。普通文件恢复不会自动恢复 iSCSI 服务。

## Docker 工作负载的数据

默认 Docker named volume 位于 `/var/lib/docker/volumes`，不属于 CyberOS storage pools，也不会因备份 SQLite 而被备份。设备状态备份保存的 Registry 凭证不等于容器数据备份，恢复目录或数据库也不会自动重建容器。生产 RustFS 等对象存储必须另外制定应用一致的数据备份策略，或使用经过规划的 NAS bind mount；不要在线复制活跃 volume 并声称已得到一致备份。

托管 Compose App 的 YAML、环境变量、元数据和 revision 位于 SQLite，因此会随设备状态备份恢复；环境变量是受限明文。`/cyberos/apps` 只是可重建运行副本，不需要单独纳入备份，API 启动后会从数据库重新发布。恢复 App 定义不会恢复 named volume 数据，也不会自动启动项目；恢复后先核对 storage pool、镜像 digest、挂载和秘密，再通过页面确认并执行 Compose Up。

首次验收使用隔离的测试容器、独立 volume 和专用凭证，不修改现有 `rustfs-data`。写入小对象并记录 SHA-256，通过页面重启测试容器后重新下载校验；经确认删除并重建测试容器时复用测试 volume，再次校验，证明数据不依赖容器可写层。

备份恢复演练在维护窗口暂停测试工作负载写入，使用应用支持的备份或在停止测试容器后备份其 volume 数据，保留文件 UID/GID、权限和需要的元数据。保存镜像 digest、命令、挂载、网络与重建清单，凭证只保存在受限的独立材料中；备份仓库必须与源数据隔离。执行备份检查，再恢复到新的 staging 目录/新测试 volume，不覆盖原 volume；使用相同 digest 创建恢复容器并限制到测试端口，登录后下载原对象核对 SHA-256。仅 snapshot 创建成功不足以证明可恢复。

完成恢复读取和一致性验证前保留原数据与备份；清理测试容器、volume、对象和凭证须核实精确目标并经确认。现有失败的 backup service 必须记录原因并独立验收；不要 reset-failed 后把它当作健康，也不要让失败状态误归因于本次部署。生产验收要求至少一次真实备份检查和隔离恢复通过。

SQLite/state 和配置归档可能包含未加密 Registry 密码、代理凭据和其他密钥。归档应限制访问并使用加密备份仓库；日志、截图和故障报告不得包含数据库、认证配置或凭证正文。
