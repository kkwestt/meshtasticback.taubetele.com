FROM alpine:latest

# Установка WireGuard в userspace режиме (wireguard-go) и необходимых утилит
RUN apk add --no-cache \
    wireguard-tools-wg-quick \
    wireguard-tools \
    iptables \
    ip6tables \
    iproute2 \
    openresolv \
    bash

# Устанавливаем wireguard-go из edge репозитория
RUN apk add --no-cache --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing wireguard-go

# Создаем директорию для конфигурации
RUN mkdir -p /etc/wireguard

# Скрипт запуска WireGuard
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
