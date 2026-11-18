/**
 * [INPUT]: 组合播放控制、媒体存储和版本化协议模块。
 * [OUTPUT]: 提供原生播放服务及共享协议。
 * [POS]: vod-player 的模块入口。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
mod audio_route;
pub mod config;
pub mod controller;
mod display;
pub mod error;
pub mod mpv;
pub mod music;
pub mod preferences;
pub mod progress;
pub mod protocol;
pub mod server;
pub mod session;
pub mod storage;
mod tv_controls;
