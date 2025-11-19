# Настройка конфигурации

Этот документ описывает, как настроить конфигурационные файлы для проекта Meshtastic Backend.

## Структура проекта

Проект состоит из двух основных компонентов:

1. **HTTP API Server** - предоставляет REST API для доступа к данным
2. **MQTT Receiver** - получает данные от MQTT серверов и отправляет уведомления в Telegram

## Быстрый старт

### 1. HTTP API Server

Скопируйте файл-пример и настройте его:

```bash
cp config.example.mjs config.mjs
```

Отредактируйте `config.mjs` и укажите:

- `ADMIN_PASSWORD` - пароль администратора для доступа к API
- Настройки Redis (если отличаются от значений по умолчанию)
- Порт HTTP сервера (по умолчанию 3000)

### 2. MQTT Receiver

Скопируйте файл-пример и настройте его:

```bash
cd mqtt-receiver
cp config.example.mjs config.mjs
```

Отредактируйте `mqtt-receiver/config.mjs` и укажите:

- `BOT_TOKEN` - токен Telegram бота (получите у [@BotFather](https://t.me/BotFather))
- `BOT_USERNAME` - имя вашего бота
- `MAIN_CHANNEL_ID` - ID основного канала/группы Telegram
- Дополнительные ID каналов (опционально)
- Список MQTT серверов в массиве `servers`

## Переменные окружения

Вы можете использовать переменные окружения вместо жестко заданных значений в конфигурационных файлах:

### HTTP API Server

| Переменная       | Описание              | По умолчанию |
| ---------------- | --------------------- | ------------ |
| `PORT`           | Порт HTTP сервера     | `3000`       |
| `CORS_ORIGIN`    | CORS origin           | `*`          |
| `ADMIN_PASSWORD` | Пароль администратора | -            |
| `REDIS_HOST`     | Хост Redis            | `redis`      |
| `REDIS_PORT`     | Порт Redis            | `6379`       |
| `REDIS_PASSWORD` | Пароль Redis          | -            |
| `REDIS_DB`       | База данных Redis     | `0`          |

### MQTT Receiver

| Переменная              | Описание                         | По умолчанию |
| ----------------------- | -------------------------------- | ------------ |
| `BOT_TOKEN`             | Токен Telegram бота              | -            |
| `TELEGRAM_ENABLED`      | Включить/выключить Telegram бота | `true`       |
| `REDIS_HOST`            | Хост Redis                       | `redis`      |
| `REDIS_PORT`            | Порт Redis                       | `6379`       |
| `REDIS_PASSWORD`        | Пароль Redis                     | -            |
| `REDIS_DB`              | База данных Redis                | `0`          |
| `STATS_LOGGING_ENABLED` | Включить логирование статистики  | `true`       |

## Конфигурация MQTT серверов

В файле `mqtt-receiver/config.mjs` настройте массив `servers`:

```javascript
export const servers = [
  {
    address: "mqtt://username:password@mqtt-server.com:1883",
    name: "mqtt-server.com",
    type: "mqtt",
    telegram: true, // Отправлять ли сообщения в Telegram
  },
];
```

### Параметры сервера

- `address` - полный URL MQTT сервера с учетными данными
- `name` - отображаемое имя сервера
- `type` - тип подключения (обычно `"mqtt"`)
- `telegram` - отправлять ли сообщения из этого сервера в Telegram

## Получение Telegram Bot Token

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте команду `/newbot`
3. Следуйте инструкциям для создания бота
4. Скопируйте полученный токен в `config.mjs`

## Получение ID канала/группы Telegram

1. Добавьте бота в канал/группу
2. Перешлите сообщение из канала боту [@userinfobot](https://t.me/userinfobot)
3. Бот отобразит ID канала (например, `-1001234567890`)
4. Используйте этот ID в конфигурации

## Docker Deployment

При использовании Docker переменные окружения можно задать в `docker-compose.yml`:

```yaml
environment:
  - REDIS_HOST=redis
  - ADMIN_PASSWORD=your_password
  - BOT_TOKEN=your_bot_token
  - TELEGRAM_ENABLED=true
```

## Безопасность

⚠️ **Важно:**

- Никогда не коммитьте реальные `config.mjs` файлы в git
- Файлы `config.mjs` уже добавлены в `.gitignore`
- Храните токены и пароли в безопасности
- Используйте переменные окружения для production
- Регулярно меняйте пароли и токены

## Проверка конфигурации

После настройки проверьте работоспособность:

```bash
# HTTP API Server
npm start

# MQTT Receiver
cd mqtt-receiver
npm start
```

## Troubleshooting

### Ошибка подключения к Redis

Убедитесь, что:

- Redis запущен и доступен
- Правильно указан хост (для Docker используйте имя контейнера `redis`)
- Порт доступен

### Telegram бот не отправляет сообщения

Проверьте:

- Правильность токена бота
- Бот добавлен в канал/группу
- ID канала указан правильно (с минусом для групп)
- `TELEGRAM_ENABLED=true`

### MQTT подключение не работает

Проверьте:

- Правильность адреса сервера
- Учетные данные (username/password)
- Доступность сервера из вашей сети
