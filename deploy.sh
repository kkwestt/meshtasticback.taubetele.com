#!/bin/bash
set -e

echo "🚀 Deploying Meshtastic Monitor..."

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Проверяем наличие Docker
if ! command -v docker &> /dev/null; then
    error "Docker is not installed"
fi

if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose is not installed"
fi

# Создаем необходимые директории
log "Creating directories..."
mkdir -p logs config

# Проверяем наличие конфигурационных файлов
if [ ! -f "config.mjs" ]; then
    warn "config.mjs not found, you may need to configure the application"
fi

# Останавливаем существующие контейнеры
log "Stopping existing containers..."
docker-compose down || true

# Собираем новый образ
log "Building Docker image..."
docker-compose build --no-cache

# Запускаем контейнеры
log "Starting containers..."
docker-compose up -d

# Ждем запуска
log "Waiting for containers to start..."
sleep 10

# Проверяем статус
log "Checking container status..."
if docker-compose ps | grep -q "Up"; then
    log "✅ Deployment successful!"
    log "Container status:"
    docker-compose ps

    log "📋 Useful commands:"
    echo "  View logs: docker-compose logs -f"
    echo "  Restart: docker-compose restart"
    echo "  Stop: docker-compose down"
    echo "  Update: ./deploy.sh"
else
    error "❌ Deployment failed!"
fi

# Показываем логи
log "Recent logs:"
docker-compose logs --tail=20
