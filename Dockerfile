# Используем официальный Node.js образ
FROM node:20-alpine

# Устанавливаем git для клонирования репозитория
RUN apk add --no-cache git

# Создаем рабочую директорию
WORKDIR /app

# Клонируем репозиторий
RUN git clone https://github.com/kkwestt/meshtasticback.taubetele.com.git .

# ВАЖНО: Клонируем protobufs как требует приложение
RUN git clone https://github.com/meshtastic/protobufs.git

# Устанавливаем зависимости
RUN npm install

# Создаем скрипт для автоматического обновления
RUN echo '#!/bin/sh' > /app/update.sh && \
    echo 'echo "Checking for updates..."' >> /app/update.sh && \
    echo 'git fetch origin' >> /app/update.sh && \
    echo 'LOCAL=$(git rev-parse HEAD)' >> /app/update.sh && \
    echo 'REMOTE=$(git rev-parse origin/main)' >> /app/update.sh && \
    echo 'if [ "$LOCAL" != "$REMOTE" ]; then' >> /app/update.sh && \
    echo '  echo "Updates found, pulling changes..."' >> /app/update.sh && \
    echo '  git pull origin main' >> /app/update.sh && \
    echo '  npm install' >> /app/update.sh && \
    echo '  echo "Restarting application..."' >> /app/update.sh && \
    echo '  pkill -f "node index.mjs" || true' >> /app/update.sh && \
    echo '  sleep 2' >> /app/update.sh && \
    echo '  npm run dev &' >> /app/update.sh && \
    echo 'else' >> /app/update.sh && \
    echo '  echo "No updates available"' >> /app/update.sh && \
    echo 'fi' >> /app/update.sh && \
    chmod +x /app/update.sh

# Создаем основной скрипт запуска
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'echo "Starting Meshtastic Monitor..."' >> /app/start.sh && \
    echo '' >> /app/start.sh && \
    echo '# Запускаем приложение в фоне' >> /app/start.sh && \
    echo 'npm run dev &' >> /app/start.sh && \
    echo 'APP_PID=$!' >> /app/start.sh && \
    echo '' >> /app/start.sh && \
    echo '# Функция для проверки обновлений каждые 5 минут' >> /app/start.sh && \
    echo 'while true; do' >> /app/start.sh && \
    echo '  sleep 300  # 5 минут' >> /app/start.sh && \
    echo '  /app/update.sh' >> /app/start.sh && \
    echo 'done' >> /app/start.sh && \
    chmod +x /app/start.sh

# Открываем порт (если нужен)
EXPOSE 3000

# Запускаем скрипт
CMD ["/app/start.sh"]
