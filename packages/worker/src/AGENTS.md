# packages/worker/src/
> L2 | Parent: ../../../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
agent-context.test.ts: agent-context 的行为与契约验证。
agent-context.ts: 有界上下文投影；隔离审批、凭据摘要与秘密。
index.ts: 启动 worker 轮询和资源关闭流程。
photos-embedding-processor.ts: 公开 readPhotosEmbeddingPreview, processPhotosEmbeddingTick。
photos-embeddings.test.ts: photos-embeddings 的行为与契约验证。
photos-embeddings.ts: photos-embeddings 模块入口或运行脚本。
processor.test.ts: processor 的行为与契约验证。
processor.ts: worker 作业执行；关联能力运行并执行当前授权策略。

[PROTOCOL]: Update this header on change, then check AGENTS.md
