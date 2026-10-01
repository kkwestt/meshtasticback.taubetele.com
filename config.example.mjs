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
  // Примечание: ioredis не поддерживает commandTimeout напрямую
  // Таймауты обрабатываются на уровне приложения
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

// Приём meshcore-устройств от компонента Home Assistant (POST /api/meshcore/dots).
// Пустой токен — приём выключен. Тот же токен вводится в настройках компонента.
export const meshcoreIngestConfig = {
  token: process.env.MESHCORE_INGEST_TOKEN || "",
  // Минимальное время жизни ключа dots_meshcore:* (секунды), чтобы карта
  // могла показать «был давно», а не терять устройство
  ttlSeconds: Number(process.env.MESHCORE_INGEST_TTL) || 30 * 24 * 60 * 60,
  maxNodes: 1000,
};
