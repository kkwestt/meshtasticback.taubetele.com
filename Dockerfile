FROM node:20-alpine

# Устанавливаем переменные окружения для оптимизации памяти
# Примечание: --optimize-for-size не может быть в NODE_OPTIONS, только в CMD
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV PORT=3000

# Устанавливаем git для клонирования репозитория
RUN apk add --no-cache git

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S meshtastic -u 1001

# Создаем рабочую директорию
WORKDIR /app

# Клонируем репозиторий
RUN git clone https://github.com/kkwestt/meshtasticback.taubetele.com.git .

# ВАЖНО: Клонируем protobufs как требует приложение
RUN git clone https://github.com/meshtastic/protobufs.git

# Устанавливаем зависимости с оптимизацией
RUN npm ci --only=production && \
    npm cache clean --force && \
    rm -rf /tmp/* /var/cache/apk/* /root/.npm

# Создаем директорию для логов
RUN mkdir -p /app/logs && chown -R meshtastic:nodejs /app

# Переключаемся на непривилегированного пользователя
USER meshtastic

# Открываем порт
EXPOSE 3000


# Запускаем приложение с оптимизированными настройками памяти
CMD ["node", "--max-old-space-size=2048", "--optimize-for-size", "src/index.mjs"]
