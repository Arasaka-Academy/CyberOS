/* [INPUT]: Weston 座席与白名单 evdev 键；不创建虚拟键盘协议。
 * [OUTPUT]: 闲置活动与完整首次唤醒手势吞噬；活动时转发默认 grab。
 * [POS]: 统一物理键鼠触摸、CEC 与手柄的输入边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#include "display.h"
#include <linux/input-event-codes.h>
#include <stdlib.h>
#include <string.h>
/* 这些导出 ABI 在 10/13/14 中签名相同；开发包未安装内部声明。 */
extern void weston_seat_init(struct weston_seat *, struct weston_compositor *, const char *);
extern int weston_seat_init_keyboard(struct weston_seat *, struct xkb_keymap *);
extern void weston_seat_release_keyboard(struct weston_seat *);
extern void weston_seat_release(struct weston_seat *);
struct tv_seat {
 struct wl_list link;
 struct tv_display *display;
 struct weston_seat *seat;
 struct weston_keyboard_grab keyboard;
 struct weston_pointer_grab pointer;
 struct weston_touch_grab touch;
 struct wl_listener destroyed;
 bool synthetic[KEY_MAX + 1];
 uint64_t synthetic_at[KEY_MAX + 1];
 bool keys[KEY_MAX + 1], keyboard_wake, frame_wake;
 unsigned int buttons, touches;
 bool pointer_wake, touch_wake, keyboard_reference;
};
static bool activity(struct tv_seat *s) {
 bool wake = s->display->idle.state != TV_ACTIVE;
 tv_idle_activity(&s->display->idle, tv_now()); tv_apply(s->display);
 return wake;
}
bool tv_key_allowed(unsigned int key) {
 switch (key) {
 case KEY_UP: case KEY_DOWN: case KEY_LEFT: case KEY_RIGHT:
 case KEY_ENTER: case KEY_ESC: case KEY_PLAYPAUSE: case KEY_STOPCD:
 case KEY_A: case KEY_S: case KEY_F6: case KEY_F7: case KEY_F8:
 case KEY_F9: case KEY_F10: return true;
 default: return false;
 }
}
static bool consume_key(struct tv_seat *s) {
 if (activity(s)) s->keyboard_wake = true;
 bool consume = s->keyboard_wake;
 bool held = false;
 for (unsigned int key_code = 0; key_code <= KEY_MAX; key_code++)
  held |= s->keys[key_code] || s->synthetic[key_code];
 if (!held) s->keyboard_wake = false;
 return consume;
}
static void key(struct weston_keyboard_grab *grab, const struct timespec *time,
                uint32_t code, uint32_t state) {
 struct tv_seat *s = wl_container_of(grab, s, keyboard);
 if (code > KEY_MAX) return;
 s->keys[code] = state != 0;
 if (consume_key(s)) return;
 struct weston_keyboard_grab *g = &grab->keyboard->default_grab;
 g->interface->key(g, time, code, state);
}
static void modifiers(struct weston_keyboard_grab *grab, uint32_t serial,
 uint32_t depressed, uint32_t latched, uint32_t locked, uint32_t group) {
 struct tv_seat *s = wl_container_of(grab, s, keyboard);
 if (s->display->idle.state != TV_ACTIVE || s->keyboard_wake) return;
 struct weston_keyboard_grab *g = &grab->keyboard->default_grab;
 g->interface->modifiers(g, serial, depressed, latched, locked, group);
}
static void keyboard_cancel(struct weston_keyboard_grab *grab) { (void)grab; }
static const struct weston_keyboard_grab_interface keyboard_interface = {
 .key = key, .modifiers = modifiers, .cancel = keyboard_cancel
};
static void focus(struct weston_pointer_grab *grab) {
 struct tv_seat *s = wl_container_of(grab, s, pointer);
 if (s->display->idle.state != TV_ACTIVE) return;
 struct weston_pointer_grab *g = &grab->pointer->default_grab;
 g->interface->focus(g);
}
static void motion(struct weston_pointer_grab *grab, const struct timespec *time,
 struct weston_pointer_motion_event *event) {
 struct tv_seat *s = wl_container_of(grab, s, pointer);
 if (activity(s)) s->frame_wake = true;
 if (s->frame_wake || s->pointer_wake) return;
 struct weston_pointer_grab *g = &grab->pointer->default_grab;
 g->interface->motion(g, time, event);
}
static void button(struct weston_pointer_grab *grab, const struct timespec *time,
 uint32_t code, uint32_t state) {
 struct tv_seat *s = wl_container_of(grab, s, pointer);
 if (state) s->buttons++; else if (s->buttons) s->buttons--;
 if (activity(s)) s->pointer_wake = true;
 bool consume = s->pointer_wake;
 if (!s->buttons) s->pointer_wake = false;
 if (consume) return;
 struct weston_pointer_grab *g = &grab->pointer->default_grab;
 g->interface->button(g, time, code, state);
}
static void axis(struct weston_pointer_grab *grab, const struct timespec *time,
 struct weston_pointer_axis_event *event) {
 struct tv_seat *s = wl_container_of(grab, s, pointer);
 if (activity(s)) s->frame_wake = true;
 if (s->frame_wake || s->pointer_wake) return;
 struct weston_pointer_grab *g = &grab->pointer->default_grab;
 g->interface->axis(g, time, event);
}
static void source(struct weston_pointer_grab *grab, uint32_t value) {
 struct tv_seat *s = wl_container_of(grab, s, pointer);
 if (s->display->idle.state != TV_ACTIVE || s->pointer_wake) return;
 struct weston_pointer_grab *g = &grab->pointer->default_grab;
 g->interface->axis_source(g, value);
}
static void pointer_frame(struct weston_pointer_grab *grab) {
 struct tv_seat *s = wl_container_of(grab, s, pointer);
 if (s->frame_wake) { s->frame_wake = false; return; }
 if (s->display->idle.state != TV_ACTIVE || s->pointer_wake) return;
 struct weston_pointer_grab *g = &grab->pointer->default_grab;
 g->interface->frame(g);
}
static void pointer_cancel(struct weston_pointer_grab *grab) { (void)grab; }
static const struct weston_pointer_grab_interface pointer_interface = {
 .focus=focus, .motion=motion, .button=button, .axis=axis,
 .axis_source=source, .frame=pointer_frame, .cancel=pointer_cancel
};
#if WESTON_VERSION_MAJOR == 10
#define TOUCH_ARGS wl_fixed_t x, wl_fixed_t y
#define TOUCH_PASS x, y
#else
#define TOUCH_ARGS struct weston_coord_global pos
#define TOUCH_PASS pos
#endif
static void down(struct weston_touch_grab *grab, const struct timespec *time,
 int id, TOUCH_ARGS) {
 struct tv_seat *s = wl_container_of(grab, s, touch);
 s->touches++;
 if (activity(s)) s->touch_wake = true;
 if (s->touch_wake) return;
 struct weston_touch_grab *g = &grab->touch->default_grab;
 g->interface->down(g, time, id, TOUCH_PASS);
}
static void up(struct weston_touch_grab *grab, const struct timespec *time, int id) {
 struct tv_seat *s = wl_container_of(grab, s, touch);
 if (s->touches) s->touches--;
 bool consume = s->touch_wake;
 if (!s->touches) s->touch_wake = false;
 activity(s);
 if (consume) return;
 struct weston_touch_grab *g = &grab->touch->default_grab;
 g->interface->up(g, time, id);
}
static void touch_motion(struct weston_touch_grab *grab, const struct timespec *time,
 int id, TOUCH_ARGS) {
 struct tv_seat *s = wl_container_of(grab, s, touch);
 if (activity(s)) s->touch_wake = true;
 if (s->touch_wake) return;
 struct weston_touch_grab *g = &grab->touch->default_grab;
 g->interface->motion(g, time, id, TOUCH_PASS);
}
static void touch_frame(struct weston_touch_grab *grab) {
 struct tv_seat *s = wl_container_of(grab, s, touch);
 if (s->touch_wake || s->display->idle.state != TV_ACTIVE) return;
 struct weston_touch_grab *g = &grab->touch->default_grab;
 g->interface->frame(g);
}
static void touch_cancel(struct weston_touch_grab *grab) {
 struct tv_seat *s = wl_container_of(grab, s, touch);
 s->touches = 0; s->touch_wake = false;
}
static const struct weston_touch_grab_interface touch_interface = {
 .down=down, .up=up, .motion=touch_motion, .frame=touch_frame, .cancel=touch_cancel
};
static void removed(struct wl_listener *listener, void *data) {
 struct tv_seat *s = wl_container_of(listener, s, destroyed);
 /* seat 的 destroy_signal 发生在设备对象释放后，禁止再解引用它们。 */
 if (!data) {
  struct weston_keyboard *k = weston_seat_get_keyboard(s->seat);
  struct weston_pointer *p = weston_seat_get_pointer(s->seat);
  struct weston_touch *t = weston_seat_get_touch(s->seat);
  if (k && k->grab == &s->keyboard) weston_keyboard_end_grab(k);
  if (p && p->grab == &s->pointer) weston_pointer_end_grab(p);
  if (t && t->grab == &s->touch) weston_touch_end_grab(t);
  if (s->keyboard_reference) weston_seat_release_keyboard(s->seat);
 }
 wl_list_remove(&s->destroyed.link); wl_list_remove(&s->link); free(s);
}
static void created(struct wl_listener *listener, void *data) {
 struct tv_display *d = wl_container_of(listener, d, seat_created);
 struct tv_seat *s = calloc(1, sizeof *s);
 if (!s) { d->input_failed = true; return; }
 s->display = d; s->seat = data;
 if (weston_seat_init_keyboard(s->seat, NULL) < 0) {
  d->input_failed = true; free(s); return;
 }
 s->keyboard_reference = true;
 s->keyboard.interface = &keyboard_interface;
 s->pointer.interface = &pointer_interface; s->touch.interface = &touch_interface;
 s->destroyed.notify = removed; wl_signal_add(&s->seat->destroy_signal, &s->destroyed);
 wl_list_insert(&d->seats, &s->link);
}
bool tv_input_held(struct tv_display *d) {
 struct tv_seat *s; bool held = false;
 uint64_t now = tv_now();
 wl_list_for_each(s, &d->seats, link) {
  bool synthetic = false, physical = false;
  for (unsigned int code = 0; code <= KEY_MAX; code++) {
   if (s->synthetic[code] && now - s->synthetic_at[code] >= 10000)
    s->synthetic[code] = false;
   synthetic |= s->synthetic[code]; physical |= s->keys[code];
  }
  if (!synthetic && !physical) s->keyboard_wake = false;
  held |= synthetic;
 }
 return held;
}
void tv_input_update(struct tv_display *d) {
 if (wl_list_empty(&d->seats) && !d->virtual_seat) {
  d->virtual_seat = calloc(1, sizeof *d->virtual_seat);
  if (d->virtual_seat) weston_seat_init(d->virtual_seat, d->compositor, "cyberos-tv");
  else d->input_failed = true;
 }
 struct tv_seat *s;
 wl_list_for_each(s, &d->seats, link) {
  struct weston_keyboard *k = weston_seat_get_keyboard(s->seat);
  struct weston_pointer *p = weston_seat_get_pointer(s->seat);
  struct weston_touch *t = weston_seat_get_touch(s->seat);
  if (!d->idle.supported || !d->hardware) {
   memset(s->synthetic, 0, sizeof s->synthetic);
   s->pointer_wake = s->touch_wake = s->keyboard_wake = s->frame_wake = false;
   memset(s->keys, 0, sizeof s->keys);
   if (k && k->grab == &s->keyboard) weston_keyboard_end_grab(k);
   if (p && p->grab == &s->pointer) weston_pointer_end_grab(p);
   if (t && t->grab == &s->touch) weston_touch_end_grab(t);
  } else {
   if (k && k->grab == &k->default_grab) weston_keyboard_start_grab(k, &s->keyboard);
   if (p && p->grab == &p->default_grab) weston_pointer_start_grab(p, &s->pointer);
   if (t && t->grab == &t->default_grab) weston_touch_start_grab(t, &s->touch);
  }
 }
}
void tv_input_key(struct tv_display *d, unsigned int code, unsigned int state) {
 if (!tv_key_allowed(code)) return;
 struct tv_seat *s, *selected = NULL;
 wl_list_for_each(s, &d->seats, link) {
  struct weston_keyboard *keyboard = weston_seat_get_keyboard(s->seat);
  if (keyboard && s->synthetic[code]) { selected = s; break; }
  if (keyboard && (!selected || keyboard->focus)) selected = s;
 }
 if (selected) {
  s = selected;
  struct weston_keyboard *k = weston_seat_get_keyboard(s->seat);
  s->keyboard.keyboard = k;
  s->synthetic[code] = state != 0;
  s->synthetic_at[code] = tv_now();
  struct timespec time; clock_gettime(CLOCK_MONOTONIC, &time);
  if (!consume_key(s) && state) {
   /* 输入桥保留真实按住状态；客户端仍接收原有的短按与显式重复。 */
   struct weston_keyboard_grab *g = &k->default_grab;
   g->interface->key(g, &time, code, WL_KEYBOARD_KEY_STATE_PRESSED);
   g->interface->key(g, &time, code, WL_KEYBOARD_KEY_STATE_RELEASED);
  }
  return;
 }
 tv_idle_activity(&d->idle, tv_now()); tv_apply(d);
}
int tv_input_init(struct tv_display *d) {
 wl_list_init(&d->seats); d->seat_created.notify = created;
 wl_signal_add(&d->compositor->seat_created_signal, &d->seat_created);
 if (wl_list_empty(&d->compositor->seat_list)) {
  d->virtual_seat = calloc(1, sizeof *d->virtual_seat);
  if (!d->virtual_seat) return -1;
  weston_seat_init(d->virtual_seat, d->compositor, "cyberos-tv");
 } else {
  struct weston_seat *s;
  wl_list_for_each(s, &d->compositor->seat_list, link) created(&d->seat_created, s);
 }
 tv_input_update(d);
 return d->input_failed ? -1 : 0;
}
void tv_input_fini(struct tv_display *d) {
 struct tv_seat *s, *next;
 wl_list_for_each_safe(s, next, &d->seats, link) removed(&s->destroyed, NULL);
 wl_list_remove(&d->seat_created.link);
 if (d->virtual_seat) {
  weston_seat_release(d->virtual_seat); free(d->virtual_seat); d->virtual_seat = NULL;
 }
}
