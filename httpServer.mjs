import express from "express";
import compression from "compression";
import cors from "cors";
import { handleEndpointError } from "./utils.mjs";
import { adminConfig } from "./config.mjs";

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
    this.app.use(express.json());
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
   * Настраивает маршруты
   */
  setupRoutes() {
    // Админ панель для удаления данных
    this.app.get("/admin", this.handleAdminPage.bind(this));
    this.app.post("/api/delete", this.handleDeleteDevice.bind(this));

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

    // Nodes endpoint - список всех устройств
    this.app.get("/nodes", this.handleNodesEndpoint.bind(this));

    // Dots endpoint - данные для карты
    this.app.get("/dots", this.handleDotsEndpoint.bind(this));
    this.app.get("/dots/:deviceId", this.handleSingleDotEndpoint.bind(this));

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
   * Обрабатывает /dots endpoint - возвращает все данные для карты
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  async handleDotsEndpoint(req, res) {
    try {
      const dots = await this.redisManager.getAllDotData();

      res.json({
        timestamp: Date.now(),
        count: Object.keys(dots).length,
        data: dots,
      });
    } catch (error) {
      handleEndpointError(error, res, "Dots endpoint");
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
   * Строит ответ для /nodes endpoint
   * @returns {Array} - Массив узлов с данными
   */
  async buildNodesResponse() {
    try {
      // Получаем все ключи user: и POSITION_APP:
      const [userKeys, positionKeys] = await Promise.all([
        this.redisManager.redis.keys("user:*"),
        this.redisManager.redis.keys("POSITION_APP:*"),
      ]);

      if (userKeys.length === 0) {
        return [];
      }

      // Получаем данные пользователей
      const userDataPromises = userKeys.map((key) =>
        this.redisManager.redis.hgetall(key)
      );
      const userDataResults = await Promise.all(userDataPromises);

      // Создаем карту пользователей
      const userMap = new Map();
      userKeys.forEach((key, index) => {
        const deviceId = key.split(":")[1];
        const userData = userDataResults[index];
        if (userData && Object.keys(userData).length > 0) {
          userMap.set(deviceId, userData);
        }
      });

      // Получаем последние позиции для каждого устройства
      const positionDataPromises = positionKeys.map(
        (key) => this.redisManager.redis.lrange(key, -1, -1) // Последняя запись
      );
      const positionDataResults = await Promise.all(positionDataPromises);

      // Создаем карту позиций
      const positionMap = new Map();
      positionKeys.forEach((key, index) => {
        const deviceId = key.split(":")[1];
        const positionData = positionDataResults[index];
        if (positionData && positionData.length > 0) {
          try {
            const parsedPosition = JSON.parse(positionData[0]);
            positionMap.set(deviceId, parsedPosition);
          } catch (error) {
            console.error(
              `Error parsing position data for ${deviceId}:`,
              error.message
            );
          }
        }
      });

      // Собираем результат
      const nodes = [];
      userMap.forEach((userData, deviceId) => {
        const position = positionMap.get(deviceId);
        const positionData = position?.rawData || {};

        // Преобразуем hex ID в числовой
        const nodeIdHex = `!${deviceId}`;
        const nodeId = parseInt(deviceId, 16);

        const node = {
          node_id: nodeId.toString(),
          node_id_hex: nodeIdHex,
          long_name: userData.longName || userData.long_name || null,
          short_name: userData.shortName || userData.short_name || null,
          hw_model:
            userData.hwModel || userData.hw_model
              ? parseInt(userData.hwModel || userData.hw_model)
              : null,
          role: userData.role !== undefined ? parseInt(userData.role) : null,
          timestamp: position?.timestamp || null,
          latitudeI:
            positionData?.latitudeI || positionData?.latitude_i || null,
          longitudeI:
            positionData?.longitudeI || positionData?.longitude_i || null,
          altitude: positionData?.altitude || null,
        };

        // Добавляем только узлы с координатами
        if (node.latitudeI !== null && node.longitudeI !== null) {
          nodes.push(node);
        }
      });

      return nodes;
    } catch (error) {
      console.error("Error building nodes response:", error.message);
      return [];
    }
  }

  /**
   * Обрабатывает админ страницу для удаления данных
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  handleAdminPage(req, res) {
    const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meshtastic - Админ панель</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        h1 {
            color: #d32f2f;
            text-align: center;
            margin-bottom: 30px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        input[type="text"] {
            width: 100%;
            padding: 12px;
            border: 2px solid #ddd;
            border-radius: 6px;
            font-size: 16px;
            box-sizing: border-box;
        }
        input[type="text"]:focus {
            outline: none;
            border-color: #4CAF50;
        }
        .delete-btn {
            background: #d32f2f;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            width: 100%;
            margin-top: 10px;
        }
        .delete-btn:hover {
            background: #b71c1c;
        }
        .delete-btn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
        }
        .result {
            margin-top: 20px;
            padding: 15px;
            border-radius: 6px;
            display: none;
        }
        .result.success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }
        .result.error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
        }
        .examples {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
        }
        .examples h3 {
            margin-top: 0;
            color: #495057;
        }
        .examples code {
            background: #e9ecef;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Menlo', monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚠️ Удаление данных устройства</h1>
        
        <div class="warning">
            <strong>ВНИМАНИЕ!</strong> Это действие необратимо. Будут удалены ВСЕ данные устройства из Redis включая GPS, телеметрию, сообщения и пользовательские данные.
        </div>

        <div class="examples">
            <h3>Примеры допустимых форматов:</h3>
            <p>• Hex формат: <code>!015ba416</code></p>
            <p>• Numeric формат: <code>22782998</code></p>
        </div>

        <form id="deleteForm">
            <div class="form-group">
                <label for="password">Пароль админа:</label>
                <input type="password" id="password" name="password" placeholder="Введите пароль" required>
            </div>
            
            <div class="form-group">
                <label for="deviceId">Device ID:</label>
                <input type="text" id="deviceId" name="deviceId" placeholder="!015ba416 или 22782998" required>
            </div>
            
            <button type="submit" class="delete-btn" id="deleteBtn">
                🗑️ Удалить все данные устройства
            </button>
        </form>

        <div id="result" class="result"></div>
    </div>

    <script>
        document.getElementById('deleteForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const password = document.getElementById('password').value.trim();
            const deviceId = document.getElementById('deviceId').value.trim();
            const btn = document.getElementById('deleteBtn');
            const result = document.getElementById('result');
            
            if (!password) {
                showResult('error', 'Введите пароль');
                return;
            }
            
            if (!deviceId) {
                showResult('error', 'Введите Device ID');
                return;
            }
            
            if (!confirm(\`Вы уверены, что хотите удалить ВСЕ данные устройства "\${deviceId}"?\\n\\nЭто действие необратимо!\`)) {
                return;
            }
            
            btn.disabled = true;
            btn.textContent = '⏳ Удаление...';
            
            try {
                const response = await fetch('/api/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ password, deviceId })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    showResult('success', \`Успешно удалено \${data.deletedKeys} ключей для устройства \${deviceId}\`);
                    document.getElementById('password').value = '';
                    document.getElementById('deviceId').value = '';
                } else {
                    showResult('error', data.error || 'Ошибка при удалении');
                }
            } catch (error) {
                showResult('error', 'Ошибка сети: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '🗑️ Удалить все данные устройства';
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
      console.log(`    GET /nodes               - List of all nodes`);
      console.log(`    GET /dots                - All map dots data`);
      console.log(`    GET /dots/:deviceId      - Single device dot data`);
      console.log(`  АДМИН:`);
      console.log(
        `    GET /admin               - Admin panel for device deletion`
      );
      console.log(`    POST /api/delete         - Delete all device data`);
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
