# Meshtastic Monitor BACK

# meshtastic.taubetele.com 

Система мониторинга сети Meshtastic с уведомлениями в Telegram.

## Особенности

- 🔄 Подключение к нескольким MQTT серверам Meshtastic
- 📡 Мониторинг сообщений, позиции и телеметрии устройств
- 🤖 Уведомления в Telegram
- 📊 REST API для получения данных
- 🗄️ Кэширование данных в Redis
- ⚡ Оптимизированная производительность

## Требования

- Node.js >= 18.0.0
- Redis сервер
- Telegram Bot Token (опционально)

## Установка

1. Клонируйте репозиторий:
```bash
git clone <repository-url>
cd meshtastic-monitor
```

2. Установите зависимости:
```bash
npm install
```

3. Настройте переменные окружения:
```bash
cp .env.example .env
# Отредактируйте .env файл
```

## Переменные окружения

```bash
# Redis
REDIS_URL=redis://localhost:6379

# Telegram Bot (опционально)
BOT_TOKEN=your_bot_token_here
CHANNEL_ID=your_channel_id_here
BOT_ENABLE=true

# Server
PORT=80
NODE_ENV=production
```

## Запуск

### Разработка
```bash
npm run dev
```

### Продакшн
```bash
npm start
```

## API Endpoints

### GET /
Получить все данные устройств

### GET /api
Получить данные устройств (исключая устаревшие)

### GET /gps:deviceId
Получить GPS данные для устройства

### GET /deviceMetrics:deviceId
Получить метрики устройства

### GET /environmentMetrics:deviceId
Получить данные окружающей среды

## Структура проекта

```
├── index.mjs           # Основной файл приложения
├── config.mjs          # Конфигурация
├── getEventType.mjs    # Определение типов событий
├── listenToEvents.mjs  # Обработка MQTT событий
├── telegram.mjs        # Telegram бот
├── package.json        # Зависимости
└── README.md          # Документация
```

## Конфигурация серверов

Серверы настраиваются в `config.mjs`:

```javascript
export const servers = [
  {
    address: 'mqtt://username:password@server.com',
    name: 'server-name',
    type: 'mqtt',
    telegram: true // включить уведомления
  }
]
```

## Мониторинг

Приложение логирует важные события:
- Подключения к серверам
- Ошибки обработки данных
- Статистику сообщений

## Производительность

### Оптимизации:
- ✅ Кэширование данных Redis
- ✅ Пакетная обработка событий
- ✅ Ограничение скорости Telegram
- ✅ Graceful shutdown
- ✅ Обработка ошибок
- ✅ Валидация данных

### Метрики:
- Обновление кэша каждые 5 секунд
- Максимум 200 элементов в истории
- Автоудаление старых сообщений Telegram

## Разработка

### Линтинг
```bash
npm run lint
npm run lint:fix
```

### Структура кода
- ES6+ модули
- Async/await
- Обработка ошибок
- Типизация JSDoc

## Устранение неполадок

### Redis подключение
```bash
# Проверить подключение к Redis
redis-cli ping
```

### MQTT подключение
```bash
# Проверить MQTT топики
mosquitto_sub -h server.com -t "msh/+/+/+/+"
```

### Telegram бот
1. Создайте бота через @BotFather
2. Получите токен
3. Добавьте бота в канал
4. Получите ID канала

## Лицензия

MIT License

## Поддержка

Для вопросов и предложений создавайте Issues в репозитории.
