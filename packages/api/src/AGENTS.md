# packages/api/src/
> L2 | Parent: ../../../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
context.ts: API 路由和领域服务依赖契约。
errors.ts: 公开 registerErrorHandler。
index.ts: 加载配置并监听 API 服务。
photos-search-benchmark.ts: photos-search-benchmark 模块入口或运行脚本。
production-bundle.test.ts: production-bundle 的行为与契约验证。
server.test.ts: server 的行为与契约验证。
server.ts: API 组合入口；共享原生音频、启动 TV 接屏监测并恢复已授权能力。
state-init.ts: 初始化 state 目录、私有 VAPID 与产品状态。
storage-status.test.ts: storage-status 的行为与契约验证。
web-static.test.ts: web-static 的行为与契约验证。
web-static.ts: Web 与文档静态资源、缓存和导航回退；通知 worker 缺失保持 404。
lib/: 领域服务与 API 适配器。
routes/: HTTP 路由和路由测试。

[PROTOCOL]: Update this header on change, then check AGENTS.md
