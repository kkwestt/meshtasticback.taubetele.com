// Utility functions for the Meshtastic MQTT client

/**
 * Функция для фильтрации ошибок
 * @param {string} errorMessage - Сообщение об ошибке
 * @returns {boolean} - Нужно ли логировать ошибку
 */
export const shouldLogError = (errorMessage) => {
  const suppressedErrors = [
    "undefined",
    "illegal tag",
    "Error received for packet",
    "NO_RESPONSE",
    "TIMEOUT",
    "NO_INTERFACE",
    "MAX_RETRANSMIT",
    "NO_CHANNEL",
    "TOO_LARGE",
    "NO_ACK",
    "NOT_AUTHORIZED",
    "invalid wire type",
    "index out of range",
  ];
  return !suppressedErrors.some((error) => errorMessage.includes(error));
};

/**
 * Функция для конвертации Buffer в hex строку
 * @param {Buffer} buffer - Buffer для конвертации
 * @returns {string|null} - Hex строка или null
 */
export const bufferToHex = (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  return buffer.toString("hex").toUpperCase();
};

/**
 * Функция для форматирования MAC адреса
 * @param {Buffer} buffer - Buffer с MAC адресом
 * @returns {string|null} - Отформатированный MAC адрес или null
 */
export const formatMacAddress = (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  return buffer.toString("hex").toUpperCase().match(/.{2}/g).join(":");
};

/**
 * Функция округления с контролем десятичных знаков
 * @param {number} num - Число для округления
 * @param {number} decimalPlaces - Количество десятичных знаков
 * @returns {number} - Округленное число
 */
export const round = (num, decimalPlaces = 0) => {
  if (typeof num !== "number" || isNaN(num)) return num; // Возвращаем исходное значение вместо 0
  const factor = Math.pow(10, decimalPlaces);
  return Math.round(num * factor) / factor;
};

/**
 * Валидация protobuf пакетов
 * @param {ArrayBuffer|Uint8Array} arrayBuffer - Буфер для проверки
 * @returns {boolean} - Валидность пакета
 */
export const isValidPacket = (arrayBuffer) => {
  if (!arrayBuffer || arrayBuffer.length === 0) return false;

  // Минимальная длина для ServiceEnvelope - должно быть больше 10 байт
  if (arrayBuffer.length < 10) return false;

  try {
    // Проверяем, что это корректная структура protobuf
    const buffer = arrayBuffer.buffer
      ? new Uint8Array(arrayBuffer)
      : arrayBuffer;

    // Первый байт должен указывать на поле 1 (packet) и быть wire type 2 (length-delimited)
    const firstByte = buffer[0];
    if ((firstByte & 0x07) !== 2) return false; // Должен быть wire type 2
    if (firstByte >> 3 !== 1) return false; // Должен быть field number 1

    // Проверяем, что есть корректная длина для первого поля
    if (buffer.length < 2) return false;

    let lengthPos = 1;
    let length = 0;
    let shift = 0;

    // Декодируем varint длину
    while (lengthPos < buffer.length && shift < 32) {
      const byte = buffer[lengthPos];
      length |= (byte & 0x7f) << shift;
      lengthPos++;

      if ((byte & 0x80) === 0) {
        break; // Конец varint
      }
      shift += 7;
    }

    // Проверяем, что указанная длина не превышает размер буфера
    if (lengthPos + length > buffer.length) return false;

    // Дополнительная проверка: длина должна быть разумной (не больше 64KB)
    if (length > 65536) return false;

    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Функция проверки валидности deviceMetrics
 * @param {Object} metrics - Метрики устройства
 * @returns {boolean} - Валидность метрик
 */
export const isValidDeviceMetrics = (metrics) => {
  const {
    batteryLevel,
    voltage,
    channelUtilization,
    airUtilTx,
    uptimeSeconds,
  } = metrics;

  const hasValidBattery =
    batteryLevel !== undefined &&
    batteryLevel !== null &&
    typeof batteryLevel === "number" &&
    batteryLevel >= 0;
  const hasValidVoltage =
    voltage !== undefined &&
    voltage !== null &&
    typeof voltage === "number" &&
    !isNaN(voltage);
  const hasValidChannelUtil =
    channelUtilization !== undefined &&
    channelUtilization !== null &&
    typeof channelUtilization === "number" &&
    channelUtilization >= 0;
  const hasValidAirUtil =
    airUtilTx !== undefined &&
    airUtilTx !== null &&
    typeof airUtilTx === "number" &&
    airUtilTx >= 0;
  const hasValidUptime =
    uptimeSeconds !== undefined &&
    uptimeSeconds !== null &&
    typeof uptimeSeconds === "number" &&
    uptimeSeconds >= 0;

  return (
    hasValidBattery ||
    hasValidVoltage ||
    hasValidChannelUtil ||
    hasValidAirUtil ||
    hasValidUptime
  );
};

/**
 * Функция проверки валидности environmentMetrics
 * @param {Object} metrics - Метрики окружения
 * @returns {boolean} - Валидность метрик
 */
export const isValidEnvironmentMetrics = (metrics) => {
  const {
    temperature,
    relativeHumidity,
    barometricPressure,
    gasResistance,
    voltage,
    current,
  } = metrics;

  const hasValidTemp =
    temperature !== undefined && temperature !== null && temperature !== 0;
  const hasValidHumidity = relativeHumidity && relativeHumidity > 0;
  const hasValidPressure = barometricPressure && barometricPressure > 0;
  const hasValidGas = gasResistance && gasResistance > 0;
  const hasValidVoltage = voltage && voltage > 0;
  const hasValidCurrent = current && current > 0;

  return (
    hasValidTemp ||
    hasValidHumidity ||
    hasValidPressure ||
    hasValidGas ||
    hasValidVoltage ||
    hasValidCurrent
  );
};

/**
 * Функция для определения типа сообщения
 * @param {Object} event - Событие
 * @returns {string} - Тип сообщения
 */
export const getMessageType = (event) => {
  // Если сообщение адресовано всем (broadcast) - to = 0xffff (4294967295)
  if (
    !event.packet?.to ||
    event.packet.to === 0xffff ||
    event.packet.to === 4294967295
  ) {
    return "broadcast";
  }

  // Иначе это direct (приватное сообщение)
  return "direct";
};

/**
 * Функция проверки валидности сообщения
 * @param {Object} event - Событие
 * @returns {boolean} - Валидность сообщения
 */
export const isValidMessage = (event) => {
  // Проверяем portnum - должен быть TEXT_MESSAGE_APP (1)
  if (event.data?.portnum !== "TEXT_MESSAGE_APP" && event.data?.portnum !== 1) {
    return false;
  }

  // Проверяем, что есть текст сообщения
  if (!event.data?.payload && !event.data?.text) {
    return false;
  }

  // Пропускаем приватные сообщения (direct)
  if (event.type === "direct") {
    return false;
  }

  return true;
};

/**
 * Общий обработчик ошибок для endpoints
 * @param {Error} error - Ошибка
 * @param {Response} res - Express response
 * @param {string} context - Контекст ошибки
 */
export const handleEndpointError = (error, res, context) => {
  console.error(`${context} error:`, error.message);
  res.status(500).json({ error: "Internal server error" });
};

/**
 * Константы приложения
 */
export const CONSTANTS = {
  MAX_METADATA_ITEMS_COUNT: 200,
  CACHE_REFRESH_INTERVAL: 5000,
  DEVICE_EXPIRY_TIME: 24 * 60 * 60 * 1000, // 24 hours
  RECONNECT_DELAY: 5000,
  DECRYPTION_KEYS: ["1PG7OiApB1nwvP+rz05pAQ==", "AQ=="],
  PROTOBUFS_PATH: "./protobufs",
  MAX_PORTNUM_MESSAGES: 200, // Максимальное количество сообщений для новой схемы по portnum
};

/**
 * Маппинг portnum в названия для новой схемы хранения
 */
export const PORTNUM_MAPPING = {
  1: "TEXT_MESSAGE_APP",
  3: "POSITION_APP",
  4: "NODEINFO_APP",
  5: "ROUTING_APP",
  67: "TELEMETRY_APP",
  70: "TRACEROUTE_APP",
  71: "NEIGHBORINFO_APP",
  8: "WAYPOINT_APP",
  73: "MAP_REPORT_APP",
  // Добавляем и строковые варианты
  TEXT_MESSAGE_APP: "TEXT_MESSAGE_APP",
  POSITION_APP: "POSITION_APP",
  NODEINFO_APP: "NODEINFO_APP",
  ROUTING_APP: "ROUTING_APP",
  TELEMETRY_APP: "TELEMETRY_APP",
  TRACEROUTE_APP: "TRACEROUTE_APP",
  NEIGHBORINFO_APP: "NEIGHBORINFO_APP",
  WAYPOINT_APP: "WAYPOINT_APP",
  MAP_REPORT_APP: "MAP_REPORT_APP",
};

/**
 * Получает название portnum для новой схемы хранения
 * @param {number|string} portnum - Номер или название портa
 * @returns {string|null} - Название portnuma или null если неизвестен
 */
export const getPortnumName = (portnum) => {
  return PORTNUM_MAPPING[portnum] || null;
};

/**
 * Создает optimized Redis pipeline для batch операций
 * @param {Redis} redis - Redis client
 * @param {Array} operations - Массив операций
 * @returns {Promise<Array>} - Результаты операций
 */
export const executeRedisPipeline = async (redis, operations) => {
  const pipeline = redis.pipeline();

  operations.forEach(({ command, args }) => {
    pipeline[command](...args);
  });

  const results = await pipeline.exec();
  return results.map(([err, result]) => {
    if (err) throw err;
    return result;
  });
};

/**
 * Создает batch операции для получения данных устройств
 * @param {Array} keys - Массив ключей Redis
 * @returns {Array} - Массив операций для pipeline
 */
export const createDeviceDataBatch = (keys) => {
  return keys.map((key) => ({
    command: "hgetall",
    args: [key],
  }));
};

/**
 * Фильтрует устаревшие устройства
 * @param {Array} devices - Массив устройств
 * @param {number} expiryTime - Время истечения в миллисекундах
 * @returns {Array} - Отфильтрованный массив устройств
 */
export const filterExpiredDevices = (devices, expiryTime) => {
  const now = Date.now();
  return devices.filter((device) => {
    if (!device.timestamp) return false;
    return now - new Date(device.timestamp).getTime() < expiryTime;
  });
};
