#!/bin/sh
# [INPUT]: 含 Weston 的隔离 Linux 容器与对应开发包。
# [OUTPUT]: 模块加载、DPMS 与 socket 集成验证。
# [POS]: 仅供测试；不得在 cybermachine 或现有 TV 会话执行。
# [PROTOCOL]: Update this header on change, then check AGENTS.md
set -eu
major=${1:?Weston major}
output=${2:?Build output}
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
"$root/packaging/native/tv-display/build.sh" "$major" "$output"
test_dir=$(mktemp -d "$output/.headless-$major.XXXXXX")
cc -std=c11 -Wall -Wextra -Werror -shared -fPIC  "$root/packaging/native/tv-display/test-output.c"  $(pkg-config --cflags --libs "libweston-$major") -o "$test_dir/test-output.so"
export XDG_RUNTIME_DIR=/run/cyberos-tv
mkdir -p "$XDG_RUNTIME_DIR"; chmod 0700 "$XDG_RUNTIME_DIR"
weston --backend=headless-backend.so --shell=kiosk-shell.so --idle-time=0  --modules="$test_dir/test-output.so,$output/weston-$major/cyberos-tv-display.so"  --log="$test_dir/headless.log" &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT HUP INT TERM
for attempt in $(seq 1 100); do
 [ ! -S "$XDG_RUNTIME_DIR/display.sock" ] || break
 sleep 0.1
done
python3 "$root/packaging/native/tv-display/test-socket.py"
"$output/cyberos-tv-input" probe
rg_command=grep
"$rg_command" -q 'TV_TEST_KEY 28 1' "$test_dir/headless.log"
"$rg_command" -q 'TV_TEST_KEY 28 0' "$test_dir/headless.log"

cp "$test_dir/headless.log" "$output/headless-$major.log"
rm -rf "$test_dir"
