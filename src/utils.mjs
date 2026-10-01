// Утилиты HTTP API сервиса

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
  // Максимальное количество сообщений, отдаваемых по одному portnum
  MAX_PORTNUM_MESSAGES: 200,
};
