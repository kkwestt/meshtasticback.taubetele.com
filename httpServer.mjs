import express from "express";
import compression from "compression";
import cors from "cors";
import { handleEndpointError } from "./utils.mjs";

/**
 * Оптимизированный HTTP сервер с улучшенными endpoints
 */
export class HTTPServer {
  constructor(redisManager, serverConfig) {
    this.redisManager = redisManager;
    this.app = express();
    this.serverConfig = serverConfig;

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Настраивает middleware
   */
  setupMiddleware() {
    this.app.use(compression());
    this.app.use(
      cors({
        origin: (origin, callback) => callback(null, origin || "*"),
        allowedHeaders: ["Content-Type"],
      })
    );

    // Добавляем middleware для логирования
    // this.app.use((req, res, next) => {
    //   const start = Date.now();

    //   res.on("finish", () => {
    //     const duration = Date.now() - start;
    //     console.log(
    //       `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
    //     );
    //   });

    //   next();
    // });
  }

  /**
   * Настраивает маршруты
   */
  setupRoutes() {
    // Основные endpoints (должны быть ПЕРЕД общим обработчиком)
    this.app.get("/api", this.handleApiEndpoint.bind(this));
    this.app.get("/health", this.handleHealthCheck.bind(this));
    this.app.get("/stats", this.handleStatsEndpoint.bind(this));

    // Endpoints для получения данных по portnum
    this.app.get(
      "/portnum/:portnumName",
      this.handlePortnumAllEndpoint.bind(this)
    );
    this.app.get(
      "/portnum/:portnumName/:deviceId",
      this.handlePortnumDeviceEndpoint.bind(this)
    );
    this.app.get("/portnum-stats", this.handlePortnumStatsEndpoint.bind(this));

    // Endpoint для формата portnumName:deviceId
    this.app.get(
      "/:portnumNameAndDeviceId",
      this.handlePortnumColonFormatEndpoint.bind(this)
    );

    // Главный endpoint
    this.app.get("/", this.handleRootEndpoint.bind(this));

    // СТАРАЯ СХЕМА: Создаем общий обработчик для метаданных (должен быть ПОСЛЕ специфичных)
    this.app.get("/:type:from", this.createMetadataHandler());

    // Обработка 404
    this.app.use(this.handle404.bind(this));
  }

  /**
   * Создает обработчик для метаданных
   * @returns {Function} - Обработчик метаданных
   */
  createMetadataHandler() {
    return async (req, res) => {
      try {
        const { type, from } = req.params;
        const deviceId = from.substring(1);

        // Валидация типа метаданных
        const validTypes = [
          "gps",
          "deviceMetrics",
          "environmentMetrics",
          "message",
          "neighborInfo",
          "mapReport",
        ];
        if (!validTypes.includes(type)) {
          return res.status(400).json({ error: "Invalid metadata type" });
        }

        // Валидация device ID
        if (!deviceId || deviceId.length === 0) {
          return res.status(400).json({ error: "Invalid device ID" });
        }

        const data = await this.redisManager.getDeviceMetadata(deviceId, type);

        res.json({
          from: deviceId,
          type,
          count: data.length,
          data,
        });
      } catch (error) {
        handleEndpointError(error, res, `${req.params.type} metadata endpoint`);
      }
    };
  }

  /**
   * Обрабатывает /api endpoint
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleApiEndpoint(req, res) {
    try {
      const includeExpired = req.query.includeExpired === "true";
      const data = await this.redisManager.getAllDeviceData(includeExpired);

      res.json(data);
    } catch (error) {
      handleEndpointError(error, res, "API endpoint");
    }
  }

  /**
   * Обрабатывает главный endpoint
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleRootEndpoint(req, res) {
    try {
      // Главный endpoint возвращает все данные (включая истекшие)
      const data = await this.redisManager.getAllDeviceData(true);

      res.json(data);
    } catch (error) {
      handleEndpointError(error, res, "Root endpoint");
    }
  }

  /**
   * Обрабатывает health check endpoint
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleHealthCheck(req, res) {
    try {
      const redisStatus = await this.redisManager.ping();

      res.json({
        status: "healthy",
        timestamp: Date.now(),
        services: {
          redis: redisStatus === "PONG" ? "ok" : "error",
        },
      });
    } catch (error) {
      res.status(500).json({
        status: "unhealthy",
        timestamp: Date.now(),
        error: error.message,
      });
    }
  }

  /**
   * Обрабатывает stats endpoint
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleStatsEndpoint(req, res) {
    try {
      const cacheStats = this.redisManager.getCacheStats();

      res.json({
        timestamp: Date.now(),
        cache: cacheStats,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
      });
    } catch (error) {
      handleEndpointError(error, res, "Stats endpoint");
    }
  }

  /**
   * Обрабатывает получение всех сообщений по portnum
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handlePortnumAllEndpoint(req, res) {
    try {
      const { portnumName } = req.params;

      // Валидация portnum
      const validPortnums = [
        "TEXT_MESSAGE_APP",
        "POSITION_APP",
        "NODEINFO_APP",
        "TELEMETRY_APP",
        "NEIGHBORINFO_APP",
        "WAYPOINT_APP",
        "MAP_REPORT_APP",
        "TRACEROUTE_APP",
      ];
      if (!validPortnums.includes(portnumName)) {
        return res.status(400).json({
          error: "Invalid portnum name",
          validPortnums: validPortnums,
        });
      }

      const data = await this.redisManager.getAllPortnumMessages(portnumName);

      res.json({
        portnum: portnumName,
        deviceCount: Object.keys(data).length,
        timestamp: Date.now(),
        data: data,
      });
    } catch (error) {
      handleEndpointError(
        error,
        res,
        `Portnum all endpoint (${req.params.portnumName})`
      );
    }
  }

  /**
   * Обрабатывает получение сообщений по portnum для конкретного устройства
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handlePortnumDeviceEndpoint(req, res) {
    try {
      const { portnumName, deviceId } = req.params;
      const limit = parseInt(req.query.limit) || 200;

      // Валидация portnum
      const validPortnums = [
        "TEXT_MESSAGE_APP",
        "POSITION_APP",
        "NODEINFO_APP",
        "TELEMETRY_APP",
        "NEIGHBORINFO_APP",
        "WAYPOINT_APP",
        "MAP_REPORT_APP",
        "TRACEROUTE_APP",
      ];
      if (!validPortnums.includes(portnumName)) {
        return res.status(400).json({
          error: "Invalid portnum name",
          validPortnums: validPortnums,
        });
      }

      // Валидация device ID
      if (!deviceId || deviceId.length === 0) {
        return res.status(400).json({ error: "Invalid device ID" });
      }

      // Валидация лимита
      if (limit < 1 || limit > 1000) {
        return res.status(400).json({
          error: "Invalid limit",
          message: "Limit must be between 1 and 1000",
        });
      }

      const data = await this.redisManager.getPortnumMessages(
        portnumName,
        deviceId,
        limit
      );

      res.json({
        portnum: portnumName,
        deviceId: deviceId,
        count: data.length,
        limit: limit,
        timestamp: Date.now(),
        data: data,
      });
    } catch (error) {
      handleEndpointError(
        error,
        res,
        `Portnum device endpoint (${req.params.portnumName}:${req.params.deviceId})`
      );
    }
  }

  /**
   * Обрабатывает получение статистики по portnum
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handlePortnumStatsEndpoint(req, res) {
    try {
      const stats = await this.redisManager.getPortnumStats();

      // Добавляем общую статистику
      const totalDevices = Object.values(stats).reduce(
        (sum, stat) => sum + stat.deviceCount,
        0
      );
      const totalMessages = Object.values(stats).reduce(
        (sum, stat) => sum + stat.totalMessages,
        0
      );

      res.json({
        timestamp: Date.now(),
        summary: {
          totalDevices,
          totalMessages,
          portnumTypes: Object.keys(stats).length,
        },
        byPortnum: stats,
      });
    } catch (error) {
      handleEndpointError(error, res, "Portnum stats endpoint");
    }
  }

  /**
   * Обрабатывает получение данных по формату portnumName:deviceId
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handlePortnumColonFormatEndpoint(req, res) {
    try {
      const { portnumNameAndDeviceId } = req.params;
      const [portnumName, deviceId] = portnumNameAndDeviceId.split(":");

      // Валидация portnum
      const validPortnums = [
        "TEXT_MESSAGE_APP",
        "POSITION_APP",
        "NODEINFO_APP",
        "TELEMETRY_APP",
        "NEIGHBORINFO_APP",
        "WAYPOINT_APP",
        "MAP_REPORT_APP",
        "TRACEROUTE_APP",
      ];
      if (!validPortnums.includes(portnumName)) {
        return res.status(400).json({
          error: "Invalid portnum name",
          validPortnums: validPortnums,
        });
      }

      // Валидация device ID
      if (!deviceId || deviceId.length === 0) {
        return res.status(400).json({ error: "Invalid device ID" });
      }

      const data = await this.redisManager.getPortnumMessages(
        portnumName,
        deviceId
      );

      res.json({
        portnum: portnumName,
        deviceId: deviceId,
        count: data.length,
        timestamp: Date.now(),
        data: data,
      });
    } catch (error) {
      handleEndpointError(
        error,
        res,
        `Portnum colon format endpoint (${req.params.portnumNameAndDeviceId})`
      );
    }
  }

  /**
   * Обрабатывает 404 ошибки
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  handle404(req, res) {
    res.status(404).json({
      error: "Not Found",
      message: `Endpoint ${req.method} ${req.path} not found`,
      timestamp: Date.now(),
    });
  }

  /**
   * Запускает сервер
   */
  start() {
    const PORT = this.serverConfig.port || 80;

    this.server = this.app.listen(PORT, () => {
      console.log(`🌐 HTTP Server running on port ${PORT}`);
      console.log(`📡 Available endpoints:`);
      console.log(`  СТАРАЯ СХЕМА:`);
      console.log(`    GET /                    - All device data`);
      console.log(`    GET /api                 - Active device data`);

      console.log(`    GET /gps:deviceId        - GPS data for device`);
      console.log(`    GET /deviceMetrics:deviceId - Device metrics`);
      console.log(`    GET /environmentMetrics:deviceId - Environment metrics`);
      console.log(`    GET /message:deviceId    - Messages from device`);
      console.log(`  По portnum:`);
      console.log(`    GET /portnum/:portnumName - All messages by portnum`);
      console.log(
        `    GET /portnum/:portnumName/:deviceId - Device messages by portnum`
      );
      console.log(`    GET /portnum-stats       - Statistics by portnum`);
      console.log(
        `    GET /:portnumNameAndDeviceId - Messages by portnum:deviceId`
      );
      console.log(`  СЛУЖЕБНЫЕ:`);
      console.log(`    GET /health              - Health check`);
      console.log(`    GET /stats               - Server statistics`);
      console.log(`  `);
      console.log(
        `  📋 Доступные portnum: TEXT_MESSAGE_APP, POSITION_APP, NODEINFO_APP,`
      );
      console.log(
        `      TELEMETRY_APP, NEIGHBORINFO_APP, WAYPOINT_APP, MAP_REPORT_APP, TRACEROUTE_APP`
      );
    });

    return this.server;
  }

  /**
   * Останавливает сервер
   */
  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log("✅ HTTP Server stopped");
          resolve();
        });
      });
    }
  }
}

export default HTTPServer;
