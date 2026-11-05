---
title: 照片智能搜索
description: 在 Mac mini 运行图文向量模型，在 CyberOS 保存派生索引并执行关键词混合检索。
type: how-to
status: current
audience: [developer, operator]
sourceOfTruth: [tools/photos-embedding-service/service.py, packages/db/src/repositories/photos-semantic.ts, packages/db/src/repositories/photos-search.ts, packages/api/src/lib/photos-search-engine.ts, packaging/systemd/cyberos-photos-embeddings.service]
sidebar:
  order: 13
---

## 架构与启用

Mac mini 负责图片和文本推理；CyberMachine 保存 Float32 向量、任务和照片关联，并执行本地精确检索。Rust Photos 继续生成照片、RAW 和视频的现有完整比例预览，不需要联网。独立的 `cyberos-photos-embeddings.service` 每次处理一张预览，优先新增照片，再补建已有图库。

在“设置 → Photos → 智能搜索”填写 API Base URL、模型 ID 和 API Key，点击“测试连接”。测试使用当前草稿验证模型清单、文本接口和图片接口，不保存设置。启用并点击“保存智能搜索”后自动补建。默认关闭，服务离线时也可以保存；连接恢复后继续处理。

建议配置：

| 项目 | 值 |
| --- | --- |
| 模型 | `Qwen/Qwen3-VL-Embedding-2B` |
| 权重 revision | `9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda` |
| 向量 | 2048 维，L2 归一化，普通 Float32 BLOB |
| Mac 监听 | `127.0.0.1:8766` |
| CyberOS Base URL | `https://<Mac-mini-MagicDNS>:9443`，不加 `/v1` |
| 模型输入 | EXIF 方向校正、RGB、保持比例、最多 768×768 像素面积 |
| 服务 | 单进程常驻；文本优先于等待中的图片任务 |

API Key 仅保存在 CyberOS 服务端，GET 只返回 `apiKeyConfigured`。留空或省略表示保留原密钥；使用清除按钮并保存才删除。状态轮询和连接测试不会覆盖尚未保存的草稿。

## Mac mini 安装

需要 Apple Silicon macOS、Python 3.13、可访问模型下载源的网络和约 10 GiB 可用磁盘。M4/16GB 已完成真实推理验证。不要在 CyberMachine 上安装模型。

在 Mac mini 的本地 checkout 执行：

```bash
python3 tools/photos-embedding-service/install.py --python /opt/homebrew/bin/python3.13
```

安装器建立独立 venv，按 `requirements.lock` 安装，下载并逐文件校验固定 revision 的模型。主权重 SHA256 为 `c73fa9caeddeb3ff831d46c085a7a5708343248ca777e90f2d486964464509c1`。启动时校验锁文件摘要和实际依赖版本，预热完成后才开放健康接口。不要向此 venv 安装额外依赖；官方 PyTorch 对照应使用另一个环境。

默认文件位于 `~/Library/Application Support/CyberOS/photos-embedding/`，目录权限 0700，`api-key` 和 `config.json` 为 0600。launchd 用户服务为 `io.cyberos.photos-embedding`，登录后常驻，服务日志保存在同一目录。launchd 用户服务依赖该用户的登录会话；Mac 睡眠期间不可推理。

先保存 Tailscale 当前 Serve 状态，再只增加 9443。不要执行 `serve reset`，也不要为此端口开启 Funnel：

```bash
tailscale serve status --json > serve-before-photos.json
tailscale serve --bg --https=9443 http://127.0.0.1:8766
tailscale serve status
curl --fail http://127.0.0.1:8766/healthz
```

确认原有 443/8443 路由保留、9443 仅 tailnet 可达，并从 CyberMachine 请求该 HTTPS 地址的 `/healthz`。Tailnet ACL 必须允许 CyberMachine 访问 Mac 的 9443。健康接口只确认模型已经加载，连接测试还会验证鉴权和真实图文推理。

## API 协议

所有模型接口需要 `Authorization: Bearer <token>`。不跟随重定向；上传最大 8 MiB，分块请求也受总大小限制。模型响应的维度、数量、数值有限性、归一化和向量空间标识均会校验。

| 接口 | 输入与行为 |
| --- | --- |
| `GET /v1/model` | 返回 `protocol`、`model`、`revision`、`dimensions`、`embeddingSpaceId`、`normalized` 和 `modalities` |
| `POST /v1/embeddings/text` | JSON：`{"model":"Qwen/Qwen3-VL-Embedding-2B","texts":["海边的日落"]}`，最多 16 条，每条 512 字符 |
| `POST /v1/embeddings/image` | multipart：`model` 字段和 `image` 文件 |

图文响应均为 `{"embeddingSpaceId":"…","dimensions":2048,"embeddings":[[...]]}`。文本与图片必须返回同一空间。`embeddingSpaceId` 覆盖模型 revision、维度、pooling、归一化、提示词、图片预处理、最大文本长度、后端版本及完整依赖锁摘要。相同模型 ID 不代表相同向量空间。

流水线版本 2 在每个独立请求前后重置 MLX 的 RoPE 位置状态。固定的 `mlx-embeddings==0.1.0` 会跨请求保留位置编码，连续文本请求可能返回 502，图文切换也可能复用错误位置。服务的空间标识包含 `fresh_rope_positions_v1`，升级后建立新空间，旧向量和旧阈值不能沿用。真实服务已验证连续文本、图片、再次文本的结果稳定，并重新对照固定官方实现。

CyberOS 提供以下接口：

| 接口 | 行为 |
| --- | --- |
| `GET /api/settings/photos/semantic-search` | 返回脱敏配置、当前模型和索引状态 |
| `PATCH /api/settings/photos/semantic-search` | 保存 `enabled/baseUrl/model/apiKey/clearApiKey`；可单独保存当前模型的 `minSimilarity` |
| `POST /api/settings/photos/semantic-search/test` | 使用草稿及保留的密钥验证图文接口，不写配置 |
| `POST /api/photos/semantic-index/rebuild` | 202；清除当前空间的派生向量并重新排队，保留原照片和元数据 |
| `POST /api/photos/semantic-index/retry` | 202；重新排队失败项并恢复服务连接验证 |

改变地址或密钥后，空间一致时复用向量。改变模型后启用新空间，旧空间的数据保留但不参与搜索。服务未通知 CyberOS 就改变空间时会阻断批量推理；重新测试并保存设置后才激活。重建只清除当前模型空间。

## 检索与故障恢复

有关键词时，现有搜索框融合语义和文字匹配，默认按相关度排列，也可以选择拍摄时间等排序。先应用现有日期、相机、评分、位置等筛选，再将通过阈值的语义结果与 FTS、文件名、标签匹配取并集；中文文件名和标签支持子串。两路以等权 RRF、`k=60` 融合，不强制返回照片。

没有关键词时沿用原有浏览流程。地图使用相同匹配集合。结果快照保存 ID、分数和统计，5 分钟过期、总内存预算 32 MiB，没有隐藏 Top-K。游标绑定筛选、模型、阈值、图库和源资产版本；过期或源照片删除/替换返回 409，前端刷新结果。后台新向量和新照片不会打断正在进行的分页、选择和灯箱。

文本向量按关键词和空间缓存 24 小时、最多 500 条，并合并并发请求。Mac 离线时仍可用缓存向量查询本地索引；没有缓存则显示文字结果及“语义搜索暂不可用”。图片任务使用持久化租约、重启恢复和指数重试；网络失败触发全局退避，鉴权/协议/空间错误暂停请求。响应写入前核对租约、内容输入、图库、配置和模型，过期响应直接丢弃。

预览输入键由内容 hash、派生版本和预览 key 组成。重复内容共用缓存；XMP、标签和评分变化只更新文字元数据，图片输入未改变时复用向量。旧模型缓存暂不自动清理，切换很多模型时需监控磁盘。

```bash
sudo systemctl status cyberos-photos-embeddings.service
sudo journalctl -u cyberos-photos-embeddings.service --since '15 minutes ago' --no-pager
curl --fail http://127.0.0.1:3010/api/settings/photos/semantic-search
```

设置页显示覆盖率、待处理/失败数量、具体错误和首批推理后的剩余时间估算。估算不包含扫描、预览生成、断线和文本优先造成的等待，不能视为完成承诺。

向量缓存按批维护，每 5 分钟最多清理 256 条。最后一个有效照片或任务引用消失后保留 7 天；停用的模型空间保留 30 天，重新启用会取消停用计时。有效任务租约受保护。缓存占用与旧模型数显示在设置页，清理数量写入 worker journal；统计是最近一次维护时的值。清理释放 SQLite 可复用页，不自动执行阻塞的 `VACUUM`，数据库文件不一定立即缩小。

连续提交搜索或切换地图范围时，前端取消上一次请求。API 为整个搜索设置 15 秒期限，只向 reader 发送一个执行中的查询，取消的排队项不会进入 SQLite。已经开始的原生距离计算完成后丢弃响应。相同关键词的文本推理由多个调用者共享，最后一个调用者取消后才中止网络请求；Mac 服务会跳过已断开连接的排队推理。

## 校准与规模验证

初始相似度阈值为 0.35，按模型空间保存。准备私有 JSON 数据集，图片路径相对数据集文件；校准和验证查询必须分开，负例的 `relevant` 为空数组：

```json
{
  "images": [{"id":"photo-1","path":"photo-1.webp"}],
  "queries": [
    {"text":"海边日落","split":"calibration","relevant":["photo-1"]},
    {"text":"月球基地","split":"calibration","relevant":[]},
    {"text":"夕阳下的海岸","split":"validation","relevant":["photo-1"]},
    {"text":"太空飞船","split":"validation","relevant":[]}
  ]
}
```

用安装好的 Mac venv 执行 `tools/photos-embedding-service/evaluate.py`，传入 `dataset.json --base-url http://127.0.0.1:8766 --token-file <私有api-key路径> --output report.json`。工具选择校准集负例误命中率不超过 10% 的阈值，报告独立验证集的前十项相关率；正例查询无结果按零分。结果少于十项时按实际返回项数计算，需同时检查有无漏召回。`--scores report.json` 可重用相同数据集的评分，避免重复推理。工具不会自动修改生产设置。

校准完成后通过 PATCH 保存 `{"minSimilarity":<阈值>}`。不要用验证集继续调阈值后仍称其为独立验证。照片、标注、原始评分和 API Key 留在私有目录，不加入 Git。

最终验收使用 `evaluate_api.py`，直接调用 CyberOS 的混合检索接口，遍历全部分页并核对总数、筛选统计、重复项和模型版本。使用独立、完整标注的测试图库，`images[].id` 必须对应该图库的实际资产 ID；查询可以附带 `filters`。工具不保存设置，也不修改生产图库：

```bash
python evaluate_api.py dataset.json --base-url http://127.0.0.1:3010 \
  --split validation --output hybrid-validation.json
```

报告同时提供前十项相关率、前十项召回率、完整结果召回率、正例空结果率、负例误命中率和首屏 P95。相关率按实际返回的前十项计算，正例空结果记零；必须结合召回率判断，不能靠只返回极少结果宣称质量提高。

降维比较使用 `evaluate_dimensions.py dataset.json captured-vectors.json --output dimensions.json`。捕获文件包含完整 2048 维的 `model`、`profile`、`images` 和 `texts`；键分别为资产 ID 和查询文本。每个维度先截取前缀再归一化，分别用校准集选择阈值。服务可在 profile 中配置 64–2048 维，生成独立 `embeddingSpaceId`，默认仍为 2048。比较属于探索实验，选择维度后需要新的独立 API 验证，不能把同一份验证集用于反复挑选模型。

十万向量的隔离精确检索基准：

```bash
npm run build -w @cyberos/api
node --max-old-space-size=128 --max-semi-space-size=8 \
  packages/api/dist/photos-search-benchmark.js /新建的隔离目录 100000
# 只重用该工具创建的 synthetic benchmark 数据库，不接受生产数据库
node --max-old-space-size=128 --max-semi-space-size=8 \
  packages/api/dist/photos-search-benchmark.js /同一个隔离目录 100000 --reuse
# 新建降维数据库；加入历史模型向量并测试 1% 相机筛选
node --max-old-space-size=128 --max-semi-space-size=16 \
  packages/api/dist/photos-search-benchmark.js /另一个新目录 100000 \
  --dimensions 512 --history 100000 --filtered
# 部分覆盖用独立新目录和 --partial；重用时携带相同的场景参数
npm run test:photos-browser
```

工具断言每次返回完整预期结果（全覆盖十万项，筛选或部分覆盖按对应数量），包含排序、分页首屏和统计计算，预热两次后测量 20 次。服务 reader thread 限制 V8 old heap 128 MiB、young heap 16 MiB，避免向量查询挤占 API 的 512 MiB 单元预算。

2026-11-05 的阶段性实测（样本仅 30 张，校准与验证各 8 条正例、10 条负例）：

| 验证 | 实际结果与边界 |
| --- | --- |
| 流水线 2 官方对照 | 两条中文文本、一张图片与固定 PyTorch 参考输出的余弦一致度分别 0.999872、0.999852、0.999253；通过 0.99 门槛；图文切换后重复文本稳定 |
| 流水线 2 阈值校准 | 仅校准集选择 0.3065485754501079；相关率 100%、召回率 91.67%、负例误命中 10% |
| 最终混合 API 独立验证 | 相关率 52.08%、召回率 77.08%、正例空结果 12.5%、负例误命中 0%；所有分页、总数、筛选统计与当前空间一致；未达到 80% 目标 |
| 最终混合 API 延迟 | 30 张测试库，验证查询首屏 P95 约 343 毫秒；不代表十万张性能 |
| CyberMachine 十万 2048D，旧库 | 优化前 P95 11.49 秒；优化后完整十万项，20 次热查询 P50 3.38 秒、P95 3.53 秒、峰值约 276 MiB；旧合成库没有元数据行 |
| CyberMachine 十万 2048D，含元数据及十万历史向量 | 完整十万项，20 次热查询 P50 6.82 秒、P95 10.29 秒、峰值约 271 MiB；宽结果集和历史空间下仍未达标 |
| 同一 2048D 库，1% 相机筛选 | 完整 1000 项，20 次热查询 P95 约 513 毫秒、峰值约 91 MiB |
| CyberMachine 十万 512D，含元数据及十万历史向量 | 完整十万项，20 次热查询 P50 4.99 秒、P95 5.06 秒、峰值约 283 MiB；不同库不能直接推断降维加速比例 |
| 同一 512D 库，1% 相机筛选 | 完整 1000 项，20 次热查询 P95 约 499 毫秒、峰值约 96 MiB |

降维探索对每个维度分别校准阈值并归一化：256D、512D 的验证相关率均为 62.5%，1024D 为 56.25%，2048D 为 52.08%，召回率均为 77.08%；256D 的负例误命中为 10%，其余为 0。各维度均未达到质量门槛，默认继续使用 2048D。这份验证集已用于比较，后续选维度需要新的独立验证数据。

以上结果仍未满足十万张热查询 P95 ≤1 秒及相关率 ≥80% 的上线门槛。生产图库保持智能搜索关闭，不启动全库补建。旧流水线的 68.75% 相关率、旧阈值和吞吐记录仅为历史测量，不能作为流水线 2 的验收结果。

CyberMachine 测试使用隔离的合成数据库和本机 Linux ARM64 扩展，生产服务保持运行。设备未启用 memory cgroup controller，测试请求的 systemd MemoryMax 不构成有效内存上限；128 MiB V8 old heap 仍然生效，峰值取进程实际资源使用。两次预热不能保证其他生产负载下的全部向量始终驻留内存，因此该值应视为设备实测，不能归因于单独的模型或 SQLite 算力。

这些结果不能证明全库检索质量或十万规模的端到端 P95。当前精确检索在这台设备上没有达到方案速度目标，不应按目标速度宣称全量上线验收通过。十万张仅按样本推理速度外推约 36 小时，实际上线时使用设备的持续吞吐更新估算。

## CyberMachine 升级

本功能增加 npm 原生扩展、migration 011/012 和 systemd unit，必须使用 [CyberMachine 包升级流程](/docs/operations/cybermachine/#升级保留与回滚)，不能使用快速组件替换。先构建和验证 Linux amd64/arm64 包，再停止全部状态写入者和 timers，备份旧包、SQLite/WAL、配置、状态及服务启用状态。不要备份正在写入的 SQLite 目录。

升级后先启动 API 完成 migration，再启动 `cyberos-photos-embeddings.service` 和此前启用的常驻服务，最后恢复 timers。验证普通扫描、浏览、文字检索、真实图文查询、覆盖率和 journal；`/health` 成功不能代替这些检查。回滚 migration 需要匹配的旧包和状态备份。
