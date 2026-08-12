#!/bin/bash
set -e

echo "🚀 Deploying meshtasticback_taubetele_com microservices..."

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для логирования
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# Проверяем наличие Docker (Synology paths)
if ! command -v /usr/local/bin/docker &> /dev/null; then
    error "Docker is not installed"
fi

if ! command -v /usr/local/bin/docker-compose &> /dev/null; then
    error "Docker Compose is not installed"
fi

# Создаем необходимые директории
log "Creating directories..."
mkdir -p logs config mqtt-receiver/src src protobufs

# Проверяем наличие конфигурационных файлов
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        warn ".env file not found, copying from .env.example"
        cp .env.example .env
        info "Please edit .env file with your settings"
    else
        warn ".env file not found, using default environment variables"
    fi
fi

if [ ! -f "config.mjs" ]; then
    warn "config.mjs not found, application will use default configuration"
fi

# Проверяем наличие исходного кода
log "Checking source code..."
if [ ! -d "src" ] || [ ! -d "mqtt-receiver/src" ]; then
    warn "Source code directories not found!"
    info "Make sure to copy source code before deployment"
fi

if [ ! -d "protobufs" ]; then
    warn "Protobufs directory not found!"
    info "Make sure to copy protobufs before deployment"
fi

# Останавливаем существующие контейнеры
log "Stopping existing containers..."
sudo /usr/local/bin/docker-compose down || true

# Очищаем старые образы
log "Cleaning up old images..."
sudo /usr/local/bin/docker image prune -f || true

# Собираем новый образ
log "Building Docker image..."
sudo /usr/local/bin/docker-compose build --no-cache

# Запускаем контейнеры
log "Starting containers..."
sudo /usr/local/bin/docker-compose up -d

# Ждем запуска
log "Waiting for containers to start..."
sleep 15

# Проверяем статус
log "Checking container status..."
if sudo /usr/local/bin/docker-compose ps | grep -q "Up"; then
    log "✅ Deployment successful!"

    info "Container status:"
    sudo /usr/local/bin/docker-compose ps

    info "📋 Useful commands:"
    echo "  View main service logs: sudo /usr/local/bin/docker-compose logs -f meshtasticback_taubetele_com_81"
    echo "  View mqtt-receiver logs: sudo /usr/local/bin/docker-compose logs -f mqtt-receiver"
    echo "  View all logs: sudo /usr/local/bin/docker-compose logs -f"
    echo "  Restart: sudo /usr/local/bin/docker-compose restart"
    echo "  Stop: sudo /usr/local/bin/docker-compose down"
    echo "  Update: ./deploy.sh"
    echo "  Main service shell: sudo /usr/local/bin/docker exec -it meshtasticback_taubetele_com_81 sh"
    echo "  MQTT receiver shell: sudo /usr/local/bin/docker exec -it mqtt-receiver sh"

    # Проверяем здоровье контейнеров
    sleep 5
    MAIN_HEALTH=$(sudo /usr/local/bin/docker inspect --format='{{.State.Health.Status}}' meshtasticback_taubetele_com_81 2>/dev/null || echo "no-healthcheck")
    MQTT_HEALTH=$(sudo /usr/local/bin/docker inspect --format='{{.State.Health.Status}}' mqtt-receiver 2>/dev/null || echo "no-healthcheck")
    
    if [ "$MAIN_HEALTH" = "healthy" ]; then
        log "🟢 Main service container is healthy"
    elif [ "$MAIN_HEALTH" = "starting" ]; then
        warn "🟡 Main service container is starting up..."
    elif [ "$MAIN_HEALTH" = "unhealthy" ]; then
        warn "🔴 Main service container is unhealthy, check logs"
    fi
    
    if [ "$MQTT_HEALTH" = "healthy" ]; then
        log "🟢 MQTT receiver container is healthy"
    elif [ "$MQTT_HEALTH" = "starting" ]; then
        warn "🟡 MQTT receiver container is starting up..."
    elif [ "$MQTT_HEALTH" = "unhealthy" ]; then
        warn "🔴 MQTT receiver container is unhealthy, check logs"
    fi

else
    error "❌ Deployment failed!"
fi

# Показываем логи
log "Recent logs from main service:"
sudo /usr/local/bin/docker-compose logs --tail=15 meshtasticback_taubetele_com_81

log "Recent logs from mqtt-receiver:"
sudo /usr/local/bin/docker-compose logs --tail=15 mqtt-receiver

log "🎉 Microservices deployment completed!"
info "Monitor logs with:"
info "  Main service: sudo /usr/local/bin/docker-compose logs -f meshtasticback_taubetele_com_81"
info "  MQTT receiver: sudo /usr/local/bin/docker-compose logs -f mqtt-receiver"
