/* [INPUT]: idle.h 的单调时钟与独立租约。
 * [OUTPUT]: 10 秒租约失效时唤醒；相同心跳不重置闲置。
 * [POS]: 显示策略纯函数层，不依赖 Weston。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#include "idle.h"
#include <string.h>
void tv_idle_init(struct tv_idle *s, uint64_t now) {
 memset(s, 0, sizeof *s); s->last_activity = now;
}
void tv_idle_activity(struct tv_idle *s, uint64_t now) {
 s->last_activity = now; s->state = TV_ACTIVE;
}
void tv_idle_policy(struct tv_idle *s, uint64_t saver, uint64_t off, uint64_t now) {
 if (!s->has_policy || s->saver_ms != saver || s->off_ms != off)
  tv_idle_activity(s, now);
 s->saver_ms = saver; s->off_ms = off; s->policy_at = now; s->has_policy = true;
}
void tv_idle_playback(struct tv_idle *s, bool playing, uint64_t now) {
 if (!s->has_playback || s->playing != playing) tv_idle_activity(s, now);
 s->playing = playing; s->playback_at = now; s->has_playback = true;
}
enum tv_state tv_idle_tick(struct tv_idle *s, uint64_t now) {
 s->supported = s->has_policy && s->has_playback &&
  now - s->policy_at <= 10000 && now - s->playback_at <= 10000;
 if (!s->supported || s->playing) { tv_idle_activity(s, now); return s->state; }
 uint64_t elapsed = now - s->last_activity;
 s->state = s->off_ms && elapsed >= s->off_ms ? TV_OFF :
  s->saver_ms && elapsed >= s->saver_ms ? TV_SAVER : TV_ACTIVE;
 return s->state;
}
