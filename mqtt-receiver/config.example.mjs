// MQTT Receiver Configuration Example
// Скопируйте этот файл как config.mjs и заполните своими значениями

// Telegram Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE"; // Получите токен у @BotFather
const MAIN_CHANNEL_ID = ""; // ID основного канала/группы
const KALININGRAD_CHANNEL_ID = ""; // ID канала Калининграда (опционально)
const UFA_CHANNEL_ID = ""; // ID канала Уфы (опционально)

// Переменная для отключения Telegram бота
const TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED !== "false";

export const botSettings = {
  ENABLE: TELEGRAM_ENABLED,
  BOT_TOKEN,
  BOT_USERNAME: "YourBotUsernameBot", // Имя вашего бота
  MAIN_CHANNEL_ID,
  KALININGRAD_CHANNEL_ID,
  UFA_CHANNEL_ID,
};

// Redis configuration - обновлено для контейнерной архитектуры
const REDIS_HOST = process.env.REDIS_HOST || "redis"; // По умолчанию используем имя контейнера
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_URL =
  process.env.REDIS_URL || `redis://${REDIS_HOST}:${REDIS_PORT}`;

// MQTT Servers configuration
// Добавьте здесь свои MQTT серверы
export const servers = [
  {
    address: "mqtt://username:password@your-mqtt-server.com",
    name: "your-mqtt-server.com",
    type: "mqtt",
    telegram: true, // Отправлять сообщения в Telegram
  },
  {
    address: "mqtt://username:password@another-mqtt-server.com",
    name: "another-mqtt-server.com",
    type: "mqtt",
    telegram: false, // Не отправлять в Telegram
  },
  // Примеры публичных серверов:
  // {
  //   address: "mqtt://meshdev:large4cats@mqtt.meshtastic.org:1883",
  //   name: "mqtt.meshtastic.org",
  //   type: "mqtt",
  // },
];

// Redis configuration для MQTT Receiver (write-only operations)
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

// MQTT Receiver specific configuration
const STATS_LOGGING_ENABLED = process.env.STATS_LOGGING_ENABLED !== "false";

export const mqttReceiverConfig = {
  serviceName: "MQTT-Receiver",
  performanceMonitoringInterval: STATS_LOGGING_ENABLED ? 30000 : 0, // 30 секунд или отключено
  statsLoggingInterval: STATS_LOGGING_ENABLED ? 60000 : 0, // 1 минута или отключено
  maxReconnectAttempts: 5,
  reconnectDelay: 5000, // 5 секунд
};
