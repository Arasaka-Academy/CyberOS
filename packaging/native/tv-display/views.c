/* [INPUT]: Chromium 元数据及 surface 创建/提交/销毁信号。
 * [OUTPUT]: 独立屏保视图，覆盖暂停视频而不移动原 shell 视图。
 * [POS]: 展示适配层；保留 shell 焦点及原视图的变换与图层。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#include "display.h"
#include <stdlib.h>
#include <string.h>
struct tracked_surface {
 struct wl_list link;
 struct tv_display *display;
 struct weston_surface *surface;
 struct wl_listener commit, destroy;
 bool tv_surface;
};
static bool is_tv(struct weston_surface *s) {
 if (!weston_surface_is_desktop_surface(s)) return false;
 const char *id = weston_desktop_surface_get_app_id(weston_surface_get_desktop_surface(s));
 return id && strcmp(id, "cyberos-tv") == 0;
}
void tv_views_update(struct tv_display *d) {
 if (d->idle.state != TV_SAVER || !d->idle.renderer || d->overlay) return;
 struct tracked_surface *t;
 wl_list_for_each(t, &d->surfaces, link) {
  struct weston_surface *s = t->surface;
  t->tv_surface = is_tv(s);
  if (!t->tv_surface || s->width <= 0 || s->height <= 0) continue;
  struct weston_output *o;
  if (wl_list_empty(&d->compositor->output_list)) return;
  o = wl_container_of(d->compositor->output_list.next, o, link);
  d->overlay = weston_view_create(s);
  if (!d->overlay) return;
#if WESTON_VERSION_MAJOR == 10
  weston_view_set_position(d->overlay, o->x, o->y);
  weston_layer_entry_insert(&d->layer.view_list, &d->overlay->layer_link);
#else
  weston_view_set_position(d->overlay, o->pos);
  weston_view_move_to_layer(d->overlay, &d->layer.view_list);
#endif
  weston_view_set_output(d->overlay, o);
  d->overlay->is_mapped = true;
  weston_log("CyberOS TV overlay promoted: app-id=%s output=%s\n",
   weston_desktop_surface_get_app_id(weston_surface_get_desktop_surface(s)), o->name);
  weston_view_update_transform(d->overlay);
  weston_surface_damage(s); weston_compositor_damage_all(d->compositor);
  return;
 }
}
static void changed(struct wl_listener *listener, void *data) {
 (void)data; struct tracked_surface *t = wl_container_of(listener, t, commit);
 t->tv_surface = is_tv(t->surface);
 tv_views_update(t->display);
}
static void removed(struct wl_listener *listener, void *data) {
 (void)data; struct tracked_surface *t = wl_container_of(listener, t, destroy);
 bool lost = t->tv_surface;
 if (t->display->overlay && t->display->overlay->surface == t->surface) {
  weston_view_destroy(t->display->overlay); t->display->overlay = NULL; lost = true;
 }
 if (lost) {
  weston_log("CyberOS TV renderer surface disappeared; waking display\n");
  t->display->idle.renderer = false;
  tv_idle_activity(&t->display->idle, tv_now());
 }
 wl_list_remove(&t->commit.link); wl_list_remove(&t->destroy.link);
 wl_list_remove(&t->link); free(t);
}
static void created(struct wl_listener *listener, void *data) {
 struct tv_display *d = wl_container_of(listener, d, created);
 struct tracked_surface *t = calloc(1, sizeof *t);
 if (!t) return;
 t->display = d; t->surface = data;
 t->commit.notify = changed; t->destroy.notify = removed;
 wl_signal_add(&t->surface->commit_signal, &t->commit);
 wl_signal_add(&t->surface->destroy_signal, &t->destroy);
 wl_list_insert(&d->surfaces, &t->link);
}
void tv_views_init(struct tv_display *d) {
 wl_list_init(&d->surfaces);
 weston_layer_init(&d->layer, d->compositor);
 weston_layer_set_position(&d->layer, WESTON_LAYER_POSITION_LOCK);
 d->created.notify = created;
 wl_signal_add(&d->compositor->create_surface_signal, &d->created);
}
void tv_views_fini(struct tv_display *d) {
 if (d->overlay) { weston_view_destroy(d->overlay); d->overlay = NULL; }
 struct tracked_surface *t, *next;
 wl_list_for_each_safe(t, next, &d->surfaces, link) removed(&t->destroy, NULL);
 wl_list_remove(&d->created.link); weston_layer_fini(&d->layer);
}
