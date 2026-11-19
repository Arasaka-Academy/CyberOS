# packages/worker/src/
> L2 | Parent: ../../../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
agent-context.test.ts: agent-context 的行为与契约验证。
agent-context.ts: 有界上下文投影；隔离审批、凭据摘要与秘密。
index.ts: 启动作业、命令和独立通知轮询，取消网络后等待资源关闭。
notifications.ts: 领取通知租约；DNS 后重查观察与审批状态，加密发送和有界重试。
notifications.test.ts: 验证投递、偏好抑制、失效订阅和退避。
photos-embedding-processor.ts: 公开 readPhotosEmbeddingPreview, processPhotosEmbeddingTick。
photos-embeddings.test.ts: photos-embeddings 的行为与契约验证。
photos-embeddings.ts: photos-embeddings 模块入口或运行脚本。
processor.test.ts: processor 的行为与契约验证。
processor.ts: worker 作业执行；关联能力运行并原子提交终态通知。

[PROTOCOL]: Update this header on change, then check AGENTS.md
