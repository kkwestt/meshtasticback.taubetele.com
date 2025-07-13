FROM node:20-alpine

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

# Устанавливаем зависимости
RUN npm install

# Создаем директорию для логов
RUN mkdir -p /app/logs && chown -R meshtastic:nodejs /app

# Переключаемся на непривилегированного пользователя
USER meshtastic

# Открываем порт 80
EXPOSE 3000

# Устанавливаем переменную окружения для порта
ENV PORT=3000

# Запускаем приложение
CMD ["node", "index.mjs"]
