#!/bin/sh
# [INPUT]: Docker 的 Linux amd64/arm64 与匹配发行版开发包。
# [OUTPUT]: 每个架构的 Weston 10/13/14 模块目录。
# [POS]: 包构建前的 ABI 矩阵；不在运行设备编译。
# [PROTOCOL]: Update this header on change, then check AGENTS.md
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
arch=${1:?amd64 or arm64 required}
case "$arch" in amd64|arm64) ;; *) exit 64 ;; esac
context=$(mktemp -d)
trap 'rm -rf "$context"' EXIT HUP INT TERM
cp "$root/packaging/native/tv-display/Dockerfile" "$context/Dockerfile"
ca=${CYBEROS_TV_NATIVE_CA:-/etc/ssl/certs/ca-certificates.crt}
[ -f "$ca" ] || ca=/etc/ssl/cert.pem
cp "$ca" "$context/ca.pem"
for major in ${CYBEROS_TV_NATIVE_MAJORS:-10 13 14}; do
 case "$major" in
  10) image=public.ecr.aws/docker/library/debian:bookworm-slim ;;
  13) image=public.ecr.aws/docker/library/ubuntu:24.04 ;;
  14) image=public.ecr.aws/docker/library/debian:trixie-slim ;;
  *) exit 64 ;;
 esac
 builder="cyberos-tv-native-weston-$major-$arch:local"
 docker build --platform "linux/$arch" --build-arg "BASE_IMAGE=$image" \
  --build-arg "WESTON_MAJOR=$major" --build-arg "APT_BASE=${CYBEROS_TV_NATIVE_APT_BASE:-}" -t "$builder" "$context"
 docker run --rm --platform "linux/$arch" -v "$root:/src" -w /src "$builder" \
  sh -ec '
   output=/src/.cyberos/tv-display/'"$arch"'
   mkdir -p "$output" /run/cyberos-tv
   chown -R nobody:nogroup "$output" /run/cyberos-tv
   runuser -u nobody -- packaging/native/tv-display/test-headless.sh '"$major"' "$output"
  '
done
