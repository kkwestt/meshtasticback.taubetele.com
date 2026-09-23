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
    this.redis = new Redis({
      ...config,
      // Для основного сервиса настройки Redis могут быть из переменных окружения
      host: process.env.REDIS_HOST || config.host || "localhost",
      port: process.env.REDIS_PORT || config.port || 6379,
    });
    this.isQuerying = false;
    this.queryLock = new Map();

    // Индексы для оптимизации производительности
    this.deviceIndexKey = "devices:active";
    this.portnumIndexPrefix = "portnums:";
    this.indexCache = new Map();
    this.indexCacheTTL = 10000; // 10 секунд

    this.setupEventHandlers();
  }

  /**
   * Настраивает обработчики событий Redis
   */
  setupEventHandlers() {
    this.redis.on("error", (err) => {
      console.error("[HTTP-API] Redis Client Error:", err);
    });

    this.redis.on("connect", () => {
      console.log("✅ [HTTP-API] Connected to Redis");
    });

    this.redis.on("reconnecting", () => {
      console.log("🔄 [HTTP-API] Reconnecting to Redis...");
    });
  }

  /**
   * Проверяет подключение к Redis
   */
  async ping() {
    return await this.redis.ping();
  }

  /**
   * Использует SCAN вместо keys() для безопасного поиска ключей
   * @param {string} pattern - Паттерн для поиска
   * @param {number} batchSize - Размер батча для SCAN
   * @returns {Promise<Array>} - Массив найденных ключей
   */
  async _scanKeys(pattern, batchSize = 500, maxKeys = 200000) {
    const keys = [];
    // ВАЖНО: Redis возвращает курсор строкой ("0" в конце обхода).
    // Сравнение с числом 0 давало бесконечный цикл с бесконечным
    // ростом массива keys — это приводило к OOM процесса.
    let cursor = "0";

    do {
      const [newCursor, foundKeys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        batchSize
      );
      cursor = String(newCursor);

      for (const key of foundKeys) {
        keys.push(key);
      }

      if (keys.length >= maxKeys) {
        console.warn(
          `[${this.serviceName}] SCAN ${pattern}: достигнут лимит ${maxKeys} ключей, обход прерван`
        );
        break;
      }
    } while (cursor !== "0");

    return keys;
  }

  // ПРИМЕЧАНИЕ: Сохранение данных по portnum теперь выполняется в mqtt-receiver сервисе

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
      const keys = await this._scanKeys(pattern);

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
        const keys = await this._scanKeys(pattern);

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
          const keys = await this._scanKeys(pattern);
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

      return deletedCount;
    } catch (error) {
      console.error(
        `Error deleting device data for ${deviceId}:`,
        error.message
      );
      throw error;
    }
  }

  // ПРИМЕЧАНИЕ: Обновление данных точек теперь выполняется в mqtt-receiver сервисе

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

    // ИСПРАВЛЕНО: правильная проверка имен с валидацией
    const hasName =
      (filteredData.longName &&
        typeof filteredData.longName === "string" &&
        filteredData.longName.trim() !== "" &&
        filteredData.longName) ||
      (filteredData.shortName &&
        typeof filteredData.shortName === "string" &&
        filteredData.shortName.trim() !== "" &&
        filteredData.shortName);

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

  // ПРИМЕЧАНИЕ: Создание данных точек теперь выполняется в mqtt-receiver сервисе

  /**
   * Получает данные точки для карты
   * @param {string} deviceId - ID устройства (numeric)
   * @returns {Object} - Данные точки
   */
  async getDotData(deviceId) {
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
    try {
      // Используем индекс активных устройств вместо keys()
      const deviceIds = await this.getActiveDeviceIds();

      if (deviceIds.length === 0) {
        return {};
      }

      const allDots = {};
      const pipeline = this.redis.pipeline();

      deviceIds.forEach((deviceId) => {
        pipeline.hgetall(`dots:${deviceId}`);
      });

      const results = await pipeline.exec();

      deviceIds.forEach((deviceId, index) => {
        const result = results[index];
        if (result && result[1] && Object.keys(result[1]).length > 0) {
          const parsedData = {};

          Object.entries(result[1]).forEach(([field, value]) => {
            try {
              parsedData[field] = JSON.parse(value);
            } catch {
              parsedData[field] = value;
            }
          });

          const standardData = this._createStandardDotData(
            parsedData,
            deviceId
          );
          if (standardData) {
            allDots[deviceId] = standardData;
          }
        }
      });

      return allDots;
    } catch (error) {
      console.error("Error getting all dot data:", error.message);
      return {};
    }
  }

  /**
   * Создает индекс всех устройств для быстрого доступа
   * @returns {Promise<Array>} - Массив ID устройств
   */
  async createDeviceIndex() {
    try {
      const deviceIds = [];
      let cursor = "0";
      const batchSize = 500;

      do {
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          "dots:*",
          "COUNT",
          batchSize
        );
        cursor = String(newCursor);

        if (keys.length > 0) {
          // Извлекаем ID устройств из ключей
          keys.forEach((key) => {
            const deviceId = key.split(":")[1];
            if (deviceId) {
              deviceIds.push(deviceId);
            }
          });
        }
      } while (cursor !== "0");

      // Сохраняем индекс в Redis SET для быстрого доступа
      if (deviceIds.length > 0) {
        await this.redis.del(this.deviceIndexKey);
        await this.redis.sadd(this.deviceIndexKey, ...deviceIds);
        console.log(
          `📊 Создан индекс устройств: ${deviceIds.length} устройств`
        );
      }

      // Очищаем кэш после обновления индекса
      this.indexCache.clear();

      return deviceIds;
    } catch (error) {
      console.error("Error creating device index:", error.message);
      return [];
    }
  }

  /**
   * Получает список активных устройств из индекса (с кэшированием)
   * @returns {Promise<Array>} - Массив ID устройств
   */
  async getActiveDeviceIds() {
    const cacheKey = "active_devices";
    const now = Date.now();

    // Проверяем кэш
    if (this.indexCache.has(cacheKey)) {
      const cached = this.indexCache.get(cacheKey);
      if (now - cached.timestamp < this.indexCacheTTL) {
        return cached.data;
      }
    }

    try {
      // Получаем из Redis SET
      const deviceIds = await this.redis.smembers(this.deviceIndexKey);

      // Кэшируем результат
      this.indexCache.set(cacheKey, {
        data: deviceIds,
        timestamp: now,
      });

      return deviceIds;
    } catch (error) {
      console.error("Error getting active device IDs:", error.message);
      // Fallback к старому методу если индекс недоступен
      try {
        const pattern = "dots:*";
        const keys = await this._scanKeys(pattern);
        return keys.map((key) => key.replace("dots:", ""));
      } catch (fallbackError) {
        console.error("Fallback method also failed:", fallbackError.message);
        return [];
      }
    }
  }

  /**
   * Получает список устройств по типу сообщений
   * @param {string} portnumName - Название типа сообщения
   * @returns {Promise<Array>} - Массив ID устройств
   */
  async getDevicesByPortnum(portnumName) {
    const cacheKey = `devices_${portnumName}`;
    const now = Date.now();

    // Проверяем кэш
    if (this.indexCache.has(cacheKey)) {
      const cached = this.indexCache.get(cacheKey);
      if (now - cached.timestamp < this.indexCacheTTL) {
        return cached.data;
      }
    }

    try {
      // Используем индекс для получения устройств с данным типом сообщений
      const deviceIds = await this.redis.smembers(
        `${this.portnumIndexPrefix}${portnumName}`
      );

      // Кэшируем результат
      this.indexCache.set(cacheKey, {
        data: deviceIds,
        timestamp: now,
      });

      return deviceIds;
    } catch (error) {
      console.error("Error getting devices by portnum:", error.message);
      // Fallback к старому методу
      try {
        const pattern = `${portnumName}:*`;
        const keys = await this._scanKeys(pattern);
        return keys.map((key) => key.split(":")[1]);
      } catch (fallbackError) {
        console.error("Fallback method also failed:", fallbackError.message);
        return [];
      }
    }
  }

  /**
   * Получает оптимизированные данные точек для карты (только необходимые поля)
   */
  async getOptimizedDotData() {
    try {
      const startTime = Date.now();

      // Проверяем кэш
      const cacheKey = "optimized_dots_cache";
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        const duration = Date.now() - startTime;
        console.log(`[HTTP-API] Cached dots data retrieved in ${duration}ms`);
        return JSON.parse(cached);
      }

      // Используем SCAN для более эффективного получения ключей
      const deviceIds = await this.getActiveDeviceIds();

      if (deviceIds.length === 0) {
        return {};
      }

      // Используем pipeline для массовых операций
      const pipeline = this.redis.pipeline();

      // Добавляем только необходимые поля в pipeline
      deviceIds.forEach((deviceId) => {
        pipeline.hmget(
          `dots:${deviceId}`,
          "longName",
          "shortName",
          "longitude",
          "latitude",
          "s_time",
          "mqtt"
        );
      });

      const results = await pipeline.exec();
      const optimizedDots = {};

      // Обрабатываем результаты pipeline
      results.forEach(([err, values], index) => {
        if (err) {
          console.error(
            `Error getting data for device ${deviceIds[index]}:`,
            err
          );
          return;
        }

        const [longName, shortName, longitude, latitude, s_time, mqtt] = values;

        // Проверяем, что есть координаты (обязательно для карты)
        if (longitude && latitude) {
          optimizedDots[deviceIds[index]] = {
            longName: longName || "",
            shortName: shortName || "",
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            s_time: s_time ? parseInt(s_time) : 0,
            mqtt: mqtt || "",
          };
        }
      });

      // Кэшируем результат на 30 секунд
      await this.redis.setex(cacheKey, 30, JSON.stringify(optimizedDots));

      const duration = Date.now() - startTime;
      console.log(
        `[HTTP-API] Optimized dots data retrieved in ${duration}ms for ${
          Object.keys(optimizedDots).length
        } devices`
      );

      return optimizedDots;
    } catch (error) {
      console.error("Error getting optimized dot data:", error.message);
      return {};
    }
  }

  /**
   * Получает данные для карты в минимальном формате (только координаты и время)
   * @returns {Object} - Объект с данными точек в минимальном формате
   */
  async getMapData() {
    try {
      const startTime = Date.now();

      // Проверяем кэш
      const cacheKey = "map_data_cache";
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        const duration = Date.now() - startTime;
        console.log(`[HTTP-API] Cached map data retrieved in ${duration}ms`);
        return JSON.parse(cached);
      }

      // Используем SCAN для получения ключей
      const deviceIds = await this.getActiveDeviceIds();

      if (deviceIds.length === 0) {
        return {};
      }

      // Используем pipeline для массовых операций - только необходимые поля
      const pipeline = this.redis.pipeline();

      deviceIds.forEach((deviceId) => {
        pipeline.hmget(
          `dots:${deviceId}`,
          "longitude",
          "latitude",
          "s_time"
        );
      });

      const results = await pipeline.exec();
      const mapData = {};

      // Обрабатываем результаты pipeline
      results.forEach(([err, values], index) => {
        if (err) {
          console.error(
            `Error getting map data for device ${deviceIds[index]}:`,
            err
          );
          return;
        }

        const [longitude, latitude, s_time] = values;

        // Проверяем, что есть координаты (обязательно для карты)
        if (longitude && latitude) {
          mapData[deviceIds[index]] = {
            lon: parseFloat(longitude),
            lat: parseFloat(latitude),
            t: s_time ? parseInt(s_time) : 0,
          };
        }
      });

      // Кэшируем результат на 30 секунд
      await this.redis.setex(cacheKey, 30, JSON.stringify(mapData));

      const duration = Date.now() - startTime;
      console.log(
        `[HTTP-API] Map data retrieved in ${duration}ms for ${
          Object.keys(mapData).length
        } devices`
      );

      return mapData;
    } catch (error) {
      console.error("Error getting map data:", error.message);
      return {};
    }
  }

  /**
   * Инвалидирует кэш оптимизированных данных точек
   */
  async invalidateDotsCache() {
    try {
      await this.redis.del("optimized_dots_cache");
      await this.redis.del("map_data_cache"); // Также инвалидируем кэш карты
      console.log("[HTTP-API] Dots cache invalidated");
    } catch (error) {
      console.error("[HTTP-API] Error invalidating dots cache:", error.message);
    }
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
