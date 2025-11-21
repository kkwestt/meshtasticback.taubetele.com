/**
 * Оптимизированные валидаторы с кэшированием и ранним выходом
 */

// Кэш для валидации имен (LRU кэш)
const nameValidationCache = new Map();
const MAX_CACHE_SIZE = 1000;

/**
 * Простая LRU кэш реализация
 */
function addToCache(key, value) {
  if (nameValidationCache.size >= MAX_CACHE_SIZE) {
    // Удаляем самый старый элемент
    const firstKey = nameValidationCache.keys().next().value;
    nameValidationCache.delete(firstKey);
  }
  nameValidationCache.set(key, value);
}

/**
 * Оптимизированная валидация имени пользователя с кэшированием
 * Использует ранний выход для быстрой проверки
 */
export const isValidUserName = (name) => {
  // Ранний выход: проверка типа и наличия
  if (!name || typeof name !== "string") {
    return false;
  }

  // Проверяем кэш
  if (nameValidationCache.has(name)) {
    return nameValidationCache.get(name);
  }

  const trimmedName = name.trim();

  // Ранний выход: пустая строка
  if (trimmedName.length === 0) {
    addToCache(name, false);
    return false;
  }

  // Ранний выход: слишком длинное имя
  if (trimmedName.length > 50) {
    addToCache(name, false);
    return false;
  }

  // Проверка на наличие валидных символов (быстрая проверка)
  const hasValidChars = /[a-zA-Zа-яА-ЯёЁ0-9\p{Emoji}]/u.test(trimmedName);
  if (!hasValidChars) {
    addToCache(name, false);
    return false;
  }

  // Проверка на подозрительные паттерны (быстрая проверка перед regex)
  const suspiciousPatterns = [
    /[{}|`~]{2,}/,
    /[!@#$%^&*()+=]{3,}/,
    /[<>]{2,}/,
    /[\\/]{3,}/,
    /[\[\]]{2,}/,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmedName)) {
      addToCache(name, false);
      return false;
    }
  }

  // Полная проверка regex (самая медленная операция)
  const validNameRegex =
    /^[a-zA-Zа-яА-ЯёЁ\u00C0-\u017F0-9\s\-_\.()\[\]@|/,:\p{Emoji}\uFE0F]+$/u;

  const isValid = validNameRegex.test(trimmedName);
  addToCache(name, isValid);
  return isValid;
};

/**
 * Оптимизированная валидация пакета с ранним выходом
 */
export const isValidPacket = (arrayBuffer) => {
  // Ранний выход: нет данных
  if (!arrayBuffer || arrayBuffer.length === 0) {
    return false;
  }

  // Ранний выход: слишком маленький пакет
  if (arrayBuffer.length < 10) {
    return false;
  }

  // Ранний выход: слишком большой пакет
  if (arrayBuffer.length > 65536) {
    return false;
  }

  try {
    const buffer = arrayBuffer.buffer
      ? new Uint8Array(arrayBuffer)
      : arrayBuffer;

    // Быстрая проверка первого байта
    const firstByte = buffer[0];
    if ((firstByte & 0x07) !== 2) return false; // wire type 2
    if (firstByte >> 3 !== 1) return false; // field number 1

    // Проверка длины
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
        break;
      }
      shift += 7;
    }

    // Проверка корректности длины
    if (lengthPos + length > buffer.length) return false;
    if (length > 65536) return false;

    return true;
  } catch {
    return false;
  }
};

/**
 * Оптимизированная валидация deviceMetrics
 */
export const isValidDeviceMetrics = (metrics) => {
  if (!metrics || typeof metrics !== "object") {
    return false;
  }

  // Ранний выход: проверяем только нужные поля
  const {
    batteryLevel,
    voltage,
    channelUtilization,
    airUtilTx,
    uptimeSeconds,
  } = metrics;

  // Быстрая проверка: хотя бы одно поле должно быть валидным
  return (
    (batteryLevel !== undefined &&
      typeof batteryLevel === "number" &&
      batteryLevel >= 0) ||
    (voltage !== undefined && typeof voltage === "number" && !isNaN(voltage)) ||
    (channelUtilization !== undefined &&
      typeof channelUtilization === "number" &&
      channelUtilization >= 0) ||
    (airUtilTx !== undefined &&
      typeof airUtilTx === "number" &&
      airUtilTx >= 0) ||
    (uptimeSeconds !== undefined &&
      typeof uptimeSeconds === "number" &&
      uptimeSeconds >= 0)
  );
};

/**
 * Оптимизированная валидация environmentMetrics
 */
export const isValidEnvironmentMetrics = (metrics) => {
  if (!metrics || typeof metrics !== "object") {
    return false;
  }

  const {
    temperature,
    relativeHumidity,
    barometricPressure,
    gasResistance,
    voltage,
    current,
  } = metrics;

  // Быстрая проверка: хотя бы одно поле должно быть валидным
  return (
    (temperature !== undefined && temperature !== null && temperature !== 0) ||
    (relativeHumidity && relativeHumidity > 0) ||
    (barometricPressure && barometricPressure > 0) ||
    (gasResistance && gasResistance > 0) ||
    (voltage && voltage > 0) ||
    (current && current > 0)
  );
};

/**
 * Оптимизированная валидация сообщения
 */
export const isValidMessage = (event) => {
  // Ранний выход: проверка portnum
  if (event.data?.portnum !== "TEXT_MESSAGE_APP" && event.data?.portnum !== 1) {
    return false;
  }

  // Ранний выход: нет текста
  if (!event.data?.payload && !event.data?.text) {
    return false;
  }

  // Ранний выход: приватное сообщение
  if (event.type === "direct") {
    return false;
  }

  return true;
};

/**
 * Очищает кэш валидации
 */
export const clearValidationCache = () => {
  nameValidationCache.clear();
};

export default {
  isValidUserName,
  isValidPacket,
  isValidDeviceMetrics,
  isValidEnvironmentMetrics,
  isValidMessage,
  clearValidationCache,
};
