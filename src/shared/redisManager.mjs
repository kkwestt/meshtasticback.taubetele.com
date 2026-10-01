import Redis from "ioredis";
import { CONSTANTS } from "../utils.mjs";
import { isValidUserName } from "./validators.mjs";

const { MAX_PORTNUM_MESSAGES } = CONSTANTS;

/**
 * Redis Manager HTTP API сервиса (чтение данных и удаление через админку).
 * Запись данных выполняет отдельный сервис mqtt-receiver.
 */
export class RedisManager {
  constructor(config, serviceName = "Service") {
    this.serviceName = serviceName;
    this.redis = new Redis({
      ...config,
      host: process.env.REDIS_HOST || config.host || "localhost",
      port: process.env.REDIS_PORT || config.port || 6379,
    });

    // Индекс активных устройств
    this.deviceIndexKey = "devices:active";
    this.indexCache = new Map();
    this.indexCacheTTL = 10000; // 10 секунд

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
   * Сохраняет meshcore-устройства, присланные извне (компонент Home Assistant),
   * в те же ключи dots_meshcore:{PUBLIC_KEY}, что пишет mqtt-receiver.
   *
   * s_time — время последнего эфира устройства (мс), а не время приёма запроса:
   * по нему карта решает «в сети» или «был давно». Более старое значение
   * никогда не затирает более свежее (например, от MQTT).
   *
   * @param {Array<Object>} nodes - уже провалидированные устройства
   *   {public_key, name, lat, lon, heard_at, type}
   * @param {string} source - кто прислал (имя ноды HA)
   * @param {number} ttlSeconds - минимальное время жизни ключа
   * @returns {Promise<number>} сколько ключей записано
   */
  async saveMeshcoreDots(nodes, source, ttlSeconds) {
    if (nodes.length === 0) return 0;

    const now = Date.now();
    const keys = nodes.map((node) => `dots_meshcore:${node.public_key}`);

    const existing = [];
    await this._runChunkedPipeline(
      keys,
      (pipeline, key) => pipeline.hgetall(key),
      (err, value, _key, index) => {
        existing[index] = err || !value ? {} : value;
      }
    );

    const pipeline = this.redis.pipeline();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const old = existing[i] || {};
      const fields = {
        device_id: node.public_key,
        ha_source: source,
        ha_time: String(now),
      };

      if (node.name) fields.name = node.name;
      else if (!old.name) fields.name = "";

      if (node.lat !== null && node.lon !== null) {
        fields.lat = String(node.lat);
        fields.lon = String(node.lon);
      } else if (old.lat === undefined) {
        fields.lat = "";
        fields.lon = "";
      }

      if (node.type !== null) fields.node_type = String(node.type);

      const oldTime = Number(old.s_time) || 0;
      if (node.heard_at && node.heard_at > oldTime) {
        fields.s_time = String(node.heard_at);
        // Самое свежее известие пришло через HA — он и есть «шлюз»
        fields.gateway_origin = source;
        fields.gateway_origin_id = "home_assistant";
      } else if (!oldTime) {
        // Время неизвестно: не выдаём устройство за «в сети»
        fields.s_time = "0";
      }

      pipeline.hset(keys[i], fields);
      // GT: только продлеваем, никогда не укорачиваем TTL,
      // выставленный mqtt-receiver; у ключа без TTL ничего не меняется
      pipeline.expire(keys[i], ttlSeconds, "GT");
      // Новый ключ (только что создан hset) получает TTL здесь
      if (Object.keys(old).length === 0) {
        pipeline.expire(keys[i], ttlSeconds, "NX");
      }
    }
    pipeline.del("dots_meshcore_cache", "dots_meshcore_cache:count");
    await pipeline.exec();

    this._inMemCache.delete("meshcoreDots");
    return nodes.length;
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
