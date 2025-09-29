# Используем Node.js 20 Alpine для минимального размера
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей
COPY package.json package-lock.json* ./

# Устанавливаем зависимости
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi

# Копируем исходный код приложения
COPY src/ ./src/
COPY *.json ./
COPY config.mjs ./

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
