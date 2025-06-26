# Meshtastic Monitor Docker Setup

## Быстрый старт

1. **Клонируйте репозиторий:**
   ```bash
   git clone https://github.com/kkwestt/meshtasticback.taubetele.com.git
   cd meshtasticback.taubetele.com
   ```

2. **Запустите развертывание:**
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

## Варианты развертывания

### Вариант 1: Простой Dockerfile
```bash
docker build -t meshtastic-monitor .
docker run -d --name meshtastic-monitor --restart unless-stopped meshtastic-monitor
```

### Вариант 2: Улучшенный Dockerfile
```bash
docker build -f Dockerfile.improved -t meshtastic-monitor:improved .
docker run -d --name meshtastic-monitor --restart unless-stopped meshtastic-monitor:improved
```

### Вариант 3: Docker Compose (рекомендуется)
```bash
docker-compose up -d
```

## Автоматическое обновление

### Встроенное обновление
Контейнер автоматически проверяет обновления каждые 5 минут и перезапускается при наличии новых коммитов.

### Watchtower (для обновления образов)
```bash
docker run -d \
  --name watchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --cleanup \
  --interval 300 \
  meshtastic-monitor
```

## Управление

### Просмотр логов
```bash
docker-compose logs -f
# или
docker logs -f meshtastic-monitor
```

### Перезапуск
```bash
docker-compose restart
# или
docker restart meshtastic-monitor
```

### Остановка
```bash
docker-compose down
# или
docker stop meshtastic-monitor
```

### Обновление
```bash
./deploy.sh
```

## Мониторинг

### Проверка статуса
```bash
docker-compose ps
docker stats meshtastic-monitor
```

### Healthcheck
```bash
docker inspect --format='{{.State.Health.Status}}' meshtastic-monitor
```

## Переменные окружения

Создайте файл `.env` для настройки:
```env
NODE_ENV=production
LOG_LEVEL=info
# Добавьте другие переменные по необходимости
```

## Volumes

- `./logs:/app/logs` - логи приложения
- `./config:/app/config:ro` - конфигурационные файлы (только чтение)

## Сеть

По умолчанию контейнер работает в изолированной сети. Если нужен доступ извне, раскомментируйте секцию `ports` в `docker-compose.yml`.

## Безопасность

- Контейнер запускается от непривилегированного пользователя
- Используется Alpine Linux для минимального размера
- Регулярные обновления через GitHub Actions

## Troubleshooting

### Контейнер не запускается
```bash
docker-compose logs meshtastic-monitor
```

### Проблемы с обновлениями
```bash
docker exec -it meshtastic-monitor /app/check-updates.sh
```

### Очистка
```bash
docker-compose down -v
docker system prune -a
```
