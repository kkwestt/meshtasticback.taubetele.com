FROM node:20-alpine

# Устанавливаем переменные окружения для оптимизации памяти
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV PORT=3000

# Устанавливаем git
RUN apk add --no-cache git

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S meshtastic -u 1001

# Создаем рабочую директорию
WORKDIR /app

# Аргумент для сброса кэша (хеш коммита)
ARG CACHE_BUST=1

# Клонируем репозиторий (команда перевыполнится, если CACHE_BUST изменится)
RUN git clone https://github.com/kkwestt/meshtasticback.taubetele.com.git .

# Клонируем protobufs
RUN git clone https://github.com/meshtastic/protobufs.git

# Устанавливаем зависимости. Используем npm install, если нет package-lock.json
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi && \
    npm cache clean --force

# Создаем директорию для логов
RUN mkdir -p /app/logs && chown -R meshtastic:nodejs /app/logs

# Переключаемся на непривилегированного пользователя
USER meshtastic

# Открываем порт
EXPOSE 3000

# Запускаем приложение
CMD ["node", "--max-old-space-size=2048", "--optimize-for-size", "src/index.mjs"]
