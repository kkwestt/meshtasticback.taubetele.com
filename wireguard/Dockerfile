FROM alpine:latest

# Установка WireGuard и необходимых утилит
RUN apk add --no-cache \
    wireguard-tools \
    iptables \
    ip6tables \
    iproute2 \
    openresolv \
    bash

# Создаем директорию для конфигурации
RUN mkdir -p /etc/wireguard

# Скрипт запуска WireGuard
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
