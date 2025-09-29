# Развертывание Meshtastic Backend с разделенной архитектурой

## Архитектура

Проект теперь разделен на отдельные Docker контейнеры:

1. **mqtt-receiver** - Сервис для приема данных по MQTT и сохранения в Redis
2. **meshtasticback_taubetele_com_81** - HTTP API сервер и Telegram бот
3. **redis** - База данных Redis для хранения данных

## Требования

- Docker и Docker Compose
- Настроенный файл `config.mjs` с правильными учетными данными

## Структура проекта

```
meshtasticback.taubetele.com/
├── mqtt-receiver/              # MQTT Receiver сервис
│   ├── Dockerfile
│   ├── package.json
│   ├── index.mjs
│   ├── mqtt.mjs
│   ├── redisManager.mjs       # Упрощенная версия для записи
│   ├── utils.mjs
│   └── protobufDecoder.mjs
├── docker-compose.yml         # Конфигурация всех сервисов
├── Dockerfile                 # Основной HTTP API сервис
├── index.mjs                  # Упрощенный HTTP API и Telegram
├── redisManager.mjs           # Версия только для чтения
├── config.mjs                 # Общая конфигурация
├── protobufs/                 # Protobuf схемы
└── ... (остальные файлы HTTP API)
```

## Переменные окружения

### Общие переменные (для docker-compose.yml)

```bash
# Redis
REDIS_HOST=redis           # Имя контейнера Redis
REDIS_PORT=6379           # Порт Redis
REDIS_PASSWORD=           # Пароль Redis (опционально)
REDIS_DB=0                # Номер базы данных

# Node.js
NODE_ENV=production
```

### Для HTTP API сервиса

```bash
PORT=3000                 # Порт HTTP сервера
CORS_ORIGIN=*             # CORS настройки
```

### Для config.mjs

```bash
BOT_TOKEN=your_telegram_bot_token
ADMIN_PASSWORD=your_admin_password
```

## Команды развертывания

### 1. Сборка и запуск всех сервисов

```bash
docker-compose up --build -d
```

### 2. Просмотр логов

```bash
# Все сервисы
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f mqtt-receiver
docker-compose logs -f meshtasticback_taubetele_com_81
docker-compose logs -f redis
```

### 3. Остановка сервисов

```bash
docker-compose down
```

### 4. Пересборка конкретного сервиса

```bash
# MQTT Receiver
docker-compose build mqtt-receiver
docker-compose up -d mqtt-receiver

# HTTP API
docker-compose build meshtasticback_taubetele_com_81
docker-compose up -d meshtasticback_taubetele_com_81
```

## Мониторинг

### Проверка состояния контейнеров

```bash
docker-compose ps
```

### Проверка использования ресурсов

```bash
docker stats
```

### Подключение к Redis для отладки

```bash
docker-compose exec redis redis-cli
```

## Масштабирование

### Увеличение ресурсов для сервисов

Отредактируйте `docker-compose.yml`:

```yaml
services:
  mqtt-receiver:
    mem_limit: 2g # Увеличить память
    mem_reservation: 512m

  meshtasticback_taubetele_com_81:
    mem_limit: 3g # Увеличить память
    mem_reservation: 1g
```

### Запуск нескольких экземпляров MQTT Receiver

```bash
docker-compose up -d --scale mqtt-receiver=2
```

## Обновление

### 1. Остановить сервисы

```bash
docker-compose down
```

### 2. Обновить код

```bash
git pull origin main
```

### 3. Пересобрать и запустить

```bash
docker-compose up --build -d
```

## Резервное копирование

### Экспорт данных Redis

```bash
# Создание бэкапа
docker-compose exec redis redis-cli --rdb /data/backup.rdb

# Копирование бэкапа на хост
docker cp $(docker-compose ps -q redis):/data/backup.rdb ./redis-backup.rdb
```

### Восстановление данных Redis

```bash
# Остановить Redis
docker-compose stop redis

# Копировать бэкап в контейнер
docker cp ./redis-backup.rdb $(docker-compose ps -q redis):/data/dump.rdb

# Запустить Redis
docker-compose start redis
```

## Отладка

### Проблемы с подключением к Redis

1. Проверьте, что Redis контейнер запущен:

   ```bash
   docker-compose ps redis
   ```

2. Проверьте логи Redis:

   ```bash
   docker-compose logs redis
   ```

3. Проверьте сетевое подключение:
   ```bash
   docker-compose exec mqtt-receiver ping redis
   ```

### Проблемы с MQTT подключением

1. Проверьте логи MQTT Receiver:

   ```bash
   docker-compose logs mqtt-receiver | grep MQTT
   ```

2. Проверьте конфигурацию серверов в `config.mjs`

### Проблемы с памятью

1. Мониторьте использование памяти:

   ```bash
   docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
   ```

2. Настройте лимиты памяти в `docker-compose.yml`

## Производственное развертывание

### Рекомендуемые настройки для production

1. **Используйте внешний Redis** для лучшей производительности:

   ```yaml
   environment:
     - REDIS_HOST=your-redis-server.com
     - REDIS_PORT=6379
     - REDIS_PASSWORD=your-secure-password
   ```

2. **Настройте логирование**:

   ```yaml
   logging:
     driver: "json-file"
     options:
       max-size: "100m"
       max-file: "3"
   ```

3. **Используйте Docker Swarm или Kubernetes** для высокой доступности

4. **Настройте мониторинг** с помощью Prometheus + Grafana

5. **Регулярное резервное копирование** данных Redis

## Безопасность

1. Не используйте дефолтные пароли в production
2. Настройте файрвол для ограничения доступа к портам
3. Используйте HTTPS для HTTP API
4. Регулярно обновляйте Docker образы
5. Используйте Docker secrets для чувствительных данных
