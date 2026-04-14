import mqtt from "mqtt";
import { shouldLogError, CONSTANTS } from "./utils.mjs";

const { RECONNECT_DELAY } = CONSTANTS;

/**
 * Оптимизированный MQTT Manager с улучшенной обработкой подключений
 */
export class MQTTManager {
  constructor() {
    this.connections = new Map();
    this.messageHandler = null;
    this.reconnectDelay = RECONNECT_DELAY; // Используем константу из utils
    this.connectionTimeout = 30000;
    this.keepAliveInterval = 120;
    this.maxReconnectAttempts = 20; // ~10 минут при задержке 30с
  }

  /**
   * Устанавливает обработчик сообщений
   * @param {Function} handler - Функция обработки сообщений
   */
  setMessageHandler(handler) {
    this.messageHandler = handler;
  }

  /**
   * Подключается ко всем серверам параллельно
   * @param {Array} servers - Массив серверов для подключения
   */
  async connectToAllServers(servers) {
    console.log(
      `🚀 [MQTT-Receiver] Подключение к ${servers.length} серверам...\n`
    );

    // Параллельно подключаемся ко всем серверам
    const connectionPromises = servers.map((server) =>
      this.connectToServer(server)
    );

    // Ждем завершения всех подключений
    const results = await Promise.allSettled(connectionPromises);

    // Анализируем результаты
    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected");

    if (failed.length > 0) {
      console.log(
        `⚠️ [MQTT-Receiver] Ошибки подключения к ${failed.length} серверам:`
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.log(`  - ${servers[index].name}: ${result.reason}`);
        }
      });
    }

    const connectedCount = Array.from(this.connections.values()).filter(
      (conn) => conn.isConnected
    ).length;

    console.log(
      `\n🌐 [MQTT-Receiver] Подключено к ${connectedCount}/${servers.length} серверам`
    );
    console.log(
      "🎧 [MQTT-Receiver] Прослушивание сети Meshtastic со всех серверов...\n"
    );
    console.log("=".repeat(50));

    return { successful, failed: failed.length, total: servers.length };
  }

  /**
   * Подключается к отдельному серверу
   * @param {Object} server - Объект сервера
   */
  async connectToServer(server) {
    return new Promise((resolve, reject) => {
      console.log(`🔌 [MQTT-Receiver] [${server.name}] Подключение...`);

      const clientId = this.generateClientId(server.name);
      const client = this.createMqttClient(server, clientId);

      const connectionInfo = {
        server,
        client,
        isConnected: false,
        reconnectAttempts: 0,
        topics: this.getTopicList(),
        clientId,
      };

      this.connections.set(server.name, connectionInfo);
      this.setupClientEventHandlers(
        client,
        server,
        connectionInfo,
        resolve,
        reject
      );

      // Таймаут для подключения
      const timeout = setTimeout(() => {
        if (!connectionInfo.isConnected) {
          console.log(
            `⏰ [MQTT-Receiver] [${server.name}] Таймаут подключения`
          );
          reject(new Error(`Connection timeout for ${server.name}`));
        }
      }, this.connectionTimeout + 5000);

      // Очищаем таймаут при успешном подключении
      client.on("connect", () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Генерирует уникальный ID клиента
   * @param {string} serverName - Имя сервера
   * @returns {string} - Уникальный ID клиента
   */
  generateClientId(serverName) {
    const cleanName = serverName.replace(/\./g, "_");
    const randomId = Math.random().toString(16).substring(2, 8);
    return `mqtt_receiver_${cleanName}_${randomId}`;
  }

  /**
   * Создает MQTT клиент с оптимизированными настройками
   * @param {Object} server - Объект сервера
   * @param {string} clientId - ID клиента
   * @returns {Object} - MQTT клиент
   */
  createMqttClient(server, clientId) {
    return mqtt.connect(server.address, {
      clientId,
      reconnectPeriod: this.reconnectDelay,
      connectTimeout: this.connectionTimeout,
      keepalive: this.keepAliveInterval,
      clean: true,
      protocolVersion: 4,
      qos: 0,
      will: {
        topic: `status/${clientId}`,
        payload: "offline",
        qos: 0,
        retain: false,
      },
    });
  }

  /**
   * Возвращает список топиков для подписки
   * @returns {Array} - Массив топиков
   */
  getTopicList() {
    return [
      "msh/+/2/map/",
      "msh/+/2/e/+/+",
      "msh/+/+/2/map/",
      "msh/+/+/2/e/+/+",
      "msh/+/+/+/2/map/",
      "msh/+/+/+/2/e/+/+",
      "msh/+/+/+/+/2/map/",
      "msh/+/+/+/+/2/e/+/+",
      "meshcore/+/+/packets",
    ];
  }

  /**
   * Настраивает обработчики событий для MQTT клиента
   * @param {Object} client - MQTT клиент
   * @param {Object} server - Объект сервера
   * @param {Object} connectionInfo - Информация о подключении
   * @param {Function} resolve - Promise resolve
   * @param {Function} reject - Promise reject
   */
  setupClientEventHandlers(client, server, connectionInfo, resolve, reject) {
    client.on("connect", () => {
      console.log(`✅ [MQTT-Receiver] [${server.name}] Подключен`);
      connectionInfo.isConnected = true;
      connectionInfo.reconnectAttempts = 0;

      this.subscribeToTopics(
        client,
        server,
        connectionInfo.topics,
        resolve,
        reject
      );
    });

    client.on("message", (topic, payload) => {
      if (this.messageHandler) {
        try {
          this.messageHandler(server, topic, payload);
        } catch (error) {
          if (shouldLogError(error.message)) {
            console.error(
              `❌ [MQTT-Receiver] [${server.name}] Ошибка обработки сообщения:`,
              error.message
            );
          }
        }
      }
    });

    client.on("error", (error) => {
      if (shouldLogError(error.message)) {
        console.error(
          `❌ [MQTT-Receiver] [${server.name}] MQTT ошибка:`,
          error.message
        );
      }
      connectionInfo.isConnected = false;

      // Если это первое подключение, отклоняем промис
      if (connectionInfo.reconnectAttempts === 0) {
        reject(error);
      }
    });

    client.on("close", () => {
      connectionInfo.isConnected = false;
      console.log(`🔌 [MQTT-Receiver] [${server.name}] Соединение закрыто`);
    });

    client.on("offline", () => {
      connectionInfo.isConnected = false;
      console.log(`📴 [MQTT-Receiver] [${server.name}] Оффлайн`);
    });

    client.on("reconnect", () => {
      connectionInfo.reconnectAttempts++;
      if (connectionInfo.reconnectAttempts > this.maxReconnectAttempts) {
        console.log(
          `⛔ [MQTT-Receiver] [${server.name}] Достигнут лимит попыток (${this.maxReconnectAttempts}), переподключение остановлено`
        );
        client.end(true);
        return;
      }
      console.log(
        `🔄 [MQTT-Receiver] [${server.name}] Переподключение... (попытка ${connectionInfo.reconnectAttempts})`
      );
    });
  }

  /**
   * Подписывается на топики
   * @param {Object} client - MQTT клиент
   * @param {Object} server - Объект сервера
   * @param {Array} topics - Массив топиков
   * @param {Function} resolve - Promise resolve
   * @param {Function} reject - Promise reject
   */
  subscribeToTopics(client, server, topics, resolve, reject) {
    client.subscribe(topics, (err) => {
      if (!err) {
        console.log(
          `📡 [MQTT-Receiver] [${server.name}] Подписан на ${topics.length} топиков`
        );
        resolve({ server, isConnected: true });
      } else {
        console.error(
          `❌ [MQTT-Receiver] [${server.name}] Ошибка подписки:`,
          err.message
        );
        reject(err);
      }
    });
  }

  /**
   * Отключается от всех серверов
   */
  disconnect() {
    console.log("\n👋 [MQTT-Receiver] Отключение от всех серверов...");

    const disconnectPromises = Array.from(this.connections.entries()).map(
      ([serverName, connectionInfo]) => {
        return new Promise((resolve) => {
          if (connectionInfo.client) {
            connectionInfo.client.end(false, {}, () => {
              console.log(`✅ [MQTT-Receiver] [${serverName}] Отключен`);
              resolve();
            });
          } else {
            resolve();
          }
        });
      }
    );

    return Promise.all(disconnectPromises);
  }

  /**
   * Возвращает количество подключенных серверов
   * @returns {number} - Количество подключенных серверов
   */
  getConnectedCount() {
    return Array.from(this.connections.values()).filter(
      (conn) => conn.isConnected
    ).length;
  }

  /**
   * Проверяет подключение к серверу
   * @param {string} serverName - Имя сервера
   * @returns {boolean} - Статус подключения
   */
  isServerConnected(serverName) {
    const connection = this.connections.get(serverName);
    return connection ? connection.isConnected : false;
  }

  /**
   * Возвращает статистику подключений
   * @returns {Object} - Статистика подключений
   */
  getConnectionStats() {
    const stats = {
      total: this.connections.size,
      connected: 0,
      reconnecting: 0,
      failed: 0,
      servers: [],
    };

    this.connections.forEach((conn, name) => {
      const serverStats = {
        name,
        connected: conn.isConnected,
        reconnectAttempts: conn.reconnectAttempts,
        clientId: conn.clientId,
      };

      if (conn.isConnected) {
        stats.connected++;
      } else if (conn.reconnectAttempts > 0) {
        stats.reconnecting++;
      } else {
        stats.failed++;
      }

      stats.servers.push(serverStats);
    });

    return stats;
  }
}

export default MQTTManager;
