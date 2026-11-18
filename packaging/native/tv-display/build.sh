#!/bin/sh
# [INPUT]: 匹配主版本的 libweston 开发包与 C 编译器。
# [OUTPUT]: 指定目录的 ABI 模块、输入客户端与状态机测试。
# [POS]: 单容器构建入口，由矩阵脚本或 Debian rules 调用。
# [PROTOCOL]: Update this header on change, then check AGENTS.md
set -eu
major=${1:?Weston major required}
output=${2:?Output directory required}
case "$major" in 10|13|14) ;; *) exit 64 ;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
source_dir="$root/packaging/native/tv-display"
mkdir -p "$output/weston-$major"
build_tmp=$(mktemp -d "$output/.build-$major.XXXXXX")
trap 'rm -rf "$build_tmp"' EXIT HUP INT TERM
flags=$(pkg-config --cflags --libs "libweston-$major" wayland-server)
if [ "$major" = 10 ]; then flags="$flags $(pkg-config --cflags --libs libweston-desktop-10)"; fi
# pkg-config 只输出编译器参数，路径中无空格。
cc -std=c11 -Wall -Wextra -Werror -fPIC -shared  "$source_dir/module.c" "$source_dir/ipc.c" "$source_dir/input.c"  "$source_dir/views.c" "$source_dir/idle.c" $flags  -o "$build_tmp/cyberos-tv-display.so"
mv "$build_tmp/cyberos-tv-display.so" "$output/weston-$major/cyberos-tv-display.so"
# 公共输入客户端由最老 ABI 环境构建，兼容 Debian 12 的 libc。
if [ "$major" = 10 ] || [ ! -f "$output/cyberos-tv-input" ]; then
 cc -std=c11 -Wall -Wextra -Werror "$source_dir/input-helper.c" -o "$build_tmp/cyberos-tv-input"
 mv "$build_tmp/cyberos-tv-input" "$output/cyberos-tv-input"
fi
cc -std=c11 -Wall -Wextra -Werror "$source_dir/idle.c" "$source_dir/test-idle.c" -o "$build_tmp/test-idle"
"$build_tmp/test-idle"

cc -std=c11 -Wall -Wextra -Werror "$source_dir/test-input.c" "$source_dir/idle.c" $flags -o "$build_tmp/test-input"
"$build_tmp/test-input"
