import Redis from "ioredis";
import { executeRedisPipeline, CONSTANTS, getPortnumName } from "../utils.mjs";
import { isValidUserName } from "./validators.mjs";

const { MAX_METADATA_ITEMS_COUNT, DEVICE_EXPIRY_TIME, MAX_PORTNUM_MESSAGES } =
  CONSTANTS;

/**
 * Общий оптимизированный Redis Manager для обоих сервисов
 * Поддерживает как чтение (HTTP API), так и запись (MQTT Receiver)
 */
export class RedisManager {
  constructor(config, serviceName = "Service") {
    this.serviceName = serviceName;
    this.redis = new Redis({
      ...config,
      host: process.env.REDIS_HOST || config.host || "localhost",
      port: process.env.REDIS_PORT || config.port || 6379,
    });

    // Индексы для оптимизации производительности
    this.deviceIndexKey = "devices:active";
    this.portnumIndexPrefix = "portnums:";
    this.indexCache = new Map();
    this.indexCacheTTL = 10000; // 10 секунд

    // Защита от конкурентных pipeline и утечки памяти
    this._pipelineRunning = new Set();
    this._inMemCache = new Map();
    this._inMemCacheTTL = 35000; // 35 секунд

    // Single-flight: параллельные запросы к одному тяжёлому набору данных
    // ждут один общий промис вместо запуска дублирующих pipeline
    this._inFlight = new Map();

    // Максимальный размер одного pipeline (чтобы не собирать в памяти
    // десятки тысяч команд и их результатов одновременно)
    this.pipelineChunkSize = 1000;

    this.setupEventHandlers();
  }

  /**
   * Настраивает обработчики событий Redis
   */
  setupEventHandlers() {
    this.redis.on("error", (err) => {
      console.error(`[${this.serviceName}] Redis Client Error:`, err);
    });

    this.redis.on("connect", () => {
      console.log(`✅ [${this.serviceName}] Connected to Redis`);
    });

    this.redis.on("reconnecting", () => {
      console.log(`🔄 [${this.serviceName}] Reconnecting to Redis...`);
    });
  }

  _memCacheGet(key) {
    const entry = this._inMemCache.get(key);
    if (entry && Date.now() - entry.ts < this._inMemCacheTTL) return entry.data;
    return null;
  }

  _memCacheSet(key, data) {
    this._inMemCache.set(key, { data, ts: Date.now() });
  }

  /**
   * Выполняет pipeline порциями, чтобы не держать в памяти
   * сразу все команды и результаты (основная причина скачков heap).
   * @param {Array} items - элементы, по одному на команду
   * @param {Function} addCommand - (pipeline, item) => void
   * @param {Function} onResult - (err, value, item, index) => void
   */
  async _runChunkedPipeline(items, addCommand, onResult) {
    const chunkSize = this.pipelineChunkSize;

    for (let offset = 0; offset < items.length; offset += chunkSize) {
      const chunk = items.slice(offset, offset + chunkSize);
      const pipeline = this.redis.pipeline();

      for (const item of chunk) {
        addCommand(pipeline, item);
      }

      const results = await pipeline.exec();
      if (!results) continue;

      for (let i = 0; i < results.length; i++) {
        const [err, value] = results[i];
        onResult(err, value, chunk[i], offset + i);
      }
    }
  }

  /**
   * Кэш готовой JSON-строки: память -> Redis -> построение.
   *
   * Строка отдаётся клиенту как есть, без JSON.parse/JSON.stringify
   * на каждый запрос — это убирает основной источник больших
   * короткоживущих аллокаций в heap.
   *
   * @param {string} memKey - ключ in-memory кэша
   * @param {string} redisKey - ключ кэша в Redis
   * @param {number} ttlSeconds - TTL кэша в Redis
   * @param {Function} build - () => Promise<Object> построение данных
   * @returns {Promise<{json: string, count: number}>}
   */
  async _getCachedJson(memKey, redisKey, ttlSeconds, build) {
    const cached = this._memCacheGet(memKey);
    if (cached) return cached;

    const inFlight = this._inFlight.get(memKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const countKey = `${redisKey}:count`;
      const [json, count] = await this.redis
        .mget(redisKey, countKey)
        .catch(() => [null, null]);

      if (json) {
        const entry = { json, count: Number(count) || 0 };
        this._memCacheSet(memKey, entry);
        return entry;
      }

      const data = await build();
      const entry = {
        json: JSON.stringify(data),
        count: Object.keys(data).length,
      };

      await this.redis
        .pipeline()
        .setex(redisKey, ttlSeconds, entry.json)
        .setex(countKey, ttlSeconds, String(entry.count))
        .exec()
        .catch(() => {});

      this._memCacheSet(memKey, entry);
      return entry;
    })();

    this._inFlight.set(memKey, promise);

    try {
      return await promise;
    } finally {
      this._inFlight.delete(memKey);
    }
  }

  /**
   * Проверяет подключение к Redis
   */
  async ping() {
    return await this.redis.ping();
  }

  // ========== МЕТОДЫ ДЛЯ ЗАПИСИ (MQTT Receiver) ==========

  /**
   * Проверяет, является ли сообщение дубликатом (за последние 5 секунд)
   * Оптимизированная версия с ранним выходом
   */
  async isDuplicateMessage(key, newMessage, timeWindow = 5000) {
    try {
      const currentTime = newMessage.timestamp || Date.now();

      // Получаем только последнее сообщение для проверки
      const recentMessages = await this.redis.lrange(key, -1, -1);

      // Ранний выход: нет предыдущих сообщений
      if (recentMessages.length === 0) {
        return false;
      }

      try {
        const existingMsg = JSON.parse(recentMessages[0]);

        // Ранний выход: проверка временного окна
        const timeDiff = currentTime - existingMsg.timestamp;
        if (timeDiff < 0 || timeDiff > timeWindow) {
          return false;
        }

        // Оптимизированное сравнение: удаляем только нужные поля
        const fieldsToCompare = { ...newMessage };
        const fieldsExisting = { ...existingMsg };
        delete fieldsToCompare.timestamp;
        delete fieldsToCompare.gatewayId;
        delete fieldsExisting.timestamp;
        delete fieldsExisting.gatewayId;

        // Сравниваем только измененные поля
        return (
          JSON.stringify(fieldsToCompare) === JSON.stringify(fieldsExisting)
        );
      } catch {
        return false;
      }
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error checking duplicate message:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Сохраняет сообщение по portnum
   */
  async savePortnumMessage(portnum, deviceId, messageData) {
    try {
      const portnumName = getPortnumName(portnum);
      if (!portnumName) {
        return; // Ранний выход для неизвестных portnum
      }

      const key = `${portnumName}:${deviceId}`;
      const messageWithTimestamp = {
        timestamp: Date.now(),
        ...messageData,
      };

      // Проверяем на дубликаты за последние 3 секунды
      const isDuplicate = await this.isDuplicateMessage(
        key,
        messageWithTimestamp,
        3000
      );
      if (isDuplicate) {
        return; // Пропускаем дубликат
      }

      // Используем pipeline для атомарной операции
      const pipeline = this.redis.pipeline();
      pipeline.rpush(key, JSON.stringify(messageWithTimestamp));
      pipeline.ltrim(key, -MAX_PORTNUM_MESSAGES, -1);
      await pipeline.exec();
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error saving portnum message:`,
        error.message
      );
    }
  }

  /**
   * Оптимизированная проверка изменений данных
   */
  _hasDataChanges(existingData, updateData, timeDiff) {
    // Ранний выход: если прошло больше 3 секунд, всегда обновляем
    if (timeDiff >= 3000) {
      return true;
    }

    // Проверяем координаты
    if (
      updateData.longitude !== undefined ||
      updateData.latitude !== undefined
    ) {
      const existingLon = parseFloat(existingData.longitude) || 0;
      const existingLat = parseFloat(existingData.latitude) || 0;
      if (
        existingLon !== updateData.longitude ||
        existingLat !== updateData.latitude
      ) {
        return true;
      }
    }

    // Проверяем имена
    if (
      updateData.longName !== undefined ||
      updateData.shortName !== undefined
    ) {
      const newLongName =
        updateData.longName !== undefined
          ? updateData.longName
          : existingData.longName || "";
      const newShortName =
        updateData.shortName !== undefined
          ? updateData.shortName
          : existingData.shortName || "";

      if (
        newLongName !== (existingData.longName || "") ||
        newShortName !== (existingData.shortName || "")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Обновляет данные точки для карты (оптимизированная версия)
   */
  async updateDotData(deviceId, updateData, options = {}) {
    const { portnum = "UNKNOWN" } = options;
    try {
      const key = `dots:${deviceId}`;
      const currentTime = Date.now();

      // Читаем существующие данные
      const existingData = await this.redis.hgetall(key);

      // Оптимизированная проверка дубликатов
      if (Object.keys(existingData).length > 0 && existingData.s_time) {
        const lastUpdateTime = parseInt(existingData.s_time);
        const timeDiff = currentTime - lastUpdateTime;

        if (timeDiff >= 0 && timeDiff < 3000) {
          if (!this._hasDataChanges(existingData, updateData, timeDiff)) {
            return; // Нет изменений, пропускаем запись
          }
        }
      }

      // Определяем поля для обновления
      const fieldsToUpdate = {};

      // Координаты
      if (
        updateData.longitude !== undefined ||
        updateData.latitude !== undefined
      ) {
        fieldsToUpdate.longitude = updateData.longitude;
        fieldsToUpdate.latitude = updateData.latitude;
      }

      // Имена с валидацией
      if (
        updateData.longName !== undefined ||
        updateData.shortName !== undefined
      ) {
        if (updateData.longName !== undefined) {
          fieldsToUpdate.longName =
            updateData.longName && isValidUserName(updateData.longName)
              ? updateData.longName
              : "";
        }
        if (updateData.shortName !== undefined) {
          fieldsToUpdate.shortName =
            updateData.shortName && isValidUserName(updateData.shortName)
              ? updateData.shortName
              : "";
        }
      }

      // MQTT флаг
      if (options?.gatewayId && options?.rawDataId) {
        fieldsToUpdate.mqtt =
          options.gatewayId === options.rawDataId ? "1" : "0";
      }

      fieldsToUpdate.s_time = currentTime;

      // Объединяем данные
      const mergedData = { ...existingData, ...fieldsToUpdate };
      const dotData = this._filterDotData(mergedData, currentTime);

      // Если нет полезных данных, удаляем запись
      if (!dotData) {
        if (Object.keys(existingData).length > 0) {
          const pipeline = this.redis.pipeline();
          pipeline.del(key);
          pipeline.srem(this.deviceIndexKey, deviceId);
          if (portnum !== "UNKNOWN") {
            pipeline.srem(`${this.portnumIndexPrefix}${portnum}`, deviceId);
          }
          await pipeline.exec();
        }
        return;
      }

      // Преобразуем в формат Redis
      const redisData = {};
      for (const [key, value] of Object.entries(dotData)) {
        redisData[key] =
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value);
      }

      // Атомарное обновление с индексами
      const pipeline = this.redis.pipeline();
      pipeline.hset(key, redisData);
      pipeline.sadd(this.deviceIndexKey, deviceId);
      if (portnum !== "UNKNOWN") {
        pipeline.sadd(`${this.portnumIndexPrefix}${portnum}`, deviceId);
      }
      await pipeline.exec();
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error updating dot data for ${deviceId}:`,
        error.message
      );
    }
  }

  /**
   * Оптимизированная фильтрация данных для dots
   */
  _filterDotData(data, timestamp = null) {
    const currentTime = timestamp || Date.now();
    const allowedFields = [
      "longName",
      "shortName",
      "longitude",
      "latitude",
      "mqtt",
    ];

    // Оптимизированная фильтрация с ранним выходом
    const filteredData = {};
    let hasLocation = false;
    let hasName = false;

    for (const [key, value] of Object.entries(data)) {
      if (
        !allowedFields.includes(key) ||
        value === undefined ||
        value === null
      ) {
        continue;
      }

      if (key === "longitude" || key === "latitude") {
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          filteredData[key] = numValue;
          if (numValue !== 0) {
            hasLocation = true;
          }
        }
      } else {
        filteredData[key] = value;
        // Оптимизированная проверка имени
        if (
          (key === "longName" || key === "shortName") &&
          typeof value === "string" &&
          value.trim() !== "" &&
          isValidUserName(value)
        ) {
          hasName = true;
        }
      }
    }

    // Ранний выход: нет полезных данных
    if (!hasLocation && !hasName) {
      return null;
    }

    return {
      longName: filteredData.longName || "",
      shortName: filteredData.shortName || "",
      longitude: filteredData.longitude || 0,
      latitude: filteredData.latitude || 0,
      mqtt: filteredData.mqtt || "",
      s_time: currentTime,
    };
  }

  /**
   * Обновляет индекс активных устройств
   */
  async updateDeviceIndex(deviceId) {
    try {
      await this.redis.sadd(this.deviceIndexKey, deviceId);
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error updating device index:`,
        error.message
      );
    }
  }

  /**
   * Удаляет устройство из индекса активных устройств
   */
  async removeFromDeviceIndex(deviceId) {
    try {
      await this.redis.srem(this.deviceIndexKey, deviceId);
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error removing device from index:`,
        error.message
      );
    }
  }

  /**
   * Обновляет индекс устройств по типу сообщений
   */
  async updatePortnumIndex(deviceId, portnum) {
    try {
      await this.redis.sadd(`${this.portnumIndexPrefix}${portnum}`, deviceId);
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error updating portnum index:`,
        error.message
      );
    }
  }

  /**
   * Удаляет устройство из индекса типов сообщений
   */
  async removeFromPortnumIndex(deviceId, portnum) {
    try {
      await this.redis.srem(`${this.portnumIndexPrefix}${portnum}`, deviceId);
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error removing device from portnum index:`,
        error.message
      );
    }
  }

  // ========== МЕТОДЫ ДЛЯ ЧТЕНИЯ (HTTP API) ==========

  /**
   * Получает сообщения по portnum для устройства
   */
  async getPortnumMessages(
    portnumName,
    deviceId,
    limit = MAX_PORTNUM_MESSAGES
  ) {
    try {
      const key = `${portnumName}:${deviceId}`;
      const data = await this.redis.lrange(key, -limit, -1);

      const result = [];
      for (let i = data.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(data[i]);
          if (parsed) result.push(parsed);
        } catch {
          // Пропускаем некорректные записи
        }
      }

      return result;
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting portnum messages:`,
        error.message
      );
      return [];
    }
  }

  /**
   * Получает все сообщения определенного типа (использует SCAN вместо keys)
   */
  async getAllPortnumMessages(portnumName) {
    try {
      const pattern = `${portnumName}:*`;
      const keys = await this._scanKeys(pattern);

      if (keys.length === 0) {
        return {};
      }

      const operations = keys.map((key) => ({
        command: "lrange",
        args: [key, -MAX_PORTNUM_MESSAGES, -1],
      }));

      const results = await executeRedisPipeline(this.redis, operations);
      const allMessages = {};

      for (let i = 0; i < keys.length; i++) {
        const deviceId = keys[i].split(":")[1];
        const messages = results[i]
          .map((item) => {
            try {
              return JSON.parse(item);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .reverse();

        if (messages.length > 0) {
          allMessages[deviceId] = messages;
        }
      }

      return allMessages;
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting all portnum messages:`,
        error.message
      );
      return {};
    }
  }

  /**
   * Использует SCAN вместо keys() для безопасного поиска ключей
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

  /**
   * Получает статистику по portnum (использует SCAN)
   */
  async getPortnumStats() {
    // Полное сканирование keyspace — самая дорогая операция сервиса,
    // поэтому результат кэшируется (память + Redis) и считается
    // не чаще одного раза на TTL, с защитой от параллельных запусков.
    try {
      const { json } = await this._getCachedJson(
        "portnumStats",
        "portnum_stats_cache",
        300,
        () => this._buildPortnumStats()
      );
      return JSON.parse(json);
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting portnum stats:`,
        error.message
      );
      return {};
    }
  }

  /**
   * Считает статистику по portnum (полный SCAN, без кэша)
   */
  async _buildPortnumStats() {
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
          let totalMessages = 0;

          await this._runChunkedPipeline(
            keys,
            (pipeline, key) => pipeline.llen(key),
            (err, length) => {
              if (!err && typeof length === "number") {
                totalMessages += length;
              }
            }
          );

          stats[portnumName].totalMessages = totalMessages;
        }
      }

      return stats;
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting portnum stats:`,
        error.message
      );
      return {};
    }
  }

  /**
   * Удаляет все данные устройства из Redis (использует SCAN)
   */
  async deleteAllDeviceData(deviceId) {
    try {
      let hexId, numericId;

      if (deviceId.startsWith("!")) {
        hexId = deviceId;
        numericId = parseInt(deviceId.substring(1), 16).toString();
      } else {
        numericId = deviceId;
        hexId = `!${parseInt(deviceId).toString(16).padStart(8, "0")}`;
      }

      const keyPatterns = [
        `TEXT_MESSAGE_APP:${numericId}`,
        `POSITION_APP:${numericId}`,
        `NODEINFO_APP:${numericId}`,
        `TELEMETRY_APP:${numericId}`,
        `NEIGHBORINFO_APP:${numericId}`,
        `WAYPOINT_APP:${numericId}`,
        `MAP_REPORT_APP:${numericId}`,
        `TRACEROUTE_APP:${numericId}`,
        `dots:${numericId}`,
      ];

      const keysToDelete = [];

      // Проверяем существование ключей
      for (const pattern of keyPatterns) {
        const exists = await this.redis.exists(pattern);
        if (exists) {
          keysToDelete.push(pattern);
        }
      }

      // Используем SCAN для поиска дополнительных ключей
      const additionalPatterns = [`*:${numericId}`, `*:${hexId}`];
      for (const pattern of additionalPatterns) {
        const keys = await this._scanKeys(pattern);
        for (const key of keys) {
          if (!keysToDelete.includes(key)) {
            keysToDelete.push(key);
          }
        }
      }

      if (keysToDelete.length > 0) {
        const deletedCount = await this.redis.del(...keysToDelete);
        return deletedCount;
      }

      return 0;
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error deleting device data:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Получает данные точки для карты
   */
  async getDotData(deviceId) {
    try {
      const key = `dots:${deviceId}`;
      const data = await this.redis.hgetall(key);

      if (!data || Object.keys(data).length === 0) {
        return null;
      }

      const parsedData = {};
      for (const [key, value] of Object.entries(data)) {
        try {
          parsedData[key] = JSON.parse(value);
        } catch {
          parsedData[key] =
            !isNaN(value) && value !== "" ? Number(value) : value;
        }
      }

      return this._createStandardDotData(parsedData, deviceId);
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting dot data:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Создает стандартную структуру данных точки
   */
  _createStandardDotData(parsedData, deviceId) {
    const normalizedData = {
      longName: parsedData.longName || parsedData["Long Name"] || "",
      shortName: parsedData.shortName || parsedData["Short Name"] || "",
      longitude: parsedData.longitude || 0,
      latitude: parsedData.latitude || 0,
      s_time: parsedData.s_time || 0,
      mqtt: parsedData.mqtt || "",
    };

    return this._filterDotData(normalizedData, parsedData.s_time || 0);
  }

  /**
   * Получает все данные точек для карты
   */
  async getAllDotData() {
    const _key = 'allDots';
    const _memHit = this._memCacheGet(_key);
    if (_memHit) return _memHit;
    if (this._pipelineRunning.has(_key)) {
      return this._inMemCache.get(_key)?.data || {};
    }
    this._pipelineRunning.add(_key);
    try {
      const deviceIds = await this.getActiveDeviceIds();

      if (deviceIds.length === 0) {
        return {};
      }

      const pipeline = this.redis.pipeline();
      deviceIds.forEach((deviceId) => {
        pipeline.hgetall(`dots:${deviceId}`);
      });

      // Выполняем pipeline с обработкой таймаутов
      let results;
      try {
        // Используем Promise.race для добавления таймаута на уровне приложения
        const pipelinePromise = pipeline.exec();
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Pipeline timeout after 30 seconds")),
            30000
          );
        });
        try {
          results = await Promise.race([pipelinePromise, timeoutPromise]);
          clearTimeout(timeoutId); // Очищаем таймаут если pipeline выполнился успешно
        } catch (error) {
          clearTimeout(timeoutId); // Очищаем таймаут при ошибке
          throw error;
        }
      } catch (error) {
        console.error(
          `[${this.serviceName}] Pipeline execution failed in getAllDotData:`,
          error.message
        );
        // Возвращаем пустой объект при критической ошибке pipeline
        return {};
      }

      const allDots = {};

      for (let i = 0; i < deviceIds.length; i++) {
        const result = results[i];
        // Проверяем наличие ошибки в результате
        if (result && result[0]) {
          console.error(
            `[${this.serviceName}] Error getting data for device ${deviceIds[i]}:`,
            result[0].message || result[0]
          );
          continue;
        }
        if (result && result[1] && Object.keys(result[1]).length > 0) {
          const parsedData = {};
          for (const [field, value] of Object.entries(result[1])) {
            try {
              parsedData[field] = JSON.parse(value);
            } catch {
              parsedData[field] = value;
            }
          }

          const standardData = this._createStandardDotData(
            parsedData,
            deviceIds[i]
          );
          if (standardData) {
            allDots[deviceIds[i]] = standardData;
          }
        }
      }

      this._memCacheSet(_key, allDots);
      return allDots;
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting all dot data:`,
        error.message
      );
      return {};
    } finally {
      this._pipelineRunning.delete(_key);
    }
  }

  /**
   * Создает индекс всех устройств для быстрого доступа
   */
  async createDeviceIndex() {
    try {
      const deviceIds = [];
      const keys = await this._scanKeys("dots:*", 100);

      for (const key of keys) {
        const deviceId = key.split(":")[1];
        if (deviceId) {
          deviceIds.push(deviceId);
        }
      }

      if (deviceIds.length > 0) {
        const pipeline = this.redis.pipeline();
        pipeline.del(this.deviceIndexKey);
        pipeline.sadd(this.deviceIndexKey, ...deviceIds);
        await pipeline.exec();
        this.indexCache.clear();
      }

      return deviceIds;
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error creating device index:`,
        error.message
      );
      return [];
    }
  }

  /**
   * Получает список активных устройств из индекса (с кэшированием)
   */
  async getActiveDeviceIds() {
    const cacheKey = "active_devices";
    const now = Date.now();

    if (this.indexCache.has(cacheKey)) {
      const cached = this.indexCache.get(cacheKey);
      if (now - cached.timestamp < this.indexCacheTTL) {
        return cached.data;
      }
    }

    try {
      const deviceIds = await this.redis.smembers(this.deviceIndexKey);
      this.indexCache.set(cacheKey, { data: deviceIds, timestamp: now });
      return deviceIds;
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting active device IDs:`,
        error.message
      );
      // Fallback к SCAN
      try {
        const keys = await this._scanKeys("dots:*");
        return keys.map((key) => key.replace("dots:", ""));
      } catch {
        return [];
      }
    }
  }

  /**
   * Получает список устройств по типу сообщений
   */
  async getDevicesByPortnum(portnumName) {
    const cacheKey = `devices_${portnumName}`;
    const now = Date.now();

    if (this.indexCache.has(cacheKey)) {
      const cached = this.indexCache.get(cacheKey);
      if (now - cached.timestamp < this.indexCacheTTL) {
        return cached.data;
      }
    }

    try {
      const deviceIds = await this.redis.smembers(
        `${this.portnumIndexPrefix}${portnumName}`
      );
      this.indexCache.set(cacheKey, { data: deviceIds, timestamp: now });
      return deviceIds;
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting devices by portnum:`,
        error.message
      );
      // Fallback к SCAN
      try {
        const keys = await this._scanKeys(`${portnumName}:*`);
        return keys.map((key) => key.split(":")[1]);
      } catch {
        return [];
      }
    }
  }

  /**
   * Строит оптимизированные данные точек для карты (без кэша)
   */
  async _buildOptimizedDotData() {
    const deviceIds = await this.getActiveDeviceIds();
    if (deviceIds.length === 0) {
      return {};
    }

    const optimizedDots = {};

    await this._runChunkedPipeline(
      deviceIds,
      (pipeline, deviceId) =>
        pipeline.hmget(
          `dots:${deviceId}`,
          "longName",
          "shortName",
          "longitude",
          "latitude",
          "s_time",
          "mqtt"
        ),
      (err, values, deviceId) => {
        if (err) {
          console.error(
            `[${this.serviceName}] Error getting data for device ${deviceId}:`,
            err.message || err
          );
          return;
        }

        const [longName, shortName, longitude, latitude, s_time, mqtt] = values;
        if (longitude && latitude) {
          optimizedDots[deviceId] = {
            longName: longName || "",
            shortName: shortName || "",
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            s_time: s_time ? parseInt(s_time) : 0,
            mqtt: mqtt || "",
          };
        }
      }
    );

    return optimizedDots;
  }

  /**
   * Получает оптимизированные данные точек для карты как готовую JSON-строку
   * @returns {Promise<{json: string, count: number}>}
   */
  async getOptimizedDotDataJSON() {
    try {
      return await this._getCachedJson(
        "optimizedDots",
        "optimized_dots_cache",
        30,
        () => this._buildOptimizedDotData()
      );
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting optimized dot data:`,
        error.message
      );
      return { json: "{}", count: 0 };
    }
  }

  /**
   * Получает оптимизированные данные точек для карты (объект)
   */
  async getOptimizedDotData() {
    const { json } = await this.getOptimizedDotDataJSON();
    return JSON.parse(json);
  }

  /**
   * Строит данные для карты в минимальном формате (без кэша)
   */
  async _buildMapData() {
    const deviceIds = await this.getActiveDeviceIds();
    if (deviceIds.length === 0) {
      return {};
    }

    const mapData = {};

    await this._runChunkedPipeline(
      deviceIds,
      (pipeline, deviceId) =>
        pipeline.hmget(`dots:${deviceId}`, "longitude", "latitude", "s_time"),
      (err, values, deviceId) => {
        if (err) {
          console.error(
            `[${this.serviceName}] Error getting map data for device ${deviceId}:`,
            err.message || err
          );
          return;
        }

        const [longitude, latitude, s_time] = values;
        if (longitude && latitude) {
          mapData[deviceId] = {
            lon: parseFloat(longitude),
            lat: parseFloat(latitude),
            t: s_time ? parseInt(s_time) : 0,
          };
        }
      }
    );

    return mapData;
  }

  /**
   * Получает данные для карты в минимальном формате как готовую JSON-строку
   * @returns {Promise<{json: string, count: number}>}
   */
  async getMapDataJSON() {
    try {
      return await this._getCachedJson("mapData", "map_data_cache", 30, () =>
        this._buildMapData()
      );
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting map data:`,
        error.message
      );
      return { json: "{}", count: 0 };
    }
  }

  /**
   * Получает данные для карты в минимальном формате (объект)
   */
  async getMapData() {
    const { json } = await this.getMapDataJSON();
    return JSON.parse(json);
  }

  /**
   * Получает данные meshcore-устройств как готовую JSON-строку
   * @returns {Promise<{json: string, count: number}>}
   */
  async getMeshcoreDotsJSON() {
    try {
      return await this._getCachedJson(
        "meshcoreDots",
        "dots_meshcore_cache",
        30,
        () => this._buildMeshcoreDots()
      );
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error getting meshcore dots:`,
        error.message
      );
      return { json: "{}", count: 0 };
    }
  }

  /**
   * Строит данные meshcore-устройств из ключей dots_meshcore:* (без кэша)
   */
  async _buildMeshcoreDots() {
    const keys = await this._scanKeys("dots_meshcore:*", 500);
    if (keys.length === 0) {
      return {};
    }

    const result = {};

    await this._runChunkedPipeline(
      keys,
      (pipeline, key) => pipeline.hgetall(key),
      (err, hashData, key) => {
        if (err || !hashData || Object.keys(hashData).length === 0) return;

        const deviceId = key.replace("dots_meshcore:", "");
        const parsedData = {};

        for (const [field, value] of Object.entries(hashData)) {
          try {
            parsedData[field] = JSON.parse(value);
          } catch {
            // Для координат: пустые строки и "0" преобразуем в null для согласованности
            if (
              (field === "lat" || field === "lon") &&
              (value === "" || value === "0")
            ) {
              parsedData[field] = null;
            } else if (!isNaN(value) && value !== "") {
              parsedData[field] = Number(value);
            } else {
              parsedData[field] = value;
            }
          }
        }

        result[deviceId] = parsedData;
      }
    );

    return result;
  }

  /**
   * Инвалидирует кэш оптимизированных данных точек
   */
  async invalidateDotsCache() {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.del("optimized_dots_cache");
      pipeline.del("optimized_dots_cache:count");
      pipeline.del("map_data_cache");
      pipeline.del("map_data_cache:count");
      await pipeline.exec();

      this._inMemCache.delete("optimizedDots");
      this._inMemCache.delete("mapData");
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error invalidating dots cache:`,
        error.message
      );
    }
  }

  /**
   * Сохраняет данные meshcore устройства в отдельный ключ Redis
   * @param {string} deviceId - ID устройства (public_key из ADVERT пакета)
   * @param {Object} data - Данные для сохранения {device_id, lat, lon, name, gateway_origin, gateway_origin_id, s_time}
   */
  async saveMeshcoreDot(deviceId, data) {
    try {
      const key = `dots_meshcore:${deviceId}`;
      // Всегда используем время сервера для s_time (по аналогии с meshtastic данными)
      const currentTime = Date.now();

      console.log(
        `🔧 [${this.serviceName}] Redis: Сохранение в ключ ${key}`
      );

      // Читаем существующие данные для объединения
      const existingData = await this.redis.hgetall(key);

      // Подготавливаем поля для обновления (обновляем только те, которые пришли в новом пакете)
      const fieldsToUpdate = {};

      // Обновляем device_id только если он передан
      if (data.device_id !== undefined) {
        fieldsToUpdate.device_id = String(data.device_id || deviceId);
      } else if (existingData.device_id) {
        fieldsToUpdate.device_id = existingData.device_id;
      } else {
        fieldsToUpdate.device_id = String(deviceId);
      }

      // Обновляем координаты только если они переданы и не равны 0
      if (data.lat !== undefined && data.lat !== null && data.lat !== 0) {
        fieldsToUpdate.lat = String(data.lat);
      } else if (existingData.lat && existingData.lat !== "") {
        fieldsToUpdate.lat = existingData.lat;
      } else {
        fieldsToUpdate.lat = "";
      }

      if (data.lon !== undefined && data.lon !== null && data.lon !== 0) {
        fieldsToUpdate.lon = String(data.lon);
      } else if (existingData.lon && existingData.lon !== "") {
        fieldsToUpdate.lon = existingData.lon;
      } else {
        fieldsToUpdate.lon = "";
      }

      // Обновляем имя только если оно передано
      if (data.name !== undefined && data.name !== null && data.name !== "") {
        fieldsToUpdate.name = String(data.name);
      } else if (existingData.name && existingData.name !== "") {
        fieldsToUpdate.name = existingData.name;
      } else {
        fieldsToUpdate.name = "";
      }

      // Обновляем информацию о шлюзе (всегда обновляем, так как это может измениться)
      fieldsToUpdate.gateway_origin = String(data.gateway_origin || "");
      fieldsToUpdate.gateway_origin_id = String(data.gateway_origin_id || "");

      // Объединяем существующие данные с обновляемыми полями
      const dotData = {
        ...existingData,
        ...fieldsToUpdate,
      };

      // Всегда обновляем время сервера (гарантируем обновление при каждом вызове)
      dotData.s_time = String(currentTime);

      console.log(
        `🔧 [${this.serviceName}] Redis: Данные для сохранения:`,
        JSON.stringify(dotData)
      );

      // Сохраняем как hash в Redis
      // hset обновляет существующие поля и добавляет новые
      const result = await this.redis.hset(key, dotData);
      console.log(`🔧 [${this.serviceName}] Redis: hset результат: ${result} (0 = все поля уже существовали, >0 = добавлены новые поля)`);

      // Устанавливаем TTL (время жизни ключа) - 3 часа
      const expireResult = await this.redis.expire(key, DEVICE_EXPIRY_TIME);
      console.log(`🔧 [${this.serviceName}] Redis: expire результат: ${expireResult}`);

      // Инвалидируем кэш эндпоинта dots_meshcore для быстрого обновления данных
      try {
        await this.redis.del("dots_meshcore_cache", "dots_meshcore_cache:count");
      } catch (cacheError) {
        // Игнорируем ошибки инвалидации кэша
        console.log(`⚠️ [${this.serviceName}] Не удалось инвалидировать кэш: ${cacheError.message}`);
      }

      // Проверяем, что данные сохранились
      const savedData = await this.redis.hgetall(key);
      console.log(
        `✅ [${this.serviceName}] Redis: Проверка сохраненных данных для ${key}:`,
        JSON.stringify(savedData)
      );
      
      // Дополнительная проверка - получаем отдельные поля
      const checkDeviceId = await this.redis.hget(key, "device_id");
      const checkLat = await this.redis.hget(key, "lat");
      const checkLon = await this.redis.hget(key, "lon");
      const checkName = await this.redis.hget(key, "name");
      console.log(
        `🔍 [${this.serviceName}] Redis: Проверка полей - device_id: ${checkDeviceId}, lat: ${checkLat}, lon: ${checkLon}, name: ${checkName}`
      );
    } catch (error) {
      console.error(
        `❌ [${this.serviceName}] Error saving meshcore dot for ${deviceId}:`,
        error.message,
        error.stack
      );
    }
  }

  /**
   * Отключается от Redis
   */
  async disconnect() {
    try {
      await this.redis.quit();
      console.log(`✅ [${this.serviceName}] Redis отключен`);
    } catch (error) {
      console.error(
        `[${this.serviceName}] Error disconnecting from Redis:`,
        error.message
      );
    }
  }
}

export default RedisManager;
