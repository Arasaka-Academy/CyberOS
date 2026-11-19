# packages/web/src/tv/
> L2 | Parent: ../AGENTS.md

TV 独立入口复用共享播放会话。
原生模块决定待机、屏保和息屏。
页面只提交渲染就绪并显示快照。

成员列表
AGENTS.md: TV 页面与接口地图。
AppearanceDialog.tsx: TV 外观选择与原生播放器主题同步。
FilterDialog.tsx: 媒体库筛选弹窗。
LibraryScreen.tsx: 首页、分类与合集浏览组合。
MediaCard.tsx: 遥控可聚焦的媒体封面。
SearchOverlay.tsx: 媒体搜索与拼音输入层。
TitleDetail.tsx: 标题详情、选集和播放操作。
TvApp.tsx: TV 主题与共享播放 Provider 入口。
TvApp.test.ts: TV 入口与原生待机架构验证。
TvLibrary.tsx: TV 外壳；保留浏览位置并切换 HDMI 音乐页面。
TvMusicPlayer.tsx: 全屏音乐、歌词、队列与既有播放命令。
TvMusicPlayer.test.ts: 音乐页面内容和播放状态渲染验证。
TvPlaybackDock.tsx: 播放恢复入口与视频控制弹窗。
TvScreensaver.tsx: 屏保内容与 DOM 提交握手；计时回退解除遮挡下的帧等待。
TvScreensaverMedia.tsx: 图片和静音视频轮播、故障跳过与卸载资源释放。
TvScreensaver.test.ts: 待机内容、目录回退与息屏卸载验证。
api.ts: TV 媒体、显示状态、屏保素材与渲染接口。
library-model.ts: 媒体视图、过滤与恢复位置计算。
library-model.test.ts: 媒体浏览模型验证。
main.tsx: TV 挂载、语言与外观初始化。
music-screen.ts: HDMI 确认后进入音乐页面；切歌的未知路由保留现有页面。
music-screen.test.ts: HDMI 自动进入、暂停保留与退出验证。
pinyin-ime.d.ts: 拼音输入库类型边界。
pinyin-ime-tooltip.ts: 搜索输入帮助的生命周期。
pinyin-ime-tooltip.test.ts: 输入帮助状态验证。
player-controls.ts: 视频遥控命令与手柄连接转换。
player-controls.test.ts: 视频遥控与手柄状态验证。
remote-navigation.ts: 空间焦点、返回、主页与媒体按键分发。
tv.css: TV 分层样式组合入口。
useTvDisplay.ts: TV 显示事件订阅与断流恢复。
useTvPlayback.ts: 媒体播放、会话版本与接管确认。
styles/: TV 主题尺度与功能样式。

[PROTOCOL]: Update this header on change, then check AGENTS.md
