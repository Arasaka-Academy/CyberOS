/* [INPUT]: headless Weston 的测试输出。
 * [OUTPUT]: 可记录的 DPMS 回调，仅供容器集成测试。
 * [POS]: 测试夹具，不进入 Debian 包。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#define _POSIX_C_SOURCE 200809L
#include <libweston/libweston.h>
#include <stdlib.h>
#include <string.h>
struct seat_capture {
 struct wl_listener caps, destroyed;
 struct weston_seat *seat;
 struct weston_keyboard_grab_interface interface;
 const struct weston_keyboard_grab_interface *original;
};
static struct seat_capture capture;
static struct wl_listener seat_created;
static void recorded_key(struct weston_keyboard_grab *grab, const struct timespec *time,
 uint32_t code, uint32_t state) {
 weston_log("TV_TEST_KEY %u %u\n", code, state);
 capture.original->key(grab, time, code, state);
}
static void caps(struct wl_listener *listener, void *data) {
 (void)listener; (void)data;
 struct weston_keyboard *keyboard = weston_seat_get_keyboard(capture.seat);
 if (!keyboard || capture.original) return;
 capture.original = keyboard->default_grab.interface;
 capture.interface = *capture.original; capture.interface.key = recorded_key;
 keyboard->default_grab.interface = &capture.interface;
}
static void seat_destroyed(struct wl_listener *listener, void *data) {
 (void)listener; (void)data;
 wl_list_remove(&capture.caps.link); wl_list_remove(&capture.destroyed.link);
}
static void created(struct wl_listener *listener, void *data) {
 (void)listener; capture.seat = data; capture.caps.notify = caps;
 capture.destroyed.notify = seat_destroyed;
 wl_signal_add(&capture.seat->updated_caps_signal, &capture.caps);
 wl_signal_add(&capture.seat->destroy_signal, &capture.destroyed);
}
static void power(struct weston_output *output, enum dpms_enum level) {
 (void)output; weston_log("TV_TEST_DPMS %d\n", level);
}
WL_EXPORT int wet_module_init(struct weston_compositor *c, int *argc, char *argv[]) {
 (void)argc; (void)argv; struct weston_output *o;
 seat_created.notify = created; wl_signal_add(&c->seat_created_signal, &seat_created);
 wl_list_for_each(o, &c->output_list, link) {
  free(o->name); o->name = strdup("HDMI-A-1"); o->set_dpms = power;
 }
 return 0;
}
