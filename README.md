# Meshtastic MQTT Redis Client с HTTP API

Система мониторинга сети Meshtastic с HTTP API для отдачи данных на порту 80, совместимая с meshtasticback.taubetele.com.

## Особенности

* 🔄 Подключение к MQTT серверам Meshtastic
* 📡 Мониторинг сообщений, позиции и телеметрии устройств
* 🌐 HTTP API на порту 80 для получения данных
* 🗄️ Кэширование данных в Redis
* ⚡ Оптимизированная производительность
* 🔧 Совместимость с meshtasticback.taubetele.com

## Требования

* Node.js >= 18.0.0
* Redis сервер
* Meshtastic protobufs

## Установка

1. Клонируйте protobufs:
```bash
git clone https://github.com/meshtastic/protobufs.git
```

2. Установите зависимости:
```bash
npm install
```

3. Настройте переменные окружения (опционально):
```bash
# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# HTTP Server
PORT=80
CORS_ORIGIN=*
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

## HTTP API Endpoints

### GET /
Получить все данные устройств (включая устаревшие)

### GET /gps:deviceId
Получить GPS данные для устройства
Пример: `/gps:123456789`

### GET /deviceMetrics:deviceId
Получить метрики устройства (батарея, напряжение, утилизация канала)
Пример: `/deviceMetrics:123456789`

### GET /environmentMetrics:deviceId
Получить данные окружающей среды (температура, влажность, давление)
Пример: `/environmentMetrics:123456789`

## Структура данных

### Device Data
```json
{
  "123456789": {
    "server": "meshtastic.taubetele.com",
    "timestamp": "2025-06-23T10:30:00.000Z",
    "user": {
      "serverTime": 1719140200000,
      "rxTime": "2025-06-23T10:30:00.000Z",
      "type": "broadcast",
      "from": 123456789,
      "to": 4294967295,
      "data": {
        "shortName": "NODE1",
        "longName": "Node 1",
        "hwModel": "TBEAM"
      }
    },
    "position": {
      "data": {
        "latitudeI": 123456789,
        "longitudeI": 987654321,
        "altitude": 100
      }
    }
  }
}
```

### GPS Data
```json
{
  "from": "123456789",
  "data": [
    {
      "time": 1719140200000,
      "latitudeI": 123456789,
      "longitudeI": 987654321,
      "altitude": 100
    }
  ]
}
```

## Конфигурация

Серверы настраиваются в `config.mjs`:

```javascript
export const servers = [
  {
    address: 'mqtt://username:password@server.com',
    name: 'server-name',
    type: 'mqtt'
  }
]
```

## Мониторинг

Приложение логирует:
* Подключения к серверам
* Обработку сообщений
* Ошибки декодирования
* Сохранение данных в Redis

## Производительность

* Кэширование данных каждые 5 секунд
* Максимум 200 элементов в истории метаданных
* Автоудаление устаревших данных (24 часа)
* Graceful shutdown

## Совместимость

Проект совместим с API meshtasticback.taubetele.com:
* Те же endpoints
* Аналогичная структура данных
* Поддержка всех типов метрик

## Лицензия

MIT License
