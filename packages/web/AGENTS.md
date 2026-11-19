# packages/web/
> L2 | Parent: ../../AGENTS.md

React 19 + TypeScript + Vite 7。
主 Web 与 TV 使用独立入口和共享播放状态。

成员列表
AGENTS.md: Web 工作区地图。
README.md: Web 架构与开发说明。
index.html: 主 Web 启动骨架与主题预载。
package.json: Web 构建命令与工作区依赖；TanStack Virtual 限制长列表挂载数。
tsconfig.json: Web 严格类型检查范围。
vite.config.ts: 主 Web 与 TV 双入口构建及开发 API 代理。
test-tv-idle-browser.mjs: Chromium 验证 TV 音乐、无帧回调握手和设置草稿。
test-tv-video-screensaver-browser.mjs: Chromium 验证真实静音视频轮播、故障回退和息屏释放。
src/: Web 页面、领域组件与 TV 独立外壳。
tv/: TV HTML 入口。
public/: 图标与静态资源。
docs/: 本地文档补充材料。

[PROTOCOL]: Update this header on change, then check AGENTS.md
