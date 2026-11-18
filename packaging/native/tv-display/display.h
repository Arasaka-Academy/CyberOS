/* [INPUT]: Weston 10/13/14 与 idle.h 的显示策略。
 * [OUTPUT]: 原生模块内部接口；IPC、输入与视图共享此上下文。
 * [POS]: 跨文件边界，不向 Wayland 客户端暴露协议。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#ifndef TV_DISPLAY_H
#define TV_DISPLAY_H
#define _GNU_SOURCE
#include <libweston/libweston.h>
#include <libweston/version.h>
#if WESTON_VERSION_MAJOR == 10
#include <libweston-desktop/libweston-desktop.h>
#else
#include <libweston/desktop.h>
#endif
#include "idle.h"
#define TV_SOCKET "/run/cyberos-tv/display.sock"
struct tv_display {
 struct weston_compositor *compositor;
 struct weston_seat *virtual_seat;
 struct tv_idle idle;
 struct weston_layer layer;
 struct weston_view *overlay;
 struct wl_list surfaces, seats, clients;
 struct wl_listener created, destroyed, seat_created;
 struct wl_event_source *timer, *server;
 int server_fd, reply_fd;
 enum tv_state applied;
 bool rendering, changing, hardware, input_failed;
 char snapshot[256];
};
uint64_t tv_now(void);
void tv_apply(struct tv_display *);
void tv_snapshot(struct tv_display *, char *, size_t);
void tv_broadcast(struct tv_display *);
int tv_ipc_init(struct tv_display *);
void tv_ipc_fini(struct tv_display *);
void tv_views_init(struct tv_display *);
void tv_views_update(struct tv_display *);
void tv_views_fini(struct tv_display *);
int tv_input_init(struct tv_display *);
bool tv_input_held(struct tv_display *);
void tv_input_update(struct tv_display *);
void tv_input_fini(struct tv_display *);
bool tv_key_allowed(unsigned int);
void tv_input_key(struct tv_display *, unsigned int, unsigned int);
#endif
