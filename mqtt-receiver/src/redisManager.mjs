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
   * Проверяет дубликаты сообщений за последние N секунд
   * @param {string} key - Ключ Redis
   * @param {Object} newData - Новые данные для проверки
   * @param {number} timeWindowSeconds - Окно времени в секундах (по умолчанию 3)
   * @returns {boolean} - true если дубликат найден
   */
  async isDuplicateMessage(key, newData, timeWindowSeconds = 3) {
    try {
      const currentTime = Date.now();
      const timeWindow = timeWindowSeconds * 1000;

      // Получаем последние несколько сообщений для проверки
      const recentMessages = await this.redis.lrange(key, -10, -1);
      
      // Поля, которые нужно исключить из сравнения (они меняются на каждом шлюзе)
      const excludeFields = ['timestamp', 'server', 'gatewayId', 'rxSnr', 'rxRssi', 'hopLimit', 'rxTime'];

      for (const msgStr of recentMessages) {
        try {
          const existingMsg = JSON.parse(msgStr);
          
          // Проверяем временное окно (только последние 3 секунды)
          if (currentTime - existingMsg.timestamp > timeWindow) {
            continue;
          }

          // Сравниваем данные, исключая специфичные для шлюза поля
          const newDataFiltered = this._filterObjectFields(newData, excludeFields);
          const existingDataFiltered = this._filterObjectFields(existingMsg, excludeFields);

          if (this._deepEqual(newDataFiltered, existingDataFiltered)) {
            return true; // Дубликат найден
          }
        } catch (parseError) {
          continue; // Пропускаем некорректные записи
        }
      }

      return false; // Дубликатов не найдено
    } catch (error) {
      console.error(
        "[MQTT-Receiver] Error checking duplicate message:",
        error.message
      );
      return false; // В случае ошибки разрешаем запись
    }
  }

  /**
   * Фильтрует поля объекта
   * @param {Object} obj - Исходный объект
   * @param {Array} fieldsToExclude - Массив полей для исключения
   * @returns {Object} - Отфильтрованный объект
   */
  _filterObjectFields(obj, fieldsToExclude) {
    const filtered = {};
    for (const [key, value] of Object.entries(obj)) {
      if (!fieldsToExclude.includes(key)) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  /**
   * Глубокое сравнение объектов
   * @param {*} obj1 - Первый объект
   * @param {*} obj2 - Второй объект
   * @returns {boolean} - true если объекты идентичны
   */
  _deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
      return false;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!this._deepEqual(obj1[key], obj2[key])) return false;
    }

    return true;
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
      const isDuplicate = await this.isDuplicateMessage(key, messageWithTimestamp, 3);
      if (isDuplicate) {
        // console.log(`🔄 [MQTT-Receiver] Дубликат сообщения ${portnumName}:${deviceId}, пропускаем`);
        return;
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
   * Проверяет дубликаты обновлений точек за последние N секунд
   * @param {Object} existingData - Существующие данные из Redis
   * @param {Object} newData - Новые данные для сравнения
   * @param {number} timeWindowSeconds - Окно времени в секундах (по умолчанию 3)
   * @returns {boolean} - true если дубликат найден
   */
  _isDuplicateDotUpdate(existingData, newData, timeWindowSeconds = 3) {
    try {
      // Если нет существующих данных, то это не дубликат
      if (!existingData || Object.keys(existingData).length === 0) {
        return false;
      }

      // Проверяем временное окно
      const existingTime = parseInt(existingData.s_time) || 0;
      const currentTime = Date.now();
      const timeWindow = timeWindowSeconds * 1000;

      if (currentTime - existingTime > timeWindow) {
        return false; // Данные слишком старые, не дубликат
      }

      // Поля для сравнения (исключаем s_time и mqtt, так как они могут меняться)
      const compareFields = ['longitude', 'latitude', 'longName', 'shortName'];
      
      // Сравниваем только значимые поля
      for (const field of compareFields) {
        const existingValue = existingData[field];
        const newValue = newData[field];
        
        // Если хотя бы одно поле отличается, это не дубликат
        if (existingValue !== undefined && newValue !== undefined) {
          // Для чисел сравниваем как числа
          if (field === 'longitude' || field === 'latitude') {
            const existingNum = parseFloat(existingValue) || 0;
            const newNum = parseFloat(newValue) || 0;
            if (existingNum !== newNum) {
              return false;
            }
          } else {
            // Для строк сравниваем как строки
            if (String(existingValue) !== String(newValue)) {
              return false;
            }
          }
        }
      }

      // Все значимые поля совпадают - это дубликат
      return true;
    } catch (error) {
      console.error(
        "[MQTT-Receiver] Error checking duplicate dot update:",
        error.message
      );
      return false; // В случае ошибки разрешаем запись
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

      // Проверяем на дубликат обновления за последние 3 секунды
      // Проверяем только если есть значимые данные для обновления (не просто s_time)
      const hasSignificantUpdate = 
        fieldsToUpdate.longitude !== undefined ||
        fieldsToUpdate.latitude !== undefined ||
        fieldsToUpdate.longName !== undefined ||
        fieldsToUpdate.shortName !== undefined;

      if (hasSignificantUpdate && this._isDuplicateDotUpdate(existingData, dotData, 3)) {
        // console.log(`🔄 [MQTT-Receiver] Дубликат обновления dots:${deviceId}, пропускаем`);
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
