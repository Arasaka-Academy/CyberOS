/* [INPUT]: 原生输入适配器与合成器接口测试替身。
 * [OUTPUT]: 首次按下、重复、释放及触摸手势吞噬回归验证。
 * [POS]: 不连接显示设备的输入策略测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#include "input.c"
#include <assert.h>
static unsigned int forwarded, modifiers_forwarded;
static uint64_t simulated_now = 100;
uint64_t tv_now(void) { return simulated_now; }
void tv_apply(struct tv_display *display) { (void)display; }
static void forwarded_key(struct weston_keyboard_grab *g, const struct timespec *t,
 uint32_t code, uint32_t state) { (void)g; (void)t; (void)code; (void)state; forwarded++; }
static void forwarded_modifiers(struct weston_keyboard_grab *g, uint32_t serial,
 uint32_t depressed, uint32_t latched, uint32_t locked, uint32_t group) {
 (void)g; (void)serial; (void)depressed; (void)latched; (void)locked; (void)group;
 modifiers_forwarded++;
}
static void forwarded_button(struct weston_pointer_grab *g, const struct timespec *t,
 uint32_t code, uint32_t state) { (void)g; (void)t; (void)code; (void)state; forwarded++; }
static void forwarded_down(struct weston_touch_grab *g, const struct timespec *t, int id, TOUCH_ARGS) {
 (void)g; (void)t; (void)id;
#if WESTON_VERSION_MAJOR == 10
 (void)x; (void)y;
#else
 (void)pos;
#endif
 forwarded++;
}
static void forwarded_up(struct weston_touch_grab *g, const struct timespec *t, int id) {
 (void)g; (void)t; (void)id; forwarded++;
}
int main(void) {
 struct tv_display d = {0}; struct tv_seat s = {.display=&d}; struct timespec time = {0};
 wl_list_init(&d.seats); wl_list_insert(&d.seats, &s.link);
 const struct weston_keyboard_grab_interface ki = {.key=forwarded_key,.modifiers=forwarded_modifiers};
 struct weston_keyboard k = {0}; k.default_grab.interface = &ki; s.keyboard.keyboard = &k;
 d.idle.state=TV_OFF;
 key(&s.keyboard,&time,KEY_ENTER,1); key(&s.keyboard,&time,KEY_ENTER,1);
 modifiers(&s.keyboard,0,1,0,0,0); assert(modifiers_forwarded == 0);
 key(&s.keyboard,&time,KEY_UP,1); key(&s.keyboard,&time,KEY_ENTER,0);
 key(&s.keyboard,&time,KEY_UP,0); assert(forwarded == 0);
 modifiers(&s.keyboard,0,0,0,0,0); assert(modifiers_forwarded == 1);
 key(&s.keyboard,&time,KEY_ENTER,1); key(&s.keyboard,&time,KEY_ENTER,0); assert(forwarded == 2);
 const struct weston_pointer_grab_interface pi = {.button=forwarded_button};
 struct weston_pointer p = {0}; p.default_grab.interface=&pi; s.pointer.pointer=&p;
 d.idle.state=TV_SAVER; button(&s.pointer,&time,BTN_LEFT,1); button(&s.pointer,&time,BTN_LEFT,0);
 assert(forwarded == 2);
 button(&s.pointer,&time,BTN_LEFT,1); button(&s.pointer,&time,BTN_LEFT,0); assert(forwarded == 4);
 const struct weston_touch_grab_interface ti = {.down=forwarded_down,.up=forwarded_up};
 struct weston_touch t = {0}; t.default_grab.interface=&ti; s.touch.touch=&t;
 d.idle.state=TV_OFF;
#if WESTON_VERSION_MAJOR == 10
 down(&s.touch,&time,1,0,0); down(&s.touch,&time,2,0,0);
#else
 struct weston_coord_global pos={0}; down(&s.touch,&time,1,pos); down(&s.touch,&time,2,pos);
#endif
 up(&s.touch,&time,1); up(&s.touch,&time,2); assert(forwarded == 4);
 /* 仅 socket 按住状态超时；缺少 release 后的新手势重新交付。 */
 s.synthetic[KEY_ENTER] = true; s.synthetic_at[KEY_ENTER] = simulated_now;
 s.keyboard_wake = true;
 assert(tv_input_held(&d)); simulated_now += 9999; assert(tv_input_held(&d));
 /* 其他键的事件不延长孤立 Enter 的租约。 */
 s.synthetic[KEY_UP] = true; s.synthetic_at[KEY_UP] = simulated_now;
 simulated_now += 2; assert(tv_input_held(&d)); assert(!s.synthetic[KEY_ENTER]);
 simulated_now += 10000; assert(!tv_input_held(&d)); assert(!s.keyboard_wake);
 unsigned int before = forwarded;
 key(&s.keyboard,&time,KEY_ENTER,1); key(&s.keyboard,&time,KEY_ENTER,0);
 assert(forwarded == before + 2);
 /* 真实物理长按不使用 socket 超时，也不提前结束唤醒手势。 */
 s.keys[KEY_ENTER] = true; s.keyboard_wake = true;
 s.synthetic[KEY_UP] = true; s.synthetic_at[KEY_UP] = simulated_now;
 simulated_now += 10001; assert(!tv_input_held(&d));
 assert(s.keys[KEY_ENTER] && s.keyboard_wake);
 before = forwarded; key(&s.keyboard,&time,KEY_ENTER,0); assert(forwarded == before);
 key(&s.keyboard,&time,KEY_ENTER,1); key(&s.keyboard,&time,KEY_ENTER,0);
 assert(forwarded == before + 2);
 assert(tv_key_allowed(KEY_ENTER) && !tv_key_allowed(KEY_POWER));
 return 0;
}
