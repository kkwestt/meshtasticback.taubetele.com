# WireGuard VPN Setup для Telegram бота

## Описание

Telegram бот теперь работает через WireGuard VPN. Весь трафик контейнера `mqtt-receiver` маршрутизируется через отдельный контейнер `wireguard`.

## Архитектура

```
mqtt-receiver (Telegram бот)
    ↓ (network_mode: service:wireguard)
wireguard (VPN туннель)
    ↓
Интернет через VPN
```

## Настройка

### 1. Создайте конфигурацию WireGuard

Скопируйте пример конфигурации:
```bash
cp wireguard/wg0.conf.example wireguard/wg0.conf
```

### 2. Отредактируйте `wireguard/wg0.conf`

Заполните своими данными от VPN провайдера:

```ini
[Interface]
PrivateKey = ВАШ_ПРИВАТНЫЙ_КЛЮЧ
Address = 10.0.0.2/24
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = ПУБЛИЧНЫЙ_КЛЮЧ_СЕРВЕРА
Endpoint = IP_СЕРВЕРА:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
```

### 3. Запустите контейнеры

```bash
./auto-deploy.sh
```

## Проверка работы

### Проверить статус WireGuard:
```bash
docker exec meshtastic_wireguard wg show
```

### Проверить IP адрес VPN:
```bash
docker exec meshtastic_wireguard ip addr show wg0
```

### Проверить что Telegram идет через VPN:
```bash
docker exec meshtastic_wireguard curl -s https://api.ipify.org
```

### Логи WireGuard:
```bash
docker logs -f meshtastic_wireguard
```

### Логи mqtt-receiver (Telegram бота):
```bash
docker logs -f meshtastic_mqtt_receiver
```

## Структура файлов

```
wireguard/
├── Dockerfile           # Docker образ с WireGuard
├── entrypoint.sh        # Скрипт запуска WireGuard
├── wg0.conf.example     # Пример конфигурации
└── wg0.conf             # Ваша конфигурация (не в git)
```

## Важные моменты

1. **Файл `wg0.conf` не должен попадать в git** - он содержит приватные ключи
2. **Контейнер требует привилегий** - `NET_ADMIN` и `SYS_MODULE` для работы с сетью
3. **mqtt-receiver использует сеть wireguard** - через `network_mode: service:wireguard`
4. **Все подключения mqtt-receiver идут через VPN** - включая Telegram и MQTT серверы

## Отключение VPN

Если нужно временно отключить VPN, закомментируйте в `docker-compose.yml`:

```yaml
mqtt-receiver:
  # network_mode: "service:wireguard"  # Закомментировать
  networks:                             # Раскомментировать
    - meshtastic_network                # Раскомментировать
  # depends_on:
  #   - wireguard                       # Закомментировать
```

## Troubleshooting

### WireGuard не запускается
- Проверьте что `wg0.conf` существует и правильно заполнен
- Проверьте логи: `docker logs meshtastic_wireguard`

### Telegram не подключается
- Проверьте что WireGuard туннель поднят: `docker exec meshtastic_wireguard wg show`
- Проверьте что VPN работает: `docker exec meshtastic_wireguard ping 8.8.8.8`

### MQTT серверы не подключаются
- Это нормально, если VPN блокирует некоторые порты
- Проверьте AllowedIPs в конфигурации WireGuard
