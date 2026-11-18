# [INPUT]: 匹配发行版镜像、主机 CA 与 Weston 主版本。
# [OUTPUT]: 可缓存的同架构 Linux ABI 构建环境。
# [POS]: 仅构建依赖，不作为 CyberOS 运行容器。
# [PROTOCOL]: Update this header on change, then check AGENTS.md
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG WESTON_MAJOR
ARG APT_BASE
COPY ca.pem /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/*.sources && \
    if [ -n "$APT_BASE" ]; then \
      sed -i "s|https://deb.debian.org/debian-security|$APT_BASE/debian-security|g;s|https://deb.debian.org/debian|$APT_BASE/debian|g;s|https://ports.ubuntu.com/ubuntu-ports/|$APT_BASE/ubuntu-ports/|g;s|https://archive.ubuntu.com/ubuntu/|$APT_BASE/ubuntu/|g;s|https://security.ubuntu.com/ubuntu/|$APT_BASE/ubuntu/|g" /etc/apt/sources.list.d/*.sources; \
    fi && \
    printf '%s\n' 'Acquire::ForceIPv4 "true";' 'Acquire::Retries "2";' 'Acquire::https::Timeout "30";' > /etc/apt/apt.conf.d/80-cyberos-builder && \
    apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends build-essential pkg-config weston python3 util-linux libweston-${WESTON_MAJOR}-dev && \
    rm -rf /var/lib/apt/lists/*
