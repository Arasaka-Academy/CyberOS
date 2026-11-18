/* [INPUT]: Weston 合成器、显示状态机与本地 IPC。
 * [OUTPUT]: wet_module_init；非 root 的休眠与屏保调度。
 * [POS]: 模块生命周期入口，所有硬件变化均在合成器线程执行。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#include "display.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
uint64_t tv_now(void) {
 struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
 return (uint64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static bool output_supported(struct weston_compositor *compositor) {
 bool found = false;
 struct weston_output *output;
 wl_list_for_each(output, &compositor->output_list, link) {
  if (!output->name || strncmp(output->name, "HDMI-A-", 7) != 0 || !output->set_dpms) return false;
  found = true;
 }
 return found;
}
void tv_snapshot(struct tv_display *d, char *out, size_t size) {
 const char *reason = !d->hardware ? "Dedicated HDMI output power control unavailable" :
  !d->input_failed && !d->idle.supported ? "Policy or playback lease unavailable" :
  d->input_failed ? "Native keyboard capability unavailable" : NULL;
 snprintf(out, size, "{\"state\":\"%s\",\"supported\":%s,\"reason\":%s%s%s}\n",
  d->idle.state == TV_OFF ? "off" : d->idle.state == TV_SAVER ? "screensaver" : "active",
  d->hardware && d->idle.supported && !d->input_failed ? "true" : "false",
  reason ? "\"" : "", reason ? reason : "null", reason ? "\"" : "");
}
void tv_apply(struct tv_display *d) {
 d->changing = true;
 tv_idle_tick(&d->idle, tv_now());
 if (!d->hardware || d->input_failed) d->idle.state = TV_ACTIVE;
 if (d->idle.state == TV_SAVER && d->idle.renderer) {
  tv_views_update(d);
 } else if (d->overlay) {
  weston_log("CyberOS TV overlay removed: state=%d renderer=%d\n", d->idle.state, d->idle.renderer);
  weston_view_destroy(d->overlay); d->overlay = NULL;
  weston_compositor_damage_all(d->compositor);
 }
 if (d->idle.state != d->applied) {
  if (d->idle.state == TV_OFF) weston_compositor_sleep(d->compositor);
  else weston_compositor_wake(d->compositor);
  d->applied = d->idle.state;
 }
 d->changing = false;
 tv_broadcast(d);
}
static int tick(void *data) {
 struct tv_display *d = data;
 d->hardware = output_supported(d->compositor);
 if ((d->compositor->idle_inhibit || tv_input_held(d)) && d->idle.state == TV_ACTIVE)
  tv_idle_activity(&d->idle, tv_now());
 tv_views_update(d); tv_apply(d); tv_input_update(d);
 wl_event_source_timer_update(d->timer, 100);
 return 0;
}
static void destroyed(struct wl_listener *listener, void *data) {
 (void)data; struct tv_display *d = wl_container_of(listener, d, destroyed);
 tv_idle_activity(&d->idle, tv_now());
 weston_compositor_wake(d->compositor);
 tv_input_fini(d); tv_views_fini(d); tv_ipc_fini(d);
 if (d->timer) wl_event_source_remove(d->timer);
 wl_list_remove(&d->destroyed.link); free(d);
}
WL_EXPORT int wet_module_init(struct weston_compositor *compositor, int *argc, char *argv[]) {
 (void)argc; (void)argv;
 struct tv_display *d = calloc(1, sizeof *d);
 if (!d) return -1;
 d->compositor = compositor; d->server_fd = -1;
 tv_idle_init(&d->idle, tv_now());
 d->hardware = output_supported(compositor);
 tv_views_init(d);
 if (tv_input_init(d) < 0) {
  tv_input_fini(d); tv_views_fini(d); free(d); return -1;
 }
 if (tv_ipc_init(d) < 0) {
  tv_input_fini(d); tv_views_fini(d); free(d); return -1;
 }
 d->destroyed.notify = destroyed;
 wl_signal_add(&compositor->destroy_signal, &d->destroyed);
 d->timer = wl_event_loop_add_timer(wl_display_get_event_loop(compositor->wl_display), tick, d);
 if (!d->timer) { destroyed(&d->destroyed, NULL); return -1; }
 wl_event_source_timer_update(d->timer, 100);
 weston_log("CyberOS TV display: Weston ABI %d loaded\n", WESTON_VERSION_MAJOR);
 return 0;
}
