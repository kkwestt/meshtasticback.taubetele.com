# Meshtastic Backend - Microservices Architecture

Этот проект был разделен на микросервисную архитектуру для лучшей масштабируемости и управления ресурсами.

## Архитектура

### 🔄 MQTT Receiver Service

- **Назначение**: Прием данных по MQTT и сохранение в Redis
- **Директория**: `./mqtt-receiver/`
- **Ответственность**:
  - Подключение к MQTT серверам
  - Декодирование protobuf сообщений
  - Расшифровка зашифрованных пакетов
  - Сохранение данных в Redis

### 🌐 HTTP API Service

- **Назначение**: Предоставление HTTP API и работа с Telegram ботом
- **Файл**: `./index.mjs`
- **Ответственность**:
  - HTTP API для доступа к данным
  - Telegram бот для уведомлений
  - Чтение данных из Redis

### 💾 Redis Database

- **Назначение**: Централизованное хранение данных
- **Контейнер**: `redis:7-alpine`
- **Данные**: Сообщения Meshtastic, данные устройств, карты

## Преимущества новой архитектуры

1. **Разделение ответственности**: Каждый сервис выполняет свою задачу
2. **Масштабируемость**: Можно масштабировать сервисы независимо
3. **Управление ресурсами**: Лучший контроль потребления памяти
4. **Надежность**: Падение одного сервиса не влияет на другие
5. **Производительность**: Оптимизация под конкретные задачи

## Быстрый старт

```bash
# Клонировать репозиторий
git clone <repository-url>
cd meshtasticback.taubetele.com

# Настроить конфигурацию
cp config.mjs.example config.mjs
# Отредактировать config.mjs с вашими настройками

# Запустить все сервисы
docker-compose up --build -d

# Просмотр логов
docker-compose logs -f
```

## Мониторинг

### Проверка состояния сервисов

```bash
docker-compose ps
```

### Просмотр логов

```bash
# MQTT Receiver
docker-compose logs -f mqtt-receiver

# HTTP API
docker-compose logs -f meshtasticback_taubetele_com_81

# Redis
docker-compose logs -f redis
```

### Статистика использования ресурсов

```bash
docker stats
```

## Конфигурация

Основная конфигурация находится в файле `config.mjs`:

- **MQTT серверы**: Список серверов для подключения
- **Redis**: Настройки подключения к базе данных
- **Telegram**: Токен бота и настройки каналов
- **HTTP**: Порт и CORS настройки

## Структура данных

### Redis Keys Pattern

- `TEXT_MESSAGE_APP:{deviceId}` - Текстовые сообщения
- `POSITION_APP:{deviceId}` - Данные позиции GPS
- `NODEINFO_APP:{deviceId}` - Информация об устройствах
- `TELEMETRY_APP:{deviceId}` - Телеметрия устройств
- `dots:{deviceId}` - Данные для отображения на карте

## API Endpoints

### GET /api/dots

Получить все устройства для карты

### GET /api/messages/{deviceId}

Получить сообщения от конкретного устройства

### GET /api/telemetry/{deviceId}

Получить телеметрию устройства

Подробнее см. [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)

## Разработка

### Локальная разработка

```bash
# Запуск только Redis
docker-compose up redis -d

# Запуск MQTT Receiver локально
cd mqtt-receiver
npm install
npm run dev

# В другом терминале - HTTP API
npm install
npm run dev
```

### Тестирование изменений

```bash
# Пересборка конкретного сервиса
docker-compose build mqtt-receiver
docker-compose up -d mqtt-receiver
```

## Миграция

Если вы обновляетесь с предыдущей версии:

1. Остановите старый контейнер
2. Создайте резервную копию Redis данных
3. Запустите новую архитектуру через `docker-compose up --build -d`
4. Проверьте логи на наличие ошибок

## Поддержка

При возникновении проблем:

1. Проверьте логи сервисов
2. Убедитесь в корректности конфигурации
3. Проверьте доступность Redis
4. Проверьте подключение к MQTT серверам

Подробное руководство по устранению неполадок в [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md).
