# Используем Node.js 20 Alpine для минимального размера
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей
COPY package.json package-lock.json* ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код приложения
COPY src/ ./src/
COPY *.json ./

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
