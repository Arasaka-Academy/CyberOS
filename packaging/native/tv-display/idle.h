/* [INPUT]: 单调时钟、API 策略与播放器租约。
 * [OUTPUT]: tv_idle 状态机；不执行合成器操作。
 * [POS]: 原生显示策略，供 Weston 适配器与测试调用。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#ifndef TV_IDLE_H
#define TV_IDLE_H
#include <stdbool.h>
#include <stdint.h>
enum tv_state { TV_ACTIVE, TV_SAVER, TV_OFF };
struct tv_idle {
 enum tv_state state;
 uint64_t last_activity, policy_at, playback_at, saver_ms, off_ms;
 bool has_policy, has_playback, playing, renderer, supported;
};
void tv_idle_init(struct tv_idle *, uint64_t);
void tv_idle_activity(struct tv_idle *, uint64_t);
void tv_idle_policy(struct tv_idle *, uint64_t, uint64_t, uint64_t);
void tv_idle_playback(struct tv_idle *, bool, uint64_t);
enum tv_state tv_idle_tick(struct tv_idle *, uint64_t);
#endif
