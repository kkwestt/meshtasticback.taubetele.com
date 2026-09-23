FROM node:20-alpine

# Лимит heap задаётся один раз в CMD (см. ниже).
# ВАЖНО: он должен быть заметно ниже mem_limit контейнера (2g),
# иначе V8 успевает упереться в свой лимит и процесс падает с
# "Reached heap limit Allocation failed"
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

# Проверка живости: контейнер помечается unhealthy, если API перестал отвечать
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Запускаем приложение
# 1024 МБ heap при mem_limit 2g оставляет запас на буферы, сокеты и RSS-оверхед
CMD ["node", "--max-old-space-size=1024", "--optimize-for-size", "src/index.mjs"]
