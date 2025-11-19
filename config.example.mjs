// HTTP API Configuration Example
// Скопируйте этот файл как config.mjs и заполните своими значениями

// Redis configuration - обновлено для контейнерной архитектуры
const REDIS_HOST = process.env.REDIS_HOST || "redis"; // По умолчанию используем имя контейнера
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_URL =
  process.env.REDIS_URL || `redis://${REDIS_HOST}:${REDIS_PORT}`;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "your_admin_password_here";

// Redis configuration для HTTP API (read-only operations)
export const redisConfig = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB || 0,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
  lazyConnect: true, // Для лучшей работы с контейнерами
  connectTimeout: 10000, // 10 секунд
  commandTimeout: 5000, // 5 секунд
  ttl: 60 * 60 * 3, // 3 hours in seconds
};

// HTTP Server configuration
export const serverConfig = {
  port: process.env.PORT || 3000,
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    allowedHeaders: ["Content-Type", "Authorization"],
  },
};

// Admin configuration
export const adminConfig = {
  password: ADMIN_PASSWORD,
};
