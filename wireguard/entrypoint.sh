#!/bin/bash
set -e

echo "🔐 Starting WireGuard VPN..."

# Проверяем наличие конфигурации
if [ ! -f /etc/wireguard/wg0.conf ]; then
    echo "❌ WireGuard config not found at /etc/wireguard/wg0.conf"
    echo "📝 Please mount your config file to /etc/wireguard/wg0.conf"
    echo "⏳ Waiting for config file..."
    while [ ! -f /etc/wireguard/wg0.conf ]; do
        sleep 5
    done
fi

# Проверяем IP forwarding (настраивается через docker-compose sysctls)
echo "🔧 Checking IP forwarding..."
if [ "$(cat /proc/sys/net/ipv4/ip_forward)" = "1" ]; then
    echo "✅ IP forwarding enabled"
else
    echo "⚠️  IP forwarding not enabled, trying to enable..."
    echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null || echo "❌ Failed to enable IP forwarding (check docker-compose sysctls)"
fi

# Запуск WireGuard
echo "🚀 Starting WireGuard interface wg0..."
wg-quick up wg0

# Проверка статуса
echo "✅ WireGuard started successfully!"
echo "📊 WireGuard status:"
wg show

# Показываем IP адрес
echo "🌐 VPN IP address:"
ip addr show wg0 | grep inet

# Держим контейнер запущенным и мониторим WireGuard
echo "👀 Monitoring WireGuard connection..."
while true; do
    if ! wg show wg0 &> /dev/null; then
        echo "❌ WireGuard interface down, restarting..."
        wg-quick down wg0 || true
        wg-quick up wg0
    fi
    sleep 30
done
