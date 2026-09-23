// Импортируем модули для HTTP API и Telegram
import v8 from "node:v8";
import { redisConfig, serverConfig, adminConfig } from "../config.mjs";
import { RedisManager } from "./shared/redisManager.mjs";
import { HTTPServer } from "./httpServer.mjs";

/**
 * HTTP API сервис (без MQTT и Telegram логики)
 */
class MeshtasticApiService {
  constructor() {
    this.redisManager = null;
    this.httpServer = null;
    this.stats = {
      startTime: Date.now(),
    };

    // Запускаем мониторинг производительности
    this.startPerformanceMonitoring();
  }

  /**
   * Запускает мониторинг производительности
   */
  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(() => {
      const uptime = Date.now() - this.stats.startTime;
      const mem = process.memoryUsage();
      const mb = (bytes) => Math.round(bytes / 1024 / 1024);
      const heapLimitMb = mb(v8.getHeapStatistics().heap_size_limit);
      const heapUsedMb = mb(mem.heapUsed);
      const heapPercent = Math.round((heapUsedMb / heapLimitMb) * 100);

      console.log(
        `📊 [HTTP-API] Работает ${Math.round(
          uptime / 1000
        )}с | heap ${heapUsedMb}/${heapLimitMb} МБ (${heapPercent}%) | rss ${mb(
          mem.rss
        )} МБ | external ${mb(mem.external)} МБ`
      );

      // Ранний сигнал о приближении к лимиту heap (до фатального OOM)
      if (heapPercent >= 85) {
        console.warn(
          `⚠️ [HTTP-API] Heap заполнен на ${heapPercent}% — приближение к лимиту V8`
        );
      }
    }, 60000); // Каждую минуту для API сервиса
  }

  /**
   * Инициализация сервиса
   */
  async init() {
    try {
      console.log("🚀 [HTTP-API] Инициализация HTTP API сервиса...");

      // Инициализируем Redis (только для чтения)
      await this.initializeRedis();

      // Инициализируем HTTP сервер
      this.initializeHttpServer();

      console.log("✅ [HTTP-API] Инициализация завершена успешно!");
    } catch (error) {
      console.error("❌ [HTTP-API] Ошибка инициализации:", error);
      process.exit(1);
    }
  }

  /**
   * Инициализирует Redis Manager (только для чтения)
   */
  async initializeRedis() {
    const retryDelay = 10000; // 10 секунд между попытками
    let attempt = 0;

    console.log("🔄 [HTTP-API] Подключение к Redis...");

    while (true) {
      attempt++;
      try {
        // Закрываем предыдущее соединение, если оно было создано
        if (this.redisManager && this.redisManager.redis) {
          try {
            await this.redisManager.disconnect();
          } catch (e) {
            // Игнорируем ошибки при закрытии
          }
        }

        this.redisManager = new RedisManager(redisConfig, "HTTP-API");
        await this.redisManager.ping();

        console.log(
          `✅ [HTTP-API] Redis подключен и настроен (попытка ${attempt})`
        );
        return; // Успешно подключились, выходим
      } catch (error) {
        const isLoadingError =
          error.message &&
          (error.message.includes("LOADING") ||
            error.message.includes("loading the dataset"));

        if (isLoadingError) {
          if (attempt === 1) {
            console.log(
              `⏳ [HTTP-API] Redis загружает данные в память, ожидание готовности...`
            );
          }
          // Логируем каждые 6 попыток (каждую минуту)
          if (attempt % 6 === 0) {
            console.log(
              `⏳ [HTTP-API] Все еще ожидание загрузки Redis... (попытка ${attempt}, прошло ~${Math.round(
                (attempt * retryDelay) / 60000
              )} минут)`
            );
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue; // Пробуем снова
        }

        // Если это не ошибка загрузки, логируем и пробуем снова
        console.error(
          `❌ [HTTP-API] Ошибка подключения к Redis (попытка ${attempt}):`,
          error.message
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue; // Пробуем снова
      }
    }
  }

  /**
   * Инициализирует HTTP сервер
   */
  initializeHttpServer() {
    this.httpServer = new HTTPServer(this.redisManager, serverConfig);
    this.httpServer.start();
  }

  /**
   * Корректное отключение
   */
  async disconnect() {
    console.log("👋 [HTTP-API] Отключение от всех сервисов...");

    try {
      // Очищаем интервалы
      if (this.performanceInterval) {
        clearInterval(this.performanceInterval);
        console.log(
          "✅ [HTTP-API] Интервал мониторинга производительности остановлен"
        );
      }

      // Останавливаем HTTP сервер
      if (this.httpServer) {
        await this.httpServer.stop();
      }

      // Отключаем Redis
      if (this.redisManager) {
        await this.redisManager.disconnect();
      }
    } catch (error) {
      console.error("[HTTP-API] Ошибка при отключении:", error);
    }
  }
}

/**
 * Главная функция запуска приложения
 */
async function main() {
  console.log("🚀 [HTTP-API] Запуск HTTP API сервиса...");

  console.log(
    "🌐 [HTTP-API] HTTP API сервер будет предоставлять доступ к данным из Redis"
  );
  console.log(
    "📡 [HTTP-API] MQTT данные поступают от отдельного mqtt-receiver сервиса"
  );

  const service = new MeshtasticApiService();

  // Обработка сигналов для корректного завершения
  const gracefulShutdown = async (signal) => {
    console.log(
      `\n👋 [HTTP-API] Получен сигнал ${signal}, завершение работы...`
    );
    await service.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  // Обработка необработанных исключений
  process.on("uncaughtException", (error) => {
    console.error("🚨 [HTTP-API] НЕОБРАБОТАННОЕ ИСКЛЮЧЕНИЕ:", error);
    console.error("📊 Stack trace:", error.stack);
    console.error("⏰ Время:", new Date().toISOString());
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("🚨 [HTTP-API] НЕОБРАБОТАННОЕ ОТКЛОНЕНИЕ PROMISE:", reason);
    console.error("📊 Promise:", promise);
    console.error("⏰ Время:", new Date().toISOString());
  });

  // Запускаем сервис
  await service.init();

  // Отправляем сообщение о запуске сервера администратору
  try {
    const startupMessage =
      `🚀 [HTTP-API] ` +
      `${new Date().toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
      })}\n`;
  } catch (error) {
    console.error(
      "❌ [HTTP-API] Ошибка отправки сообщения о запуске:",
      error.message
    );
  }
}

// Запускаем только если файл запущен напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("❌ [HTTP-API] Критическая ошибка в main():");
    console.error("  📍 Местоположение: main()");
    console.error("  🔍 Тип ошибки:", error.constructor.name);
    console.error("  💬 Сообщение:", error.message);
    console.error("  📊 Stack trace:", error.stack);
    console.error("  ⏰ Время:", new Date().toISOString());
    process.exit(1);
  });
}

export default MeshtasticApiService;
