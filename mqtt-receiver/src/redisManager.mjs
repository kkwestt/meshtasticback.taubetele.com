import Redis from "ioredis";
import {
  executeRedisPipeline,
  isValidUserName,
  CONSTANTS,
  getPortnumName,
} from "./utils.mjs";

const { MAX_METADATA_ITEMS_COUNT, DEVICE_EXPIRY_TIME, MAX_PORTNUM_MESSAGES } =
  CONSTANTS;

/**
 * Упрощенный Redis Manager для MQTT Receiver (только запись)
 */
export class RedisManager {
  constructor(config) {
    this.redis = new Redis(config);

    this.setupEventHandlers();
  }

  /**
   * Настраивает обработчики событий Redis
   */
  setupEventHandlers() {
    this.redis.on("error", (err) => {
      console.error("[MQTT-Receiver] Redis Client Error:", err);
    });

    this.redis.on("connect", () => {
      console.log("✅ [MQTT-Receiver] Connected to Redis");
    });

    this.redis.on("reconnecting", () => {
      console.log("🔄 [MQTT-Receiver] Reconnecting to Redis...");
    });
  }

  /**
   * Проверяет подключение к Redis
   */
  async ping() {
    return await this.redis.ping();
  }

  /**
   * Проверяет, является ли сообщение дубликатом (за последние 5 секунд)
   * @param {string} key - Ключ Redis
   * @param {Object} newMessage - Новое сообщение для проверки
   * @param {number} timeWindow - Временное окно в миллисекундах (по умолчанию 5 секунды)
   * @returns {boolean} - true если дубликат, false если уникальное
   */
  async isDuplicateMessage(key, newMessage, timeWindow = 5000) {
    try {
      const currentTime = newMessage.timestamp || Date.now();

      // Получаем только последнее сообщение для проверки
      const recentMessages = await this.redis.lrange(key, -1, -1);

      if (recentMessages.length === 0) {
        return false; // Нет предыдущих сообщений
      }

      try {
        const existingMsg = JSON.parse(recentMessages[0]);

        // Проверяем временное окно
        const timeDiff = currentTime - existingMsg.timestamp;
        if (timeDiff < 0 || timeDiff > timeWindow) {
          return false; // Слишком старое или время некорректное
        }

        // Сравниваем ключевые поля сообщения (исключая timestamp и gatewayId)
        const newMsgCopy = { ...newMessage };
        const existingMsgCopy = { ...existingMsg };

        // Удаляем поля, которые различаются у одного сообщения от разных шлюзов
        delete newMsgCopy.timestamp;
        delete existingMsgCopy.timestamp;
        delete newMsgCopy.gatewayId;
        delete existingMsgCopy.gatewayId;

        // Сравниваем остальные поля
        if (JSON.stringify(newMsgCopy) === JSON.stringify(existingMsgCopy)) {
          return true; // Найден дубликат
        }
      } catch (parseError) {
        // Игнорируем ошибки парсинга
        return false;
      }

      return false; // Дубликат не найден
    } catch (error) {
      console.error(
        "[MQTT-Receiver] Error checking duplicate message:",
        error.message
      );
      return false; // В случае ошибки считаем сообщение уникальным
    }
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
        console.log(`⚠️ [MQTT-Receiver] Неизвестный portnum: ${portnum}`);
        return;
      }

      const key = `${portnumName}:${deviceId}`;
      const messageWithTimestamp = {
        timestamp: Date.now(),
        ...messageData,
      };

      // Проверяем на дубликаты за последние 3 секунды
      const isDuplicate = await this.isDuplicateMessage(
        key,
        messageWithTimestamp
      );
      if (isDuplicate) {
        console.log(
          `⚠️ [MQTT-Receiver] Duplicate message filtered for ${portnumName}:${deviceId}`
        );
        return; // Пропускаем дубликат
      }

      // Добавляем сообщение в список
      await this.redis.rpush(key, JSON.stringify(messageWithTimestamp));

      // Обрезаем до последних MAX_PORTNUM_MESSAGES сообщений
      await this.redis.ltrim(key, -MAX_PORTNUM_MESSAGES, -1);
    } catch (error) {
      console.error(
        "[MQTT-Receiver] Error saving portnum message:",
        error.message
      );
    }
  }

  /**
   * Обновляет данные точки для карты
   * @param {string} deviceId - ID устройства (numeric)
   * @param {Object} updateData - Данные для обновления
   * @param {Object} options - Дополнительные опции
   */
  async updateDotData(deviceId, updateData, options = {}) {
    const { portnum = "UNKNOWN" } = options;
    try {
      const key = `dots:${deviceId}`;
      const currentTime = Date.now();

      // Читаем существующие данные
      const existingData = await this.redis.hgetall(key);

      // Проверяем дубликаты - если данные не изменились за последние 3 секунды, не записываем
      if (Object.keys(existingData).length > 0 && existingData.s_time) {
        const lastUpdateTime = parseInt(existingData.s_time);
        const timeDiff = currentTime - lastUpdateTime;

        // Если последнее обновление было меньше 3 секунд назад
        if (timeDiff >= 0 && timeDiff < 3000) {
          let hasChanges = false;

          // Проверяем координаты
          if (
            updateData.longitude !== undefined &&
            updateData.latitude !== undefined
          ) {
            const existingLon = parseFloat(existingData.longitude) || 0;
            const existingLat = parseFloat(existingData.latitude) || 0;

            // Если координаты изменились - есть изменения
            if (
              existingLon !== updateData.longitude ||
              existingLat !== updateData.latitude
            ) {
              hasChanges = true;
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

            // Если имена изменились - есть изменения
            if (
              newLongName !== (existingData.longName || "") ||
              newShortName !== (existingData.shortName || "")
            ) {
              hasChanges = true;
            }
          }

          // Если нет изменений за последние 3 секунды - пропускаем запись
          if (
            !hasChanges &&
            (updateData.longitude !== undefined ||
              updateData.longName !== undefined ||
              updateData.shortName !== undefined)
          ) {
            console.log(
              `⚠️ [MQTT-Receiver] No changes in dot data for device ${deviceId} within 3 seconds, skipping`
            );
            return;
          }
        }
      }

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

      // Если есть данные о node info - обновляем имена с валидацией
      if (
        updateData.longName !== undefined ||
        updateData.shortName !== undefined
      ) {
        if (updateData.longName !== undefined) {
          const validLongName =
            updateData.longName && isValidUserName(updateData.longName)
              ? updateData.longName
              : "";
          fieldsToUpdate.longName = validLongName;
        }
        if (updateData.shortName !== undefined) {
          const validShortName =
            updateData.shortName && isValidUserName(updateData.shortName)
              ? updateData.shortName
              : "";
          fieldsToUpdate.shortName = validShortName;
        }
      }

      // Проверяем условие MQTT
      if (options && options.gatewayId && options.rawDataId) {
        const isMqttDevice = options.gatewayId === options.rawDataId;
        fieldsToUpdate.mqtt = isMqttDevice ? "1" : "0";
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
        const existingKeys = Object.keys(existingData);
        if (existingKeys.length > 0) {
          await this.redis.del(key);

          // Удаляем из индексов
          await this.removeFromDeviceIndex(deviceId);
          // Удаляем из индекса portnum только если он известен
          if (portnum && portnum !== "UNKNOWN") {
            await this.removeFromPortnumIndex(deviceId, portnum);
          }
        }
        return;
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

      // Обновляем индексы
      await this.updateDeviceIndex(deviceId);
      // Добавляем в индекс portnum только если он известен
      if (portnum && portnum !== "UNKNOWN") {
        await this.updatePortnumIndex(deviceId, portnum);
      }
    } catch (error) {
      console.error(
        `[MQTT-Receiver] Error updating dot data for ${deviceId}:`,
        error.message
      );
    }
  }

  /**
   * Фильтрует и стандартизирует данные для dots
   * @param {Object} data - Входные данные
   * @param {number} timestamp - Временная метка
   * @returns {Object|null} - Отфильтрованные данные или null
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

    const hasName =
      (filteredData.longName &&
        typeof filteredData.longName === "string" &&
        filteredData.longName.trim() !== "" &&
        isValidUserName(filteredData.longName)) ||
      (filteredData.shortName &&
        typeof filteredData.shortName === "string" &&
        filteredData.shortName.trim() !== "" &&
        isValidUserName(filteredData.shortName));

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
   * Обновляет индекс активных устройств
   * @param {string} deviceId - ID устройства
   */
  async updateDeviceIndex(deviceId) {
    try {
      await this.redis.sadd("devices:active", deviceId);
    } catch (error) {
      console.error(
        `[MQTT-Receiver] Error updating device index for ${deviceId}:`,
        error.message
      );
    }
  }

  /**
   * Удаляет устройство из индекса активных устройств
   * @param {string} deviceId - ID устройства
   */
  async removeFromDeviceIndex(deviceId) {
    try {
      await this.redis.srem("devices:active", deviceId);
    } catch (error) {
      console.error(
        `[MQTT-Receiver] Error removing device from index ${deviceId}:`,
        error.message
      );
    }
  }

  /**
   * Обновляет индекс устройств по типу сообщений
   * @param {string} deviceId - ID устройства
   * @param {string} portnum - Тип сообщения
   */
  async updatePortnumIndex(deviceId, portnum) {
    try {
      await this.redis.sadd(`w:${portnum}`, deviceId);
    } catch (error) {
      console.error(
        `[MQTT-Receiver] Error updating portnum index for ${deviceId}:${portnum}:`,
        error.message
      );
    }
  }

  /**
   * Удаляет устройство из индекса типов сообщений
   * @param {string} deviceId - ID устройства
   * @param {string} portnum - Тип сообщения
   */
  async removeFromPortnumIndex(deviceId, portnum) {
    try {
      await this.redis.srem(`portnums:${portnum}`, deviceId);
    } catch (error) {
      console.error(
        `[MQTT-Receiver] Error removing device from portnum index ${deviceId}:${portnum}:`,
        error.message
      );
    }
  }

  /**
   * Отключается от Redis
   */
  async disconnect() {
    try {
      await this.redis.quit();
      console.log("✅ [MQTT-Receiver] Redis отключен");
    } catch (error) {
      console.error(
        "[MQTT-Receiver] Error disconnecting from Redis:",
        error.message
      );
    }
  }

  /**
   * Получает сообщения по portnum (для Telegram бота)
   * @param {string} portnumName - Название порта
   * @param {number} deviceId - ID устройства
   * @param {number} limit - Лимит сообщений
   * @returns {Array} - Массив сообщений
   */
  async getPortnumMessages(portnumName, deviceId, limit = 10) {
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
        `[MQTT-Receiver] Error getting portnum messages for ${portnumName}:${deviceId}:`,
        error.message
      );
      return [];
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
        `🔧 [MQTT-Receiver] Redis: Сохранение в ключ ${key}`
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
        `🔧 [MQTT-Receiver] Redis: Данные для сохранения:`,
        JSON.stringify(dotData)
      );

      // Сохраняем как hash в Redis
      const result = await this.redis.hset(key, dotData);
      console.log(`🔧 [MQTT-Receiver] Redis: hset результат: ${result}`);

      // Устанавливаем TTL (время жизни ключа) - 3 часа
      const expireResult = await this.redis.expire(key, DEVICE_EXPIRY_TIME);
      console.log(`🔧 [MQTT-Receiver] Redis: expire результат: ${expireResult}`);

      // Инвалидируем кэш эндпоинта dots_meshcore для быстрого обновления данных
      try {
        await this.redis.del("dots_meshcore_cache", "dots_meshcore_cache:count");
      } catch (cacheError) {
        // Игнорируем ошибки инвалидации кэша
        console.log(`⚠️ [MQTT-Receiver] Не удалось инвалидировать кэш: ${cacheError.message}`);
      }

      // Проверяем, что данные сохранились
      const savedData = await this.redis.hgetall(key);
      console.log(
        `✅ [MQTT-Receiver] Redis: Проверка сохраненных данных для ${key}:`,
        JSON.stringify(savedData)
      );

      // Дополнительная проверка - получаем отдельные поля
      const checkDeviceId = await this.redis.hget(key, "device_id");
      const checkLat = await this.redis.hget(key, "lat");
      const checkLon = await this.redis.hget(key, "lon");
      const checkName = await this.redis.hget(key, "name");
      console.log(
        `🔍 [MQTT-Receiver] Redis: Проверка полей - device_id: ${checkDeviceId}, lat: ${checkLat}, lon: ${checkLon}, name: ${checkName}`
      );
    } catch (error) {
      console.error(
        `❌ [MQTT-Receiver] Error saving meshcore dot for ${deviceId}:`,
        error.message,
        error.stack
      );
    }
  }
}

export default RedisManager;
