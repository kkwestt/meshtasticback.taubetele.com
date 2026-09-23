import express from "express";
import compression from "compression";
import cors from "cors";
import { handleEndpointError } from "./utils.mjs";
import { adminConfig } from "../config.mjs";

/**
 * Оптимизированный HTTP сервер (только новая схема)
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
    // Ограничиваем количество одновременно обрабатываемых запросов:
    // при всплеске трафика ответы (в т.ч. gzip-буферы) не должны
    // накапливаться в heap без предела
    this.app.use(this.concurrencyLimiter());

    this.app.use(compression());
    this.app.use(express.json({ limit: "100kb" }));
    this.app.use(express.urlencoded({ extended: true }));
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
   * Middleware: ограничение числа одновременных запросов.
   * Лишние запросы получают 503 вместо того, чтобы копиться в памяти.
   */
  concurrencyLimiter() {
    const maxConcurrent = Number(process.env.MAX_CONCURRENT_REQUESTS) || 50;
    let inFlight = 0;

    return (req, res, next) => {
      if (inFlight >= maxConcurrent) {
        res.set("Retry-After", "2");
        return res.status(503).json({
          error: "Service busy",
          message: "Too many concurrent requests, try again shortly",
        });
      }

      inFlight++;
      res.on("close", () => {
        inFlight--;
      });

      next();
    };
  }

  /**
   * Настраивает маршруты
   */
  setupRoutes() {
    // Админ панель для удаления данных
    this.app.get("/admin", this.handleAdminPage.bind(this));
    this.app.post("/api/delete", this.handleDeleteDevice.bind(this));

    // Основные endpoints
    this.app.get("/health", this.handleHealthCheck.bind(this));
    this.app.get("/stats", this.handleStatsEndpoint.bind(this));

    // Специфичные статические endpoints ДО ВСЕХ динамических маршрутов
    // ВАЖНО: эти маршруты должны быть зарегистрированы ПЕРЕД любыми динамическими маршрутами
    this.app.get("/dots_meshcore", this.handleDotsMeshcoreEndpoint.bind(this));
    this.app.get("/map", this.handleMapEndpoint.bind(this));

    // Dots endpoint - данные для карты (оптимизированный)
    this.app.get("/dots", this.handleDotsEndpoint.bind(this));
    this.app.get("/dots/:deviceId", this.handleSingleDotEndpoint.bind(this));

    // Endpoint для формата portnumName:deviceId (должен быть последним среди GET маршрутов)
    // Используем регулярное выражение, чтобы маршрут срабатывал ТОЛЬКО если есть двоеточие
    this.app.get(
      "/:portnumNameAndDeviceId([^/]+:[^/]+)",
      this.handlePortnumColonFormatEndpoint.bind(this)
    );

    // Главный endpoint - заглушка с информацией о сервере
    this.app.get("/", this.handleRootEndpoint.bind(this));

    // Обработка 404
    this.app.use(this.handle404.bind(this));
  }

  /**
   * Обрабатывает главный endpoint - заглушка с информацией
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleRootEndpoint(req, res) {
    try {
      const portnumStats = await this.redisManager.getPortnumStats();

      const totalDevices = Object.values(portnumStats).reduce(
        (sum, stat) => sum + stat.deviceCount,
        0
      );
      const totalMessages = Object.values(portnumStats).reduce(
        (sum, stat) => sum + stat.totalMessages,
        0
      );

      res.json({
        name: "Meshtastic MQTT Server",
        version: "2.0.0",
        description: "Meshtastic MQTT data collection and API server",
        timestamp: Date.now(),
        uptime_seconds: Math.floor(process.uptime()),
        status: "running",

        statistics: {
          total_devices: totalDevices,
          total_messages: totalMessages,
        },

        endpoints: {
          data: {
            "/dots": "Map data for all devices (optimized format)",
            "/map": "Map data in minimal format (fastest)",
            "/dots/:deviceId": "Map data for specific device",
            "/dots_meshcore": "Data from Redis key dots_meshcore",
            "/portnum/:portnumName": "All messages by portnum type",
            "/portnum/:portnumName/:deviceId":
              "Device messages by portnum type",
            "/:portnumName::deviceId": "Device messages (colon format)",
          },
          system: {
            "/health": "Health check",
            "/stats": "Server statistics",
          },
          admin: {
            "/admin": "Admin panel",
          },
        },

        portnum_types: [
          "TEXT_MESSAGE_APP",
          "POSITION_APP",
          "NODEINFO_APP",
          "TELEMETRY_APP",
          "NEIGHBORINFO_APP",
          "WAYPOINT_APP",
          "MAP_REPORT_APP",
          "TRACEROUTE_APP",
        ],

        examples: {
          get_all_dots: "/dots",
          get_map_data: "/map",
          get_device_dot: "/dots/123456789",
          get_position_messages: "/portnum/POSITION_APP",
          get_device_positions: "/portnum/POSITION_APP/123456789",
          get_device_telemetry: "/TELEMETRY_APP:123456789",
        },
      });
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
      res.json({
        timestamp: Date.now(),
        uptime: process.uptime(),
        version: process.version,
      });
    } catch (error) {
      handleEndpointError(error, res, "Stats endpoint");
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
      
      // Разделяем параметр по двоеточию
      const parts = portnumNameAndDeviceId.split(":");
      const [portnumName, deviceId] = parts;

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
   * Обрабатывает /nodes endpoint - возвращает список всех устройств
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleNodesEndpoint(req, res) {
    try {
      const nodes = await this.buildNodesResponse();

      res.json(nodes);
    } catch (error) {
      handleEndpointError(error, res, "Nodes endpoint");
    }
  }

  /**
   * Обрабатывает /dots endpoint - возвращает оптимизированные данные для карты
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleDotsEndpoint(req, res) {
    try {
      const startTime = Date.now();

      // Получаем только необходимые поля для карты (уже в виде JSON-строки)
      const { json, count } = await this.redisManager.getOptimizedDotDataJSON();
      const responseTime = Date.now() - startTime;

      // Добавляем заголовки кэширования
      res.set({
        "Cache-Control": "public, max-age=30", // Кэшируем на 30 секунд
        "Content-Type": "application/json",
        "X-Device-Count": count,
        "X-Response-Time": `${responseTime}ms`,
      });

      // Собираем ответ конкатенацией: без JSON.parse/JSON.stringify
      // большого объекта на каждый запрос
      res.send(
        `{"data":${json},"timestamp":${Date.now()},"response_time_ms":${responseTime},"device_count":${count}}`
      );
    } catch (error) {
      handleEndpointError(error, res, "Dots endpoint");
    }
  }

  /**
   * Обрабатывает /map endpoint - возвращает данные для карты в минимальном формате
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleMapEndpoint(req, res) {
    try {
      const startTime = Date.now();

      // Получаем данные для карты в минимальном формате (JSON-строка)
      const { json, count } = await this.redisManager.getMapDataJSON();

      const responseTime = Date.now() - startTime;

      // Добавляем заголовки кэширования и сжатия
      res.set({
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        "X-Response-Time": `${responseTime}ms`,
        "X-Device-Count": count,
      });

      // Отправляем данные карты в минимальном формате
      res.send(
        `{"data":${json},"timestamp":${Date.now()},"response_time_ms":${responseTime},"device_count":${count}}`
      );
    } catch (error) {
      handleEndpointError(error, res, "Map endpoint");
    }
  }

  /**
   * Обрабатывает /dots/:deviceId endpoint - возвращает данные конкретной точки
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleSingleDotEndpoint(req, res) {
    try {
      const { deviceId } = req.params;

      if (!deviceId || deviceId.length === 0) {
        return res.status(400).json({ error: "Invalid device ID" });
      }

      const dotData = await this.redisManager.getDotData(deviceId);

      if (!dotData) {
        return res.status(404).json({
          error: "Device not found",
          deviceId: deviceId,
        });
      }

      res.json({
        device_id: deviceId,
        timestamp: Date.now(),
        data: dotData,
      });
    } catch (error) {
      handleEndpointError(
        error,
        res,
        `Single dot endpoint (${req.params.deviceId})`
      );
    }
  }

  /**
   * Обрабатывает /dots_meshcore endpoint - возвращает данные из Redis по ключам dots_meshcore:*
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleDotsMeshcoreEndpoint(req, res) {
    try {
      const startTime = Date.now();
      const pattern = "dots_meshcore:*";

      // Данные и кэш (память -> Redis -> SCAN) живут в RedisManager,
      // сюда приходит уже готовая JSON-строка
      const { json, count } = await this.redisManager.getMeshcoreDotsJSON();

      if (count === 0) {
        return res.status(404).json({
          error: "Data not found",
          pattern: pattern,
          message: "No dots_meshcore keys found",
        });
      }

      const responseTime = Date.now() - startTime;

      res.set({
        "Cache-Control": "public, max-age=30",
        "Content-Type": "application/json",
        "X-Device-Count": count,
        "X-Response-Time": `${responseTime}ms`,
      });

      res.send(
        `{"pattern":"${pattern}","timestamp":${Date.now()},"device_count":${count},"data":${json},"response_time_ms":${responseTime}}`
      );
    } catch (error) {
      handleEndpointError(error, res, "Dots meshcore endpoint");
    }
  }

  /**
   * Обрабатывает админ панель
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleAdminPage(req, res) {
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meshtastic Server Admin</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 30px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
            color: #555;
        }
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 12px;
            border: 2px solid #ddd;
            border-radius: 5px;
            font-size: 16px;
            box-sizing: border-box;
        }
        input[type="text"]:focus, input[type="password"]:focus {
            outline: none;
            border-color: #007bff;
        }
        button {
            background: #dc3545;
            color: white;
            padding: 12px 30px;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            cursor: pointer;
            width: 100%;
        }
        button:hover {
            background: #c82333;
        }
        .result {
            margin-top: 20px;
            padding: 15px;
            border-radius: 5px;
            display: none;
        }
        .result.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .result.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .info {
            background: #e7f3ff;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 4px solid #007bff;
        }
        .warning {
            background: #fff3cd;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 4px solid #ffc107;
            color: #856404;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔧 Meshtastic Server Admin</h1>
        
        <div class="info">
            <strong>Информация:</strong> Эта панель позволяет удалить все данные конкретного устройства из базы данных.
        </div>
        
        <div class="warning">
            <strong>⚠️ Внимание:</strong> Удаление данных необратимо! Будут удалены все сообщения, позиции, телеметрия и другие данные устройства.
        </div>

        <form id="deleteForm">
            <div class="form-group">
                <label for="deviceId">Device ID:</label>
                <input type="text" id="deviceId" name="deviceId" 
                       placeholder="!015ba416 или 22782998" required>
                <small style="color: #666;">Формат: hex (!015ba416) или numeric (22782998)</small>
            </div>
            
            <div class="form-group">
                <label for="password">Пароль администратора:</label>
                <input type="password" id="password" name="password" required>
            </div>
            
            <button type="submit">🗑️ Удалить данные устройства</button>
        </form>
        
        <div id="result" class="result"></div>
    </div>

    <script>
    document.getElementById('deleteForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const deviceId = document.getElementById('deviceId').value.trim();
        const password = document.getElementById('password').value;
        
        if (!deviceId || !password) {
            showResult('error', 'Заполните все поля');
            return;
        }
        
        try {
            const response = await fetch('/api/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ deviceId, password })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                showResult('success', \`Успешно удалено \${result.deletedKeys} ключей для устройства \${result.deviceId}\`);
                document.getElementById('deleteForm').reset();
            } else {
                showResult('error', result.error || 'Произошла ошибка');
            }
        } catch (error) {
            showResult('error', 'Ошибка сети: ' + error.message);
        }
    });
    
    function showResult(type, message) {
        const result = document.getElementById('result');
        result.className = \`result \${type}\`;
        result.textContent = message;
        result.style.display = 'block';
        setTimeout(() => {
            result.style.display = 'none';
        }, 5000);
    }
    </script>
</body>
</html>`;

    res.send(html);
  }

  /**
   * Обрабатывает API запрос на удаление данных устройства
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleDeleteDevice(req, res) {
    try {
      const { password, deviceId } = req.body;

      // Проверка пароля
      if (!password || password !== adminConfig.password) {
        return res.status(401).json({
          error: "Неверный пароль",
        });
      }

      if (!deviceId || typeof deviceId !== "string") {
        return res.status(400).json({
          error: "Device ID is required and must be a string",
        });
      }

      const trimmedId = deviceId.trim();
      if (!trimmedId) {
        return res.status(400).json({
          error: "Device ID cannot be empty",
        });
      }

      // Валидация формата Device ID (hex с ! или numeric)
      const hexRegex = /^!([0-9a-fA-F]{8})$/;
      const numericRegex = /^[0-9]+$/;

      if (!hexRegex.test(trimmedId) && !numericRegex.test(trimmedId)) {
        return res.status(400).json({
          error:
            "Invalid Device ID format. Use hex format (!00112233) or numeric format (12345678)",
        });
      }

      // Удаляем все данные устройства
      const deletedKeys = await this.redisManager.deleteAllDeviceData(
        trimmedId
      );

      console.log(
        `🔐 Admin deleted device data: ${trimmedId}, keys: ${deletedKeys}`
      );

      res.json({
        success: true,
        deviceId: trimmedId,
        deletedKeys: deletedKeys,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Error deleting device data:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error.message,
      });
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
      available_endpoints: {
        data: ["/dots", "/portnum/:type/:deviceId"],
        system: ["/health", "/stats"],
        admin: ["/admin"],
      },
    });
  }

  /**
   * Запускает сервер
   */
  start() {
    const PORT = this.serverConfig.port || 80;

    this.server = this.app.listen(PORT, () => {
      // Ограничиваем время жизни соединений и их количество,
      // чтобы зависшие клиенты не удерживали буферы в памяти
      this.server.keepAliveTimeout = 30000;
      this.server.headersTimeout = 35000;
      this.server.requestTimeout = 60000;
      this.server.maxConnections =
        Number(process.env.MAX_CONNECTIONS) || 512;


      console.log(`🌐 HTTP Server running on port ${PORT}`);
      console.log(`📡 Available endpoints:`);
      console.log(`  ДАННЫЕ:`);
      console.log(
        `    GET /dots                    - Map data for all devices (optimized)`
      );
      console.log(
        `    GET /map                     - Map data in minimal format (fastest)`
      );
      console.log(
        `    GET /dots/:deviceId          - Map data for specific device`
      );
      console.log(
        `    GET /dots_meshcore           - Data from Redis key dots_meshcore`
      );
      console.log(`    GET /nodes                   - List of all devices`);
      console.log(`  СИСТЕМА:`);
      console.log(`    GET /health                  - Health check`);
      console.log(`    GET /stats                   - Server statistics`);
      console.log(`    GET /admin                   - Admin panel`);
      console.log(`    POST /api/delete             - Delete device data`);
      console.log(`  `);
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
