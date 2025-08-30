import Redis from "ioredis";
import {
  executeRedisPipeline,
  createDeviceDataBatch,
  filterExpiredDevices,
  CONSTANTS,
  getPortnumName,
} from "./utils.mjs";

const { MAX_METADATA_ITEMS_COUNT, DEVICE_EXPIRY_TIME, MAX_PORTNUM_MESSAGES } =
  CONSTANTS;

/**
 * Оптимизированный Redis Manager с новой схемой хранения данных
 *
 * Структура данных для ключа dots:${deviceId}:
 * - longName - Длинное имя устройства (если есть имя)
 * - shortName - Короткое имя устройства (если есть имя)
 * - longitude - Долгота (если есть геолокация)
 * - latitude - Широта (если есть геолокация)
 * - s_time - Серверное время обновления записи
 * - mqtt - Флаг MQTT (1 - MQTT gateway)
 *
 * Правило: должно быть либо геолокация, либо имя. Пакеты приходят раздельно.
 * Устройства без имени и геолокации не сохраняются в dots:.
 */
export class RedisManager {
  constructor(config) {
    this.redis = new Redis(config);
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.cacheTTL = 15000; // 15 секунд
    this.isQuerying = false;
    this.queryLock = new Map();

    this.setupEventHandlers();
  }

  /**
   * Настраивает обработчики событий Redis
   */
  setupEventHandlers() {
    this.redis.on("error", (err) => {
      console.error("Redis Client Error:", err);
    });

    this.redis.on("connect", () => {
      console.log("✅ Connected to Redis");
    });

    this.redis.on("reconnecting", () => {
      console.log("🔄 Reconnecting to Redis...");
    });
  }

  /**
   * Проверяет подключение к Redis
   */
  async ping() {
    return await this.redis.ping();
  }

  /**
   * Сохраняет сообщение по portnum
   * @param {number|string} portnum - Номер или название порта
   * @param {string} deviceId - ID устройства
   * @param {Object} messageData - Данные сообщения
   */
  async savePortnumMessage(portnum, deviceId, messageData) {
    try {
      const portnumName = getPortnumName(portnum);
      if (!portnumName) {
        console.log(`⚠️ Неизвестный portnum: ${portnum}`);
        return;
      }

      const key = `${portnumName}:${deviceId}`;
      const messageWithTimestamp = {
        timestamp: Date.now(),
        ...messageData,
      };

      // Добавляем сообщение в список
      await this.redis.rpush(key, JSON.stringify(messageWithTimestamp));

      // Обрезаем до последних MAX_PORTNUM_MESSAGES сообщений
      await this.redis.ltrim(key, -MAX_PORTNUM_MESSAGES, -1);

      // Инвалидируем кэш для этого типа сообщений
      this.invalidatePortnumCache(portnumName, deviceId);

      // console.log(
      //   `💾 Сохранено в ${key}: ${JSON.stringify(messageData).substring(
      //    0,
      //    200
      //   )}...`
      // );
    } catch (error) {
      console.error("Error saving portnum message:", error.message);
    }
  }

  /**
   * Получает сообщения по portnum для устройства
   * @param {string} portnumName - Название портa
   * @param {string} deviceId - ID устройства
   * @param {number} limit - Лимит сообщений (по умолчанию все)
   * @returns {Array} - Массив сообщений
   */
  async getPortnumMessages(
    portnumName,
    deviceId,
    limit = MAX_PORTNUM_MESSAGES
  ) {
    const cacheKey = `portnum_${portnumName}_${deviceId}`;

    // Проверяем кэш
    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const key = `${portnumName}:${deviceId}`;
      const data = await this.redis.lrange(key, -limit, -1);

      const result = data
        .map((item) => {
          try {
            return JSON.parse(item);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .reverse(); // Возвращаем в порядке от новых к старым

      // Кэшируем результат
      this.cache.set(cacheKey, result);
      this.cacheTimestamps.set(cacheKey, Date.now());

      return result;
    } catch (error) {
      console.error(
        `Error getting portnum messages for ${portnumName}:${deviceId}:`,
        error.message
      );
      return [];
    }
  }

  /**
   * Получает все сообщения определенного типа
   * @param {string} portnumName - Название портa
   * @returns {Object} - Объект с данными по устройствам
   */
  async getAllPortnumMessages(portnumName) {
    try {
      const pattern = `${portnumName}:*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length === 0) {
        return {};
      }

      // Получаем данные для всех ключей параллельно
      const operations = keys.map((key) => ({
        command: "lrange",
        args: [key, -MAX_PORTNUM_MESSAGES, -1],
      }));

      const results = await executeRedisPipeline(this.redis, operations);

      const allMessages = {};
      keys.forEach((key, index) => {
        const deviceId = key.split(":")[1];
        const messages = results[index]
          .map((item) => {
            try {
              return JSON.parse(item);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .reverse(); // От новых к старым

        if (messages.length > 0) {
          allMessages[deviceId] = messages;
        }
      });

      return allMessages;
    } catch (error) {
      console.error(
        `Error getting all portnum messages for ${portnumName}:`,
        error.message
      );
      return {};
    }
  }

  /**
   * Получает статистику по portnum
   * @returns {Object} - Статистика по типам сообщений
   */
  async getPortnumStats() {
    try {
      const stats = {};
      const portnumNames = [
        "TEXT_MESSAGE_APP",
        "POSITION_APP",
        "NODEINFO_APP",
        "TELEMETRY_APP",
        "NEIGHBORINFO_APP",
        "WAYPOINT_APP",
        "MAP_REPORT_APP",
        "TRACEROUTE_APP",
      ];

      for (const portnumName of portnumNames) {
        const pattern = `${portnumName}:*`;
        const keys = await this.redis.keys(pattern);

        stats[portnumName] = {
          deviceCount: keys.length,
          totalMessages: 0,
        };

        if (keys.length > 0) {
          // Подсчитываем общее количество сообщений
          const operations = keys.map((key) => ({
            command: "llen",
            args: [key],
          }));

          const lengths = await executeRedisPipeline(this.redis, operations);
          stats[portnumName].totalMessages = lengths.reduce(
            (sum, len) => sum + len,
            0
          );
        }
      }

      return stats;
    } catch (error) {
      console.error("Error getting portnum stats:", error.message);
      return {};
    }
  }

  /**
   * Проверяет валидность кэша
   * @param {string} key - Ключ кэша
   * @returns {boolean} - Валидность кэша
   */
  isCacheValid(key) {
    if (!this.cache.has(key)) return false;

    const timestamp = this.cacheTimestamps.get(key);
    return timestamp && Date.now() - timestamp < this.cacheTTL;
  }

  /**
   * Инвалидирует кэш пользователя
   * @param {string} userId - ID пользователя
   */
  invalidateUserCache(userId) {
    const cacheKey = `user_${userId}`;
    this.cache.delete(cacheKey);
    this.cacheTimestamps.delete(cacheKey);
  }

  /**
   * Инвалидирует кэш для portnum сообщений
   * @param {string} portnumName - Название портa
   * @param {string} deviceId - ID устройства
   */
  invalidatePortnumCache(portnumName, deviceId) {
    const cacheKey = `portnum_${portnumName}_${deviceId}`;
    this.cache.delete(cacheKey);
    this.cacheTimestamps.delete(cacheKey);
  }

  /**
   * Очищает весь кэш
   */
  clearCache() {
    this.cache.clear();
    this.cacheTimestamps.clear();
  }

  /**
   * Получает статистику кэша
   * @returns {Object} - Статистика кэша
   */
  getCacheStats() {
    const now = Date.now();
    const validEntries = Array.from(this.cacheTimestamps.entries()).filter(
      ([_, timestamp]) => now - timestamp < this.cacheTTL
    );

    return {
      totalEntries: this.cache.size,
      validEntries: validEntries.length,
      expiredEntries: this.cache.size - validEntries.length,
      memoryUsage: this.cache.size * 100, // Примерная оценка
    };
  }

  /**
   * Периодически очищает истекший кэш
   */
  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      const keysToDelete = [];

      this.cacheTimestamps.forEach((timestamp, key) => {
        if (now - timestamp >= this.cacheTTL) {
          keysToDelete.push(key);
        }
      });

      keysToDelete.forEach((key) => {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
      });

      if (keysToDelete.length > 0) {
        console.log(`🗑️ Очищено ${keysToDelete.length} истекших записей кэша`);
      }
    }, 60000); // Каждую минуту
  }

  /**
   * Удаляет все данные устройства из Redis
   * @param {string} deviceId - ID устройства в hex (!015ba416) или numeric (22782998) формате
   * @returns {number} - Количество удаленных ключей
   */
  async deleteAllDeviceData(deviceId) {
    try {
      let hexId, numericId;

      // Определяем формат и конвертируем
      if (deviceId.startsWith("!")) {
        // Hex формат: !015ba416
        hexId = deviceId;
        numericId = parseInt(deviceId.substring(1), 16).toString();
      } else {
        // Numeric формат: 22782998
        numericId = deviceId;
        hexId = `!${parseInt(deviceId).toString(16).padStart(8, "0")}`;
      }

      console.log(
        `🗑️ Удаление всех данных для устройства: ${hexId} (${numericId})`
      );

      // Список всех возможных типов ключей (только новая схема)
      const keyPatterns = [
        // Новая схема (по portnum)
        `TEXT_MESSAGE_APP:${numericId}`,
        `POSITION_APP:${numericId}`,
        `NODEINFO_APP:${numericId}`,
        `TELEMETRY_APP:${numericId}`,
        `NEIGHBORINFO_APP:${numericId}`,
        `WAYPOINT_APP:${numericId}`,
        `MAP_REPORT_APP:${numericId}`,
        `TRACEROUTE_APP:${numericId}`,

        // Данные для карты
        `dots:${numericId}`,
      ];

      // Собираем все существующие ключи для удаления
      const keysToDelete = [];

      for (const pattern of keyPatterns) {
        const exists = await this.redis.exists(pattern);
        if (exists) {
          keysToDelete.push(pattern);
        }
      }

      // Ищем дополнительные ключи по паттернам (на случай если что-то пропустили)
      const additionalPatterns = [`*:${numericId}`, `*:${hexId}`];

      for (const pattern of additionalPatterns) {
        try {
          const keys = await this.redis.keys(pattern);
          for (const key of keys) {
            if (!keysToDelete.includes(key)) {
              keysToDelete.push(key);
            }
          }
        } catch (error) {
          console.warn(
            `Warning: couldn't search pattern ${pattern}: ${error.message}`
          );
        }
      }

      // Удаляем найденные ключи
      let deletedCount = 0;
      if (keysToDelete.length > 0) {
        deletedCount = await this.redis.del(...keysToDelete);
        console.log(
          `✅ Удалено ${deletedCount} ключей для устройства ${hexId}:`,
          keysToDelete
        );
      } else {
        console.log(`ℹ️ Данные для устройства ${hexId} не найдены`);
      }

      // Очищаем кэш для этого устройства
      this.invalidateUserCache(hexId);
      this.invalidateUserCache(numericId);

      // Очищаем дополнительные кэши
      const cacheKeysToDelete = [];
      this.cache.forEach((value, key) => {
        if (key.includes(hexId) || key.includes(numericId)) {
          cacheKeysToDelete.push(key);
        }
      });

      cacheKeysToDelete.forEach((key) => {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
      });

      if (cacheKeysToDelete.length > 0) {
        console.log(`🗑️ Очищено ${cacheKeysToDelete.length} записей из кэша`);
      }

      return deletedCount;
    } catch (error) {
      console.error(
        `Error deleting device data for ${deviceId}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Обновляет данные точки для карты
   * @param {string} deviceId - ID устройства (numeric)
   * @param {Object} updateData - Данные для обновления
   * @param {Object} options - Дополнительные опции (mqttCheck)
   */
  async updateDotData(deviceId, updateData, options = {}) {
    try {
      const key = `dots:${deviceId}`;
      const currentTime = Date.now();

      // Сначала читаем существующие данные
      const existingData = await this.redis.hgetall(key);

      // Определяем, какие поля нужно обновить
      const fieldsToUpdate = {};

      // Если есть данные о позиции - обновляем координаты
      if (
        updateData.longitude !== undefined ||
        updateData.latitude !== undefined
      ) {
        fieldsToUpdate.longitude = updateData.longitude;
        fieldsToUpdate.latitude = updateData.latitude;
      }

      // Если есть данные о node info - обновляем имена
      if (
        updateData.longName !== undefined ||
        updateData.shortName !== undefined
      ) {
        // Обновляем только те поля, которые действительно пришли
        if (updateData.longName !== undefined) {
          fieldsToUpdate.longName = updateData.longName;
        }
        if (updateData.shortName !== undefined) {
          fieldsToUpdate.shortName = updateData.shortName;
        }
      }

      // Проверяем условие MQTT: если gatewayId === rawDataId, устанавливаем mqtt: "1"
      // Это означает, что устройство отправляет сообщение через свой собственный gateway
      if (options && options.gatewayId && options.rawDataId) {
        // Проверяем, является ли это MQTT устройством
        // MQTT устройства имеют gatewayId равный своему собственному ID
        const isMqttDevice = options.gatewayId === options.rawDataId;

        if (isMqttDevice) {
          fieldsToUpdate.mqtt = "1";
        } else {
          // Не устанавливаем флаг mqtt для обычных устройств
        }
      }

      // Всегда обновляем время
      fieldsToUpdate.s_time = currentTime;

      // Объединяем существующие данные с обновляемыми полями
      const mergedData = {
        ...existingData,
        ...fieldsToUpdate,
      };

      // Используем общий метод фильтрации для объединенных данных
      const dotData = this._filterDotData(mergedData, currentTime);

      // Если нет полезных данных, не сохраняем в Redis
      if (!dotData) {
        // Проверяем, есть ли уже данные в Redis
        const existingKeys = Object.keys(existingData);
        if (existingKeys.length > 0) {
          // Если данные были, но стали бесполезными - удаляем ключ
          await this.redis.del(key);
        }
        return; // Выходим без сохранения
      }

      // Преобразуем числовые значения в строки для Redis
      const redisData = {};
      Object.entries(dotData).forEach(([key, value]) => {
        if (typeof value === "object" && value !== null) {
          redisData[key] = JSON.stringify(value);
        } else {
          redisData[key] = String(value);
        }
      });

      await this.redis.hset(key, redisData);

      // Инвалидируем кэш
      this.invalidateDotCache(deviceId);
    } catch (error) {
      console.error(`Error updating dot data for ${deviceId}:`, error.message);
    }
  }

  /**
   * Создает стандартную структуру данных точки
   * @param {Object} parsedData - Распарсенные данные из Redis
   * @param {string} deviceId - ID устройства
   * @returns {Object} - Стандартизированные данные
   */
  _createStandardDotData(parsedData, deviceId) {
    // Нормализуем названия полей для совместимости со старой структурой
    const normalizedData = {
      longName: parsedData.longName || parsedData["Long Name"] || "",
      shortName: parsedData.shortName || parsedData["Short Name"] || "",
      longitude: parsedData.longitude || 0,
      latitude: parsedData.latitude || 0,
      s_time: parsedData.s_time || 0,
      mqtt: parsedData.mqtt || "",
    };

    const result = this._filterDotData(normalizedData, parsedData.s_time || 0);

    // Если нет полезных данных, возвращаем null
    if (!result) {
      return null;
    }

    return result;
  }

  /**
   * Фильтрует и стандартизирует данные для dots
   * @param {Object} data - Входные данные
   * @param {number} timestamp - Временная метка (если не указана, используется текущее время)
   * @returns {Object|null} - Отфильтрованные и стандартизированные данные или null если данные невалидны
   */
  _filterDotData(data, timestamp = null) {
    const currentTime = timestamp || Date.now();

    // Определяем разрешенные поля
    const allowedFields = [
      "longName",
      "shortName",
      "longitude",
      "latitude",
      "mqtt",
    ];

    // Фильтруем только базовые поля и нормализуем значения
    const filteredData = {};
    Object.entries(data).forEach(([key, value]) => {
      if (
        allowedFields.includes(key) &&
        value !== undefined &&
        value !== null
      ) {
        // Нормализуем числовые значения
        if (key === "longitude" || key === "latitude") {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            filteredData[key] = numValue;
          }
        } else {
          // Для строковых полей сохраняем значение, даже если пустое (может быть обновление)
          filteredData[key] = value;
        }
      }
    });

    // Проверяем наличие геолокации или имени
    const hasLocation =
      typeof filteredData.longitude === "number" &&
      typeof filteredData.latitude === "number" &&
      filteredData.longitude !== 0 &&
      filteredData.latitude !== 0;

    // ИСПРАВЛЕНО: правильная проверка имен
    const hasName =
      (filteredData.longName &&
        typeof filteredData.longName === "string" &&
        filteredData.longName.trim() !== "") ||
      (filteredData.shortName &&
        typeof filteredData.shortName === "string" &&
        filteredData.shortName.trim() !== "");

    // Устройство валидно, если есть либо геолокация, либо имя
    const hasValidData = hasLocation || hasName;

    // Если нет полезных данных, возвращаем null
    if (!hasValidData) {
      return null;
    }

    // Возвращаем стандартизированную структуру
    const result = {
      longName: filteredData.longName || "",
      shortName: filteredData.shortName || "",
      longitude: filteredData.longitude || 0,
      latitude: filteredData.latitude || 0,
      mqtt: filteredData.mqtt || "",
      s_time: currentTime,
    };

    return result;
  }

  /**
   * Создает новую точку с базовой структурой
   * @param {string} deviceId - ID устройства (numeric)
   * @param {Object} initialData - Начальные данные
   * @returns {Object} - Созданные данные точки
   */
  async createDotData(deviceId, initialData = {}) {
    try {
      const key = `dots:${deviceId}`;
      const currentTime = Date.now();

      // Используем общий метод фильтрации
      const baseData = this._filterDotData(initialData, currentTime);

      // Если нет полезных данных, не создаем запись
      if (!baseData) {
        return null;
      }

      // Преобразуем в формат для Redis
      const redisData = {};
      Object.entries(baseData).forEach(([key, value]) => {
        if (typeof value === "object" && value !== null) {
          redisData[key] = JSON.stringify(value);
        } else {
          redisData[key] = String(value);
        }
      });

      await this.redis.hset(key, redisData);

      // Инвалидируем кэш
      this.invalidateDotCache(deviceId);

      return baseData;
    } catch (error) {
      console.error(`Error creating dot data for ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Получает данные точки для карты
   * @param {string} deviceId - ID устройства (numeric)
   * @returns {Object} - Данные точки
   */
  async getDotData(deviceId) {
    const cacheKey = `dot_${deviceId}`;

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const key = `dots:${deviceId}`;
      const data = await this.redis.hgetall(key);

      if (!data || Object.keys(data).length === 0) {
        return null;
      }

      // Парсим JSON поля обратно и приводим к новой структуре
      const parsedData = {};
      Object.entries(data).forEach(([key, value]) => {
        try {
          // Пытаемся распарсить как JSON
          parsedData[key] = JSON.parse(value);
        } catch {
          // Если не JSON, оставляем как строку (или конвертируем числа)
          if (!isNaN(value) && value !== "") {
            parsedData[key] = Number(value);
          } else {
            parsedData[key] = value;
          }
        }
      });

      // Приводим к стандартной структуре
      const standardData = this._createStandardDotData(parsedData, deviceId);

      // Кэшируем результат
      this.cache.set(cacheKey, standardData);
      this.cacheTimestamps.set(cacheKey, Date.now());

      return standardData;
    } catch (error) {
      console.error(`Error getting dot data for ${deviceId}:`, error.message);
      return null;
    }
  }

  /**
   * Получает все данные точек для карты
   * @returns {Object} - Объект с данными всех точек
   */
  async getAllDotData() {
    const cacheKey = "all_dots";

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const pattern = "dots:*";
      const keys = await this.redis.keys(pattern);

      if (keys.length === 0) {
        return {};
      }

      // Получаем данные для всех ключей параллельно
      const operations = keys.map((key) => ({
        command: "hgetall",
        args: [key],
      }));

      const results = await executeRedisPipeline(this.redis, operations);

      const allDots = {};
      keys.forEach((key, index) => {
        const deviceId = key.split(":")[1]; // Извлекаем ID из ключа dots:1234567
        const data = results[index];

        if (data && Object.keys(data).length > 0) {
          // Парсим данные как в getDotData
          const parsedData = {};
          Object.entries(data).forEach(([dataKey, value]) => {
            try {
              parsedData[dataKey] = JSON.parse(value);
            } catch {
              if (!isNaN(value) && value !== "") {
                parsedData[dataKey] = Number(value);
              } else {
                parsedData[dataKey] = value;
              }
            }
          });

          // Приводим к стандартной структуре
          const standardData = this._createStandardDotData(
            parsedData,
            deviceId
          );

          // Добавляем только устройства с полезными данными
          if (standardData) {
            allDots[deviceId] = standardData;
          }
        }
      });

      // Кэшируем результат
      this.cache.set(cacheKey, allDots);
      this.cacheTimestamps.set(cacheKey, Date.now());

      console.log(
        `🗺️ [CACHE STORE] Dots data cached for key: ${cacheKey}, count: ${
          Object.keys(allDots).length
        }`
      );

      return allDots;
    } catch (error) {
      console.error("Error getting all dot data:", error.message);
      return {};
    }
  }

  /**
   * Инвалидирует кэш для dot данных
   * @param {string} deviceId - ID устройства
   */
  invalidateDotCache(deviceId) {
    const cacheKey = `dot_${deviceId}`;
    this.cache.delete(cacheKey);
    this.cacheTimestamps.delete(cacheKey);

    // Также инвалидируем кэш всех точек
    this.cache.delete("all_dots");
    this.cacheTimestamps.delete("all_dots");
  }

  /**
   * Отключается от Redis
   */
  async disconnect() {
    try {
      await this.redis.quit();
      console.log("✅ Redis отключен");
    } catch (error) {
      console.error("Error disconnecting from Redis:", error.message);
    }
  }
}

export default RedisManager;
