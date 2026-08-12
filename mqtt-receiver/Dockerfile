# Используем Node.js 20 Alpine для минимального размера
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей из mqtt-receiver
COPY mqtt-receiver/package.json mqtt-receiver/package-lock.json* ./

# Устанавливаем зависимости
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi

# Копируем исходный код приложения
COPY mqtt-receiver/src/ ./src/
COPY mqtt-receiver/config.mjs ./

# Копируем общие модули из корня проекта (нужны для shared модулей)
# Примечание: src/utils.mjs не копируем, используем локальный из mqtt-receiver/src/utils.mjs
COPY src/shared/ ./src/shared/

# Копируем protobufs из родительского контекста
COPY protobufs ./protobufs

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Меняем владельца файлов
RUN chown -R nodejs:nodejs /app
USER nodejs

# Открываем порт (не используется в данном сервисе, но оставляем для совместимости)
EXPOSE 3001

# Команда запуска
CMD ["node", "src/index.mjs"]
