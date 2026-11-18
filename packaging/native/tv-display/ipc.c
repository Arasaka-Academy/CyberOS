/* [INPUT]: 同用户 0600 Unix stream；ASCII 换行命令。
 * [OUTPUT]: 独立租约更新、请求编号直回与无编号状态广播。
 * [POS]: 合成器事件循环中的有界 IPC，不阻塞渲染线程。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#include "display.h"
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
struct client {
 struct wl_list link;
 struct tv_display *display;
 struct wl_event_source *source;
 int fd;
 char buffer[256]; size_t used;
};
static void close_client(struct client *c) {
 wl_event_source_remove(c->source); close(c->fd); wl_list_remove(&c->link); free(c);
}
void tv_broadcast(struct tv_display *d) {
 char snapshot[256]; tv_snapshot(d, snapshot, sizeof snapshot);
 if (strcmp(snapshot, d->snapshot) == 0) return;
 memcpy(d->snapshot, snapshot, strlen(snapshot) + 1);
 struct client *c, *next;
 wl_list_for_each_safe(c, next, &d->clients, link)
  if (c->fd != d->reply_fd && send(c->fd, snapshot, strlen(snapshot), MSG_NOSIGNAL) != (ssize_t)strlen(snapshot))
   shutdown(c->fd, SHUT_RDWR);
}
static bool parse_request_id(const char *token, uint64_t *request_id) {
 uint64_t value = 0;
 for (const char *p = token; *p; ++p) {
  if (*p < '0' || *p > '9' || value > (UINT64_MAX - (*p - '0')) / 10) return false;
  value = value * 10 + (*p - '0');
 }
 if (!value) return false;
 *request_id = value; return true;
}
static bool command(struct tv_display *d, const char *line, uint64_t *request_id) {
 unsigned long long saver, off; unsigned int value, code; char tail, token[32];
 uint64_t now = tv_now();
 if (sscanf(line, "POLICY %llu %llu %c", &saver, &off, &tail) == 2 &&
     saver <= 86400000 && off <= 86400000 && (!saver || !off || off > saver))
  tv_idle_policy(&d->idle, saver, off, now);
 else if (sscanf(line, "PLAYBACK %u %c", &value, &tail) == 1 && value <= 1)
  tv_idle_playback(&d->idle, value, now);
 else if (sscanf(line, "PLAYBACK %u %31s %c", &value, token, &tail) == 2 && value <= 1 &&
          parse_request_id(token, request_id))
  tv_idle_playback(&d->idle, value, now);
 else if (sscanf(line, "RENDERER %u %c", &value, &tail) == 1 && value <= 1) {
  d->idle.renderer = value;
 } else if (sscanf(line, "KEY %u %u %c", &code, &value, &tail) == 2 && value <= 1 && tv_key_allowed(code))
  tv_input_key(d, code, value);
 else if (strcmp(line, "STATUS") != 0) return false;
 tv_apply(d); return true;
}
static int readable(int fd, uint32_t mask, void *data) {
 struct client *c = data;
 if (mask & (WL_EVENT_HANGUP | WL_EVENT_ERROR)) { close_client(c); return 0; }
 ssize_t count = recv(fd, c->buffer + c->used, sizeof c->buffer - c->used - 1, 0);
 if (count <= 0) {
  if (count == 0 || (errno != EAGAIN && errno != EINTR)) close_client(c);
  return 0;
 }
 c->used += count; c->buffer[c->used] = 0;
 char *end;
 while ((end = memchr(c->buffer, '\n', c->used))) {
  *end = 0;
  c->display->reply_fd = c->fd;
  uint64_t request_id = 0;
  bool valid = command(c->display, c->buffer, &request_id);
  c->display->reply_fd = -1;
  char snapshot[512]; tv_snapshot(c->display, snapshot, sizeof snapshot);
  if (request_id) {
   size_t length = strlen(snapshot);
   snprintf(snapshot + length - 2, sizeof snapshot - length + 2,
    ",\"requestId\":%" PRIu64 "}\n", request_id);
  }
  if (!valid || send(c->fd, snapshot, strlen(snapshot), MSG_NOSIGNAL) != (ssize_t)strlen(snapshot)) {
   close_client(c); return 0;
  }
  size_t consumed = end - c->buffer + 1;
  memmove(c->buffer, c->buffer + consumed, c->used - consumed); c->used -= consumed;
 }
 if (c->used == sizeof c->buffer - 1) close_client(c);
 return 0;
}
static int accept_client(int fd, uint32_t mask, void *data) {
 (void)mask; struct tv_display *d = data;
 int client_fd = accept4(fd, NULL, NULL, SOCK_CLOEXEC | SOCK_NONBLOCK);
 if (client_fd < 0) return 0;
 struct ucred peer; socklen_t length = sizeof peer;
 if (getsockopt(client_fd, SOL_SOCKET, SO_PEERCRED, &peer, &length) < 0 || peer.uid != getuid() ||
     wl_list_length(&d->clients) >= 16) { close(client_fd); return 0; }
 struct client *c = calloc(1, sizeof *c);
 if (!c) { close(client_fd); return 0; }
 c->fd = client_fd; c->display = d;
 c->source = wl_event_loop_add_fd(wl_display_get_event_loop(d->compositor->wl_display), client_fd,
  WL_EVENT_READABLE, readable, c);
 if (!c->source) { close(client_fd); free(c); return 0; }
 wl_list_insert(&d->clients, &c->link); return 0;
}
int tv_ipc_init(struct tv_display *d) {
 wl_list_init(&d->clients); d->reply_fd = -1;
 d->server_fd = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
 if (d->server_fd < 0) return -1;
 struct sockaddr_un address = { .sun_family = AF_UNIX };
 strcpy(address.sun_path, TV_SOCKET); unlink(TV_SOCKET);
 mode_t previous = umask(0077);
 int result = bind(d->server_fd, (struct sockaddr *)&address, sizeof address);
 umask(previous);
 if (result < 0 || chmod(TV_SOCKET, 0600) < 0 || listen(d->server_fd, 16) < 0) {
  close(d->server_fd); unlink(TV_SOCKET); return -1;
 }
 d->server = wl_event_loop_add_fd(wl_display_get_event_loop(d->compositor->wl_display), d->server_fd,
  WL_EVENT_READABLE, accept_client, d);
 return d->server ? 0 : -1;
}
void tv_ipc_fini(struct tv_display *d) {
 struct client *c, *next;
 wl_list_for_each_safe(c, next, &d->clients, link) close_client(c);
 if (d->server) wl_event_source_remove(d->server);
 if (d->server_fd >= 0) close(d->server_fd);
 unlink(TV_SOCKET);
}
