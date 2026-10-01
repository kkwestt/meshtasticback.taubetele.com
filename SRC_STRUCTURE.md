# Структура проекта с src директориями

## 📁 Новая структура проекта

```
meshtasticback.taubetele.com/
├── src/                           # HTTP API сервис исходники
│   ├── index.mjs                  # Главный файл HTTP API
│   ├── httpServer.mjs             # HTTP сервер
│   ├── utils.mjs                  # Утилиты
│   └── shared/
│       ├── redisManager.mjs       # Redis менеджер (чтение данных)
│       └── validators.mjs         # Валидация имён устройств
├── mqtt-receiver/                 # MQTT Receiver сервис
│   ├── src/                       # MQTT сервис исходники
│   │   ├── index.mjs              # Главный файл MQTT Receiver
│   │   ├── mqtt.mjs               # MQTT менеджер
│   │   ├── telegram.mjs           # Telegram бот
│   │   ├── meshcoreParser.mjs     # Разбор meshcore-пакетов
│   │   ├── utils.mjs              # Утилиты
│   │   ├── protobufDecoder.mjs    # Декодер protobuf
│   │   └── shared/
│   │       ├── redisManager.mjs   # Redis менеджер (чтение и запись)
│   │       ├── messageQueue.mjs   # Очередь обработки сообщений
│   │       └── validators.mjs     # Валидаторы
│   ├── Dockerfile                 # Docker для MQTT сервиса
│   ├── package.json               # Зависимости MQTT сервиса
│   └── index.mjs                  # Точка входа (импортирует src/index.mjs)
├── index.mjs                      # Точка входа основного сервиса
├── config.mjs                     # Общая конфигурация
├── docker-compose.yml             # Docker Compose конфигурация
├── Dockerfile                     # Docker для основного сервиса
├── package.json                   # Зависимости основного сервиса
├── protobufs/                     # Protobuf схемы
└── ...                           # Документация и конфигурации
```

## 🚀 Преимущества новой структуры

### Организация кода

- **Четкое разделение**: Исходники в `src/`, конфигурация в корне
- **Модульность**: Каждый сервис имеет свою `src/` директорию
- **Точки входа**: Простые файлы в корне импортируют код из `src/`

### Разработка

- **IDE поддержка**: Лучшая навигация по коду
- **Тестирование**: Легче создавать тесты для модулей
- **Отладка**: Четкая структура для debugging

### Docker контейнеры

- **Оптимизация**: Можно копировать только нужные директории
- **Кэширование**: Лучше кэширование слоев Docker
- **Безопасность**: Меньше файлов в контейнере

## 📝 Изменения в точках входа

### Основной сервис (`/index.mjs`)

```javascript
// Точка входа для основного сервиса
import("./src/index.mjs");
```

### MQTT Receiver (`/mqtt-receiver/index.mjs`)

```javascript
// Точка входа для MQTT Receiver сервиса
import("./src/index.mjs");
```

## 🔧 Обновленные команды

### Локальная разработка

```bash
# Основной сервис
npm run dev                    # Запускает src/index.mjs
node src/index.mjs             # Прямой запуск

# MQTT Receiver
cd mqtt-receiver
npm run dev                    # Запускает src/index.mjs
node src/index.mjs             # Прямой запуск
```

### Docker

```bash
# Сборка всех сервисов
docker-compose build

# Запуск конкретного сервиса
docker-compose up mqtt-receiver
docker-compose up meshtasticback_taubetele_com_81
```

## 📂 Содержимое src директорий

### `/src/` (HTTP API сервис)

| Файл                      | Назначение                     |
| ------------------------- | ------------------------------ |
| `index.mjs`               | Главный класс HTTP API сервиса |
| `httpServer.mjs`          | Express HTTP сервер            |
| `shared/redisManager.mjs` | Чтение данных из Redis         |
| `shared/validators.mjs`   | Валидация имён устройств       |
| `utils.mjs`               | Общие утилиты                  |

### `/mqtt-receiver/src/` (MQTT Receiver сервис)

| Файл                      | Назначение                       |
| ------------------------- | -------------------------------- |
| `index.mjs`               | Главный класс MQTT Receiver      |
| `mqtt.mjs`                | MQTT клиент и обработка          |
| `telegram.mjs`            | Telegram бот логика              |
| `meshcoreParser.mjs`      | Разбор meshcore-пакетов          |
| `shared/redisManager.mjs` | Чтение и запись данных в Redis   |
| `shared/messageQueue.mjs` | Очередь обработки сообщений      |
| `shared/validators.mjs`   | Валидаторы                       |
| `utils.mjs`               | Общие утилиты (копия)            |
| `protobufDecoder.mjs`     | Декодирование protobuf           |

## 🔄 Импорты между файлами

### Внутри src директорий

```javascript
// Импорты внутри одной src директории
import { RedisManager } from "./shared/redisManager.mjs";
import { handleEndpointError } from "./utils.mjs";
```

### Из src в корневые файлы

```javascript
// Из src в config.mjs в корне
import { config } from "../config.mjs";
import { config } from "../../config.mjs"; // Для mqtt-receiver
```

## 🐳 Docker изменения

### Dockerfile (основной сервис)

```dockerfile
# Старый способ
COPY . .

# Новый способ
COPY src/ ./src/
COPY config.mjs package.json ./
CMD ["node", "src/index.mjs"]
```

### Dockerfile (mqtt-receiver)

```dockerfile
COPY src/ ./src/
COPY *.json ./
COPY protobufs ./protobufs
CMD ["node", "src/index.mjs"]
```

## ✅ Что работает так же

- **Docker Compose**: Все команды работают без изменений
- **API endpoints**: HTTP API остается тем же
- **Telegram бот**: Функционал не изменился
- **MQTT обработка**: Логика осталась прежней
- **Redis данные**: Структура данных не изменилась

## 🔍 Отладка и мониторинг

### Логи

```bash
# Все сервисы
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f mqtt-receiver

# Поиск по логам
docker-compose logs mqtt-receiver | grep "HTTP-API"
docker-compose logs mqtt-receiver | grep "MQTT-Receiver"
```

### Проверка структуры

```bash
# Проверить файлы в контейнере
docker-compose exec mqtt-receiver ls -la src/
docker-compose exec meshtasticback_taubetele_com_81 ls -la src/
```

## 📋 Миграция завершена

- ✅ Исходники перенесены в `src/` директории
- ✅ Точки входа созданы в корневых директориях
- ✅ Dockerfile'ы обновлены для новых путей
- ✅ package.json обновлены для новых точек входа
- ✅ Импорты исправлены для новой структуры
- ✅ Docker Compose работает с новой структурой

**Новая src структура готова к использованию! 🎉**
