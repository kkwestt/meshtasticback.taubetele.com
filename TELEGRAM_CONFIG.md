# Управление Telegram ботом

## Переменная окружения TELEGRAM_ENABLED

Для управления работой Telegram бота используется переменная окружения `TELEGRAM_ENABLED`.

### Значения:

- `true` (по умолчанию) - Telegram бот включен
- `false` - Telegram бот отключен

### Способы настройки:

#### 1. Через docker-compose.yml

```yaml
environment:
  - TELEGRAM_ENABLED=false # Отключить бота
  - TELEGRAM_ENABLED=true # Включить бота
```

#### 2. Через переменные окружения системы

```bash
export TELEGRAM_ENABLED=false
docker compose up -d
```

#### 3. Через .env файл

Создайте файл `.env` в корне проекта:

```
TELEGRAM_ENABLED=false
```

### Перезапуск контейнера

После изменения переменной необходимо перезапустить mqtt-receiver контейнер:

```bash
docker compose restart mqtt-receiver
```

### Логи

При отключенном боте в логах будет сообщение:

```
🚫 [MQTT-Receiver] Telegram бот отключен (TELEGRAM_ENABLED=false)
```

При включенном боте:

```
🤖 [MQTT-Receiver] Инициализация Telegram бота...
✅ [MQTT-Receiver] Telegram бот инициализирован успешно
```

### Что происходит при отключении:

- Telegram бот не инициализируется
- Сообщения не отправляются в Telegram каналы
- Обработка MQTT сообщений продолжается нормально
- HTTP API работает без изменений
