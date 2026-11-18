/* [INPUT]: idle.h 的原生策略状态机。
 * [OUTPUT]: 验证租约、渲染就绪、独立计时与唤醒。
 * [POS]: 不依赖 Weston 的确定性回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#include "idle.h"
#include <assert.h>
int main(void) {
 struct tv_idle s; tv_idle_init(&s, 100);
 assert(tv_idle_tick(&s, 200) == TV_ACTIVE && !s.supported);
 tv_idle_policy(&s, 1000, 3000, 200); tv_idle_playback(&s, false, 200);
 s.renderer = true;
 assert(tv_idle_tick(&s, 1200) == TV_SAVER);
 tv_idle_policy(&s, 1000, 3000, 1300);
 assert(tv_idle_tick(&s, 3200) == TV_OFF);
 tv_idle_activity(&s, 3300); assert(s.state == TV_ACTIVE);
 tv_idle_playback(&s, true, 3400); assert(tv_idle_tick(&s, 7000) == TV_ACTIVE);
 tv_idle_playback(&s, false, 7100); assert(tv_idle_tick(&s, 8000) == TV_ACTIVE);
 assert(tv_idle_tick(&s, 8200) == TV_SAVER);
 tv_idle_policy(&s, 0, 3000, 8300); assert(s.state == TV_ACTIVE);
 assert(tv_idle_tick(&s, 11400) == TV_OFF);
 assert(tv_idle_tick(&s, 17200) == TV_ACTIVE && !s.supported);
 tv_idle_policy(&s, 1000, 0, 18000); tv_idle_playback(&s, false, 18000);
 s.renderer = false; assert(tv_idle_tick(&s, 20000) == TV_SAVER);
 s.renderer = true; assert(tv_idle_tick(&s, 20001) == TV_SAVER);
 return 0;
}
