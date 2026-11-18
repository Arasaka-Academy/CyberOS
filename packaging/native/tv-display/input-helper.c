/* [INPUT]: 白名单 evdev 键或 STATUS；同用户显示 socket。
 * [OUTPUT]: cyberos-tv-input key <code> <0|1> 与 probe 命令。
 * [POS]: CEC/手柄共享客户端；probe 不注入键也不更新租约。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md */
#define _POSIX_C_SOURCE 200809L
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/time.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
 char command[80];
 if (argc == 2 && strcmp(argv[1], "probe") == 0) strcpy(command, "STATUS\n");
 else if (argc == 4 && strcmp(argv[1], "key") == 0) {
  char *end; unsigned long code = strtoul(argv[2], &end, 10);
  if (*end || !*argv[2] || code > 767 || (strcmp(argv[3], "0") && strcmp(argv[3], "1"))) return 64;
  snprintf(command, sizeof command, "KEY %lu %s\n", code, argv[3]);
 } else return 64;
 int fd = socket(AF_UNIX, SOCK_STREAM, 0);
 if (fd < 0) return 1;
 struct timeval timeout = { .tv_sec = 1 };
 setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof timeout);
 setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof timeout);
 struct sockaddr_un address = { .sun_family = AF_UNIX };
 strcpy(address.sun_path, "/run/cyberos-tv/display.sock");
 if (connect(fd, (struct sockaddr *)&address, sizeof address) < 0 ||
     send(fd, command, strlen(command), MSG_NOSIGNAL) != (ssize_t)strlen(command)) { close(fd); return 1; }
 char response[256]; ssize_t size = recv(fd, response, sizeof response - 1, 0); close(fd);
 if (size <= 0) return 1;
 response[size] = 0;
 if (!strstr(response, "\"state\":")) return 1;
 return 0;
}
