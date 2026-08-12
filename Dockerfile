FROM node:20-alpine

# Устанавливаем переменные окружения для оптимизации памяти
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV PORT=3000

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S meshtastic -u 1001

# Создаем рабочую директорию
WORKDIR /app

# Аргумент для сброса кэша (хеш коммита)
ARG CACHE_BUST=1

# Копируем файлы зависимостей
COPY package.json package-lock.json* ./

# Устанавливаем зависимости
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi && \
    npm cache clean --force

# Копируем исходный код приложения
COPY src/ ./src/
COPY config.mjs ./

# Копируем protobufs
COPY protobufs ./protobufs

# Создаем директорию для логов
RUN mkdir -p /app/logs && chown -R meshtastic:nodejs /app/logs

# Переключаемся на непривилегированного пользователя
USER meshtastic

# Открываем порт
EXPOSE 3000

# Запускаем приложение
CMD ["node", "--max-old-space-size=2048", "--optimize-for-size", "src/index.mjs"]
