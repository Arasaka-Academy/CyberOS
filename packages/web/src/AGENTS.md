# packages/web/src/
> L2 | Parent: ../../../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
App.tsx: 应用状态和页面组合；跨页面照片上传、通知直达与本轮工具摘要。
api.test.ts: 请求契约、照片上传字节进度与错误传播回归。
api.ts: 第一方 REST 客户端；共用二进制上传、下载分页与独立凭据提交。
boot.test.ts: boot 的行为与契约验证。
file-type-utils.test.ts: file-type-utils 的行为与契约验证。
file-type-utils.ts: 公开 FileVisualKind, FileVisualInput, FileVisualDescriptor, FILE_TYPE_LABELS 等接口。
main.tsx: React 挂载入口。
preview-utils.test.ts: preview-utils 的行为与契约验证。
preview-utils.ts: 公开 StructuredPreviewKind, DelimitedPreviewDelimiter, TextPreviewDescriptor, HighlightedSource 等接口。
styles.css: Web 样式分层入口；下载多选等交互适配位于 app 层。
vite-env.d.ts: vite-env.d 模块入口或运行脚本。
components/: React 页面与界面组件。
config/: 表单默认值和界面配置。
i18n/: 语言资源和格式化。
lib/: 领域服务与 API 适配器。
mobile/: 手机导航与布局。
styles/: 视觉样式。
tv/: tv 子模块。

[PROTOCOL]: Update this header on change, then check AGENTS.md
