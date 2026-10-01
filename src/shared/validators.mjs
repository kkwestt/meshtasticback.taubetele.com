/**
 * Валидация имён устройств с кэшированием и ранним выходом
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
