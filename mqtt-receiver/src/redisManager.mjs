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
   * Проверяет и помечает сообщение как обработанное для дедупликации
   * @param {string} messageKey - Уникальный ключ сообщения
   * @param {number} ttl - Время жизни в секундах (по умолчанию 3)
   * @returns {boolean} - true если сообщение новое, false если уже было обработано
   */
  async checkAndMarkMessageProcessed(messageKey, ttl = 3) {
    try {
      const dedupeKey = `dedupe:${messageKey}`;

      // Пытаемся установить ключ с NX (только если не существует)
      const result = await this.redis.set(dedupeKey, "1", "EX", ttl, "NX");

      // Если результат OK, то ключ был установлен (сообщение новое)
      // Если результат null, то ключ уже существует (дубликат)
      return result === "OK";
    } catch (error) {
      console.error(
        "[MQTT-Receiver] Error in checkAndMarkMessageProcessed:",
        error.message
      );
      // В случае ошибки возвращаем true, чтобы не потерять сообщение
      return true;
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

      // Создаем уникальный ключ для дедупликации
      // Используем from + rxTime + portnum для идентификации
      const rxTime = messageData.rxTime || Date.now();
      const dedupeKey = `portnum:${deviceId}:${portnum}:${rxTime}`;

      // Проверяем, не было ли уже обработано это сообщение
      const isNew = await this.checkAndMarkMessageProcessed(dedupeKey);
      if (!isNew) {
        console.log(
          `🔄 [MQTT-Receiver] Дубликат portnum сообщения пропущен: ${portnumName}:${deviceId}`
        );
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
      // Создаем уникальный ключ для дедупликации на основе типа обновления и данных
      let dedupeKey = `dot:${deviceId}:`;

      if (
        updateData.longitude !== undefined &&
        updateData.latitude !== undefined
      ) {
        // Для координат округляем до 6 знаков для дедупликации
        const lat = Math.round(updateData.latitude * 1000000);
        const lon = Math.round(updateData.longitude * 1000000);
        dedupeKey += `pos:${lat}:${lon}`;
      } else if (
        updateData.longName !== undefined ||
        updateData.shortName !== undefined
      ) {
        // Для имен используем сами имена
        dedupeKey += `name:${updateData.longName || ""}:${
          updateData.shortName || ""
        }`;
      } else {
        // Для обновления только времени используем текущее время с точностью до секунды
        const timeKey = Math.floor(Date.now() / 1000);
        dedupeKey += `time:${timeKey}`;
      }

      // Проверяем, не было ли уже обработано это обновление
      const isNew = await this.checkAndMarkMessageProcessed(dedupeKey);
      if (!isNew) {
        console.log(
          `🔄 [MQTT-Receiver] Дубликат dot обновления пропущен: ${deviceId}`
        );
        return;
      }

      const key = `dots:${deviceId}`;
      const currentTime = Date.now();

      // Читаем существующие данные
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
}

export default RedisManager;
