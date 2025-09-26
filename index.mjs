import fs from "fs";
import crypto from "crypto";
import path from "path";
import protobufjs from "protobufjs";

// Импортируем новые оптимизированные модули
import { servers, redisConfig, serverConfig } from "./config.mjs";
import { MQTTManager } from "./mqtt.mjs";
import { RedisManager } from "./redisManager.mjs";
import { HTTPServer } from "./httpServer.mjs";
import {
  handleTelegramMessage,
  initializeTelegramBot,
  cleanupTelegramResources,
} from "./telegram.mjs";
import { ProtobufDecoder } from "./protobufDecoder.mjs";
import {
  shouldLogError,
  bufferToHex,
  formatMacAddress,
  round,
  isValidPacket,
  isValidDeviceMetrics,
  isValidEnvironmentMetrics,
  getMessageType,
  isValidMessage,
  getPortnumName,
  isValidUserName,
  CONSTANTS,
} from "./utils.mjs";

const {
  MAX_METADATA_ITEMS_COUNT,
  DEVICE_EXPIRY_TIME,
  DECRYPTION_KEYS,
  PROTOBUFS_PATH,
} = CONSTANTS;

/**
 * Оптимизированный Meshtastic Redis клиент (только новая схема)
 */
class MeshtasticRedisClient {
  constructor() {
    this.mqttManager = new MQTTManager();
    this.redisManager = null;
    this.httpServer = null;
    this.protoTypes = {};
    this.protobufDecoder = new ProtobufDecoder();
    this.stats = {
      messagesProcessed: 0,
      errorsCount: 0,
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
      const memUsage = process.memoryUsage();
      const uptime = Date.now() - this.stats.startTime;
      const errorRate =
        (this.stats.errorsCount / (this.stats.messagesProcessed || 1)) * 100;

      console.log(
        `📊 Статистика: сообщений=${this.stats.messagesProcessed}, ошибок=${
          this.stats.errorsCount
        } (${errorRate.toFixed(2)}%), память=${Math.round(
          memUsage.heapUsed / 1024 / 1024
        )}MB, время=${Math.round(uptime / 1000)}с`
      );

      // Принудительная сборка мусора при высоком потреблении памяти
      if (memUsage.heapUsed > 700 * 1024 * 1024) {
        // 700MB
        console.log(
          `⚠️ КРИТИЧЕСКОЕ потребление памяти: ${Math.round(
            memUsage.heapUsed / 1024 / 1024
          )}MB - запуск сборки мусора`
        );

        // Принудительная сборка мусора
        if (global.gc) {
          global.gc();
          const newMemUsage = process.memoryUsage();
          console.log(
            `🗑️ Сборка мусора завершена. Память: ${Math.round(
              newMemUsage.heapUsed / 1024 / 1024
            )}MB (освобождено ${Math.round(
              (memUsage.heapUsed - newMemUsage.heapUsed) / 1024 / 1024
            )}MB)`
          );
        } else {
          console.log(
            `⚠️ Сборка мусора недоступна. Перезапустите с флагом --expose-gc`
          );
        }
      } else if (memUsage.heapUsed > 500 * 1024 * 1024) {
        // 500MB
        console.log(
          `⚠️ Высокое потребление памяти: ${Math.round(
            memUsage.heapUsed / 1024 / 1024
          )}MB`
        );
      }

      // Предупреждение о высокой частоте ошибок
      if (errorRate > 10) {
        console.log(`⚠️ Высокая частота ошибок: ${errorRate.toFixed(2)}%`);
      }
    }, 30000); // Каждые 30 секунд
  }

  /**
   * Инициализация клиента
   */
  async init() {
    try {
      // console.log("🚀 Инициализация Meshtastic MQTT клиента...");

      // Проверяем protobufs
      this.checkProtobufs();

      // Загружаем protobuf схемы
      await this.loadProtobufs();

      // Инициализируем Redis
      await this.initializeRedis();

      // Инициализируем HTTP сервер
      this.initializeHttpServer();

      // Инициализируем Telegram бот
      this.initializeTelegramBot();

      // Инициализируем MQTT
      await this.initializeMqtt();

      // console.log("✅ Инициализация завершена успешно!");
    } catch (error) {
      console.error("❌ Ошибка инициализации:", error);
      process.exit(1);
    }
  }

  /**
   * Проверяет наличие protobuf файлов
   */
  checkProtobufs() {
    const mqttProtoPath = path.join(PROTOBUFS_PATH, "meshtastic/mqtt.proto");
    if (!fs.existsSync(mqttProtoPath)) {
      console.error(
        [
          "❌ ОШИБКА: Не найдены Meshtastic protobufs.",
          "",
          "Для работы клиента необходимо склонировать protobufs:",
          "git clone https://github.com/meshtastic/protobufs.git",
        ].join("\n")
      );
      throw new Error("Protobufs не найдены");
    }
  }

  /**
   * Загружает protobuf схемы
   */
  async loadProtobufs() {
    try {
      const root = new protobufjs.Root();
      root.resolvePath = (origin, target) => path.join(PROTOBUFS_PATH, target);
      root.loadSync("meshtastic/mqtt.proto");

      this.protoTypes = {
        ServiceEnvelope: root.lookupType("ServiceEnvelope"),
        Data: root.lookupType("Data"),
        Position: root.lookupType("Position"),
        User: root.lookupType("User"),
        Telemetry: root.lookupType("Telemetry"),
        Waypoint: root.lookupType("Waypoint"),
        MapReport: root.lookupType("MapReport"),
        NeighborInfo: root.lookupType("NeighborInfo"),
        RouteDiscovery: root.lookupType("RouteDiscovery"),
      };

      // console.log("✅ Protobuf схемы успешно загружены");
    } catch (error) {
      console.error("❌ Ошибка загрузки protobuf схем:", error);
      throw error;
    }
  }

  /**
   * Инициализирует Redis Manager
   */
  async initializeRedis() {
    try {
      this.redisManager = new RedisManager(redisConfig);
      await this.redisManager.ping();

      // Запускаем очистку кэша
      this.redisManager.startCacheCleanup();

      // console.log("✅ Redis подключен и настроен");
    } catch (error) {
      console.error("❌ Ошибка подключения к Redis:", error.message);
      throw error;
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
   * Инициализирует Telegram бот
   */
  initializeTelegramBot() {
    initializeTelegramBot(this.redisManager);
  }

  /**
   * Инициализирует MQTT подключения
   */
  async initializeMqtt() {
    // Устанавливаем обработчик сообщений
    this.mqttManager.setMessageHandler((server, topic, payload) => {
      this.handleMessage(server, topic, payload);
    });

    // Подключаемся к серверам
    const result = await this.mqttManager.connectToAllServers(servers);

    if (result.successful === 0) {
      throw new Error("Не удалось подключиться ни к одному серверу");
    }

    console.log(
      `✅ MQTT подключения установлены: ${result.successful}/${result.total}`
    );
  }

  /**
   * Обрабатывает входящие MQTT сообщения
   */
  handleMessage(server, topic, payload) {
    try {
      this.stats.messagesProcessed++;

      // Краткое логирование для мониторинга
      if (this.stats.messagesProcessed % 1000 === 0) {
        console.log(
          `📊 Обработано сообщений: ${this.stats.messagesProcessed}, ошибок: ${this.stats.errorsCount}`
        );
      }

      // console.log("=".repeat(50));
      // console.log(`📨 [${server.name}] Получено сообщение на топик: ${topic}`);

      // Парсим топик
      const topicParts = topic.split("/");
      if (topicParts.length < 3) {
        console.log(`⚠️ [${server.name}] Неверный формат топика: ${topic}`);
        return;
      }

      const [, , type, channel, user] = topicParts;
      // console.log(`📋 Тип: ${type}, Канал: ${channel}, Пользователь: ${user}`);

      // Пропускаем статусные сообщения
      if (type === "stat") {
        console.log(`📊 Пропускаем статусное сообщение`);
        return;
      }

      // Обрабатываем JSON сообщения
      if (type === "json") {
        this.handleJsonMessage(server, topic, user, payload);
        return;
      }

      // Обрабатываем protobuf сообщения
      if (payload && payload.length > 0) {
        // console.log(
        //   `🔧 Обрабатываем protobuf сообщение, размер: ${payload.length} байт`
        // );
        this.handleProtobufMessage(
          server,
          topic,
          user,
          new Uint8Array(payload)
        );
      } else {
        console.log(`⚠️ Пустой payload`);
      }
    } catch (error) {
      this.stats.errorsCount++;
      console.error(
        `❌ [${server.name}] Ошибка обработки сообщения:`,
        error.message
      );

      // Критическая ошибка - может привести к перезапуску
      if (
        error.message.includes("out of memory") ||
        error.message.includes("Maximum call stack")
      ) {
        console.error(`🚨 КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
        console.error(
          `📊 Состояние: сообщений=${this.stats.messagesProcessed}, ошибок=${this.stats.errorsCount}`
        );
      }
    }
  }

  /**
   * Обрабатывает JSON сообщения
   */
  handleJsonMessage(server, topic, user, payload) {
    try {
      const jsonData = JSON.parse(payload.toString());
      // JSON данные получены
      this.processEvent(server, topic, user, "json", "json", jsonData);
    } catch (parseError) {
      console.error(
        `❌ [${server.name}] Ошибка парсинга JSON:`,
        parseError.message
      );
    }
  }

  /**
   * Обрабатывает protobuf сообщения
   */
  handleProtobufMessage(server, fullTopic, user, arrayBuffer) {
    try {
      // console.log(`🔍 Декодируем ServiceEnvelope...`);

      // Логирование больших пакетов
      if (arrayBuffer.length > 100000) {
        console.log(
          `⚠️ [${server.name}] Большой пакет: ${arrayBuffer.length} байт, пользователь: ${user}`
        );
      }

      // Валидация пакета
      if (!isValidPacket(arrayBuffer)) {
        console.log(
          `⚠️ [${server.name}] Невалидный пакет от ${user}, размер: ${arrayBuffer.length}`
        );
        return;
      }

      // Дополнительная проверка размера перед декодированием
      if (arrayBuffer.length > 1048576) {
        // 1MB лимит
        console.log(
          `❌ [${server.name}] Пакет слишком большой: ${arrayBuffer.length} байт от ${user}`
        );
        return;
      }

      let serviceEnvelope;
      try {
        serviceEnvelope = this.protoTypes.ServiceEnvelope.decode(arrayBuffer);
      } catch (decodeError) {
        // Логируем только если это не подавляемая ошибка
        if (shouldLogError(decodeError.message)) {
          console.error(
            `❌ Ошибка декодирования ServiceEnvelope: ${decodeError.message}`
          );
        }
        return;
      }

      if (!serviceEnvelope?.packet) {
        console.log(`❌ ServiceEnvelope НЕ декодирован`);
        return;
      }

      const meshPacket = serviceEnvelope.packet;
      const { channelId, gatewayId } = serviceEnvelope;

      // Обрабатываем MeshPacket

      // Обрабатываем decoded данные
      if (meshPacket.decoded) {
        this.processDecodedPacket(
          server,
          fullTopic,
          user,
          meshPacket,
          gatewayId
        );
      }
      // Обрабатываем зашифрованные пакеты
      else if (meshPacket.encrypted?.length > 0) {
        this.processEncryptedPacket(
          server,
          fullTopic,
          user,
          meshPacket,
          gatewayId
        );
      } else {
        console.log(`⚠️ Нет decoded и encrypted данных в пакете`);
      }
    } catch (error) {
      console.error(`❌ Ошибка обработки protobuf:`, error.message);
    }
  }

  /**
   * Обрабатывает декодированный пакет
   */
  processDecodedPacket(server, fullTopic, user, meshPacket, gatewayId) {
    const event = this.createEvent(
      server,
      fullTopic,
      user,
      meshPacket,
      gatewayId,
      meshPacket.decoded
    );
    const eventType = this.getEventTypeByPortnum(meshPacket.decoded.portnum);

    if (eventType) {
      this.processEvent(server, fullTopic, user, "decoded", eventType, event);
    }
  }

  /**
   * Обрабатывает зашифрованный пакет
   */
  processEncryptedPacket(server, fullTopic, user, meshPacket, gatewayId) {
    // console.log(`🔐 Пытаемся расшифровать пакет`);

    const decrypted = this.decrypt(meshPacket);
    if (decrypted) {
      // console.log(`✅ Пакет расшифрован, portnum: ${decrypted.portnum}`);

      const event = this.createEvent(
        server,
        fullTopic,
        user,
        meshPacket,
        gatewayId,
        decrypted
      );
      const eventType = this.getEventTypeByPortnum(decrypted.portnum);

      // console.log(`🎯 Тип расшифрованного события: ${eventType}`);

      if (eventType) {
        this.processEvent(server, fullTopic, user, "decoded", eventType, event);
      } else {
        // const portnumName = this.getPortnumName(decrypted.portnum);
        // console.log(
        //   `⚠️ Неизвестный portnum в расшифрованном: ${decrypted.portnum} (${portnumName})`
        // );
      }
    } else {
      // Не удалось расшифровать пакет
    }
  }

  /**
   * Создает объект события
   */
  createEvent(server, fullTopic, user, meshPacket, gatewayId, data) {
    return {
      rxSnr: meshPacket.rxSnr,
      hopLimit: meshPacket.hopLimit,
      wantAck: meshPacket.wantAck,
      rxRssi: meshPacket.rxRssi,
      gatewayId,
      from: meshPacket.from,
      to: meshPacket.to, // Добавляем поле to
      id: meshPacket.id,
      data,
      packet: meshPacket,
    };
  }

  /**
   * Определяет тип события по portnum
   */
  getEventTypeByPortnum(portnum) {
    switch (portnum) {
      case 1:
      case "TEXT_MESSAGE_APP":
        return "message";
      case 3:
      case "POSITION_APP":
        return "position";
      case 4:
      case "NODEINFO_APP":
        return "user";
      case 67:
      case "TELEMETRY_APP":
        return "telemetry";
      case 71:
      case "NEIGHBORINFO_APP":
        return "neighborInfo";
      case 8:
      case "WAYPOINT_APP":
        return "waypoint";
      case 73:
      case "MAP_REPORT_APP":
        return "mapReport";
      case 70:
      case "TRACEROUTE_APP":
        return "traceroute";
      default:
        return null;
    }
  }

  /**
   * Получает название portnum по номеру
   */
  getPortnumName(portnum) {
    const portnumNames = {
      0: "UNKNOWN_APP",
      1: "TEXT_MESSAGE_APP",
      2: "REMOTE_HARDWARE_APP",
      3: "POSITION_APP",
      4: "NODEINFO_APP",
      5: "REPLY_APP",
      6: "IP_TUNNEL_APP",
      7: "TEXT_MESSAGE_COMPRESSED_APP",
      8: "WAYPOINT_APP",
      9: "AUDIO_APP",
      10: "DETECTION_SENSOR_APP",
      32: "PRIVATE_APP",
      33: "ATAK_FORWARDER",
      34: "PAXCOUNTER_APP",
      35: "SERIAL_APP",
      36: "STORE_FORWARD_APP",
      37: "RANGE_TEST_APP",
      64: "RANGE_TEST_APP",
      65: "STORE_FORWARD_APP",
      66: "ZPS_APP",
      67: "TELEMETRY_APP",
      68: "SIMULATOR_APP",
      69: "TRACEROUTE_APP",
      70: "PAXCOUNTER_APP",
      71: "NEIGHBORINFO_APP",
      72: "ATAK_PLUGIN",
      73: "MAP_REPORT_APP",
      256: "PRIVATE_APP",
      257: "ATAK_FORWARDER",
    };

    return portnumNames[portnum] || `UNKNOWN_${portnum}`;
  }

  /**
   * Основная функция обработки событий (только новая схема)
   */
  async processEvent(server, fullTopic, user, eventName, eventType, event) {
    try {
      const { from } = event;
      if (!from) {
        console.log(`⚠️ [${server.name}] Событие без from: ${eventType}`);
        return;
      }

      // Обновляем время последней активности для карты
      await this.updateDotActivityTime(from, event, server);

      // Initialize dataToSave with event.data as default
      let dataToSave = event.data;

      // Сохраняем все расшифрованные сообщения по portnum (НОВАЯ СХЕМА)
      if (event.data?.portnum) {
        // Декодируем payload если он есть
        if (event.data.payload) {
          try {
            const payloadBuffer = Buffer.from(event.data.payload, "base64");
            const decodedPayload = this.protobufDecoder.decodePayload(
              event.data.portnum,
              payloadBuffer
            );

            // Сохраняем декодированные данные вместо base64 payload
            dataToSave = {
              portnum: event.data.portnum,
              ...decodedPayload.data,
            };

            // Обновляем данные для карты на основе типа сообщения
            await this.updateDotDataFromPortnum(
              event.data.portnum,
              event.from,
              decodedPayload.data,
              {
                gatewayId: event.gatewayId,
                rawDataId: decodedPayload.data.id,
              }
            );
          } catch (error) {
            // Если декодирование не удалось, сохраняем как есть
            dataToSave = {
              portnum: event.data.portnum,
              payload: event.data.payload,
            };
          }
        }

        const portnumData = {
          timestamp: Date.now(),
          from: event.from,
          to: event.packet?.to,
          rxTime: event.packet?.rxTime * 1000 || Date.now(),
          rxSnr: event.rxSnr,
          hopLimit: event.hopLimit,
          rxRssi: event.rxRssi,
          gatewayId: event.gatewayId,
          server: server.name,
          rawData: dataToSave,
        };

        const portnumName = this.getPortnumName(event.data.portnum);

        await this.redisManager.savePortnumMessage(
          event.data.portnum,
          event.from,
          portnumData
        );
      }

      // Обрабатываем Telegram сообщения для текстовых сообщений
      if (eventType === "message" && event.data?.portnum === 1) {
        // Создаем событие в формате, ожидаемом handleTelegramMessage
        const telegramEvent = {
          id: event.id,
          from: event.from,
          to: event.to, // Добавляем поле to
          gatewayId: event.gatewayId,
          rxRssi: event.rxRssi,
          rxSnr: event.rxSnr,
          hopLimit: event.hopLimit,
          type: "broadcast", // Устанавливаем тип как broadcast для текстовых сообщений
          data: dataToSave?.text || dataToSave, // Текст сообщения
          text:
            dataToSave?.text ||
            (typeof dataToSave === "string" ? dataToSave : "N/A"),
        };

        // Вызываем обработчик Telegram сообщений
        await handleTelegramMessage(
          this.redisManager,
          server,
          fullTopic,
          telegramEvent
        );
      }
    } catch (error) {
      console.error("❌ Ошибка обработки события:", error.message);
    }
  }

  /**
   * Обновляет данные точки на основе типа portnum сообщения
   */
  async updateDotDataFromPortnum(
    portnum,
    deviceId,
    decodedData,
    additionalInfo = null
  ) {
    try {
      // Обрабатываем разные типы сообщений для обновления dots данных
      if (portnum === 4 || portnum === "NODEINFO_APP") {
        // Данные пользователя
        const longName = decodedData.long_name || decodedData.longName;
        const shortName = decodedData.short_name || decodedData.shortName;
        const id = decodedData.id;

        // Валидируем имена перед сохранением
        const validLongName =
          longName && isValidUserName(longName) ? longName : "";
        const validShortName =
          shortName && isValidUserName(shortName) ? shortName : "";

        // Логируем отклоненные имена для мониторинга
        // if (longName && !validLongName) {
        //   console.log(
        //     `⚠️ Отклонено некорректное длинное имя для устройства ${deviceId}: "${longName}"`
        //   );
        // }
        // if (shortName && !validShortName) {
        //   console.log(
        //     `⚠️ Отклонено некорректное короткое имя для устройства ${deviceId}: "${shortName}"`
        //   );
        // }

        if (validLongName || validShortName) {
          await this.redisManager.updateDotData(
            deviceId,
            {
              longName: validLongName,
              shortName: validShortName,
            },
            additionalInfo
          );
        }
      } else if (portnum === 3 || portnum === "POSITION_APP") {
        // Данные позиции
        const latitudeI = decodedData.latitude_i || decodedData.latitudeI;
        const longitudeI = decodedData.longitude_i || decodedData.longitudeI;

        if (latitudeI && longitudeI && latitudeI !== 0 && longitudeI !== 0) {
          const latitude = latitudeI / 1e7;
          const longitude = longitudeI / 1e7;

          await this.redisManager.updateDotData(
            deviceId,
            {
              latitude,
              longitude,
            },
            additionalInfo
          );
        }
      }
    } catch (error) {
      const portnumName = this.getPortnumName(portnum);
      console.error(
        `Error updating dot data from portnum ${portnum} (${portnumName}):`,
        error.message
      );
    }
  }

  /**
   * Общий метод для декодирования payload
   */
  decodePayload(protoType, payload) {
    try {
      // Проверяем валидность входных данных
      if (!payload || typeof payload !== "string") {
        throw new Error(
          `Invalid payload: expected base64 string, got ${typeof payload}`
        );
      }

      if (!this.protoTypes[protoType]) {
        throw new Error(`Unknown proto type: ${protoType}`);
      }

      const payloadBuffer = Buffer.from(payload, "base64");

      // Проверяем размер декодированного буфера
      if (payloadBuffer.length === 0) {
        throw new Error(`Empty payload after base64 decode`);
      }

      if (payloadBuffer.length > 65536) {
        // 64KB лимит
        throw new Error(`Payload too large: ${payloadBuffer.length} bytes`);
      }

      return this.protoTypes[protoType].decode(payloadBuffer);
    } catch (error) {
      // Если это не подавляемая ошибка, выбрасываем оригинальную
      if (shouldLogError(error.message)) {
        throw new Error(`Failed to decode ${protoType}: ${error.message}`);
      }
      // Возвращаем null для подавляемых ошибок
      return null;
    }
  }

  /**
   * Создает nonce для расшифровки
   */
  createNonce(packetId, fromNode) {
    const packetId64 = BigInt(packetId);
    const blockCounter = 0;
    const buf = Buffer.alloc(16);

    buf.writeBigUInt64LE(packetId64, 0);
    buf.writeUInt32LE(fromNode, 8);
    buf.writeUInt32LE(blockCounter, 12);

    return buf;
  }

  /**
   * Обновляет время активности и соответствующие данные для карты
   */
  async updateDotActivityTime(from, event, server) {
    try {
      // Обновляем только время активности, без лишних полей
      await this.redisManager.updateDotData(from, {});
    } catch (error) {
      console.error("Error updating dot activity time:", error.message);
    }
  }

  /**
   * Расшифровывает пакет
   */
  decrypt(packet) {
    // Проверяем валидность входных данных
    if (!packet?.encrypted || !packet.id || !packet.from) {
      console.log(
        `⚠️ Неполные данные для расшифровки: encrypted=${!!packet?.encrypted}, id=${
          packet?.id
        }, from=${packet?.from}`
      );
      return null;
    }

    // Проверяем размер зашифрованных данных
    if (packet.encrypted.length === 0 || packet.encrypted.length > 65536) {
      console.log(
        `⚠️ Некорректный размер зашифрованных данных: ${packet.encrypted.length} байт`
      );
      return null;
    }

    for (const decryptionKey of DECRYPTION_KEYS) {
      try {
        const key = Buffer.from(decryptionKey, "base64");
        const nonceBuffer = this.createNonce(packet.id, packet.from);

        let algorithm = null;
        if (key.length === 16) {
          algorithm = "aes-128-ctr";
        } else if (key.length === 32) {
          algorithm = "aes-256-ctr";
        } else {
          continue;
        }

        const decipher = crypto.createDecipheriv(algorithm, key, nonceBuffer);
        const decryptedBuffer = Buffer.concat([
          decipher.update(packet.encrypted),
          decipher.final(),
        ]);

        // Проверяем размер расшифрованных данных
        if (decryptedBuffer.length === 0 || decryptedBuffer.length > 65536) {
          continue;
        }

        try {
          return this.protoTypes.Data.decode(decryptedBuffer);
        } catch (decodeError) {
          // Если декодирование не удалось, продолжаем со следующим ключом
          continue;
        }
      } catch (e) {
        // Пробуем следующий ключ
      }
    }

    return null;
  }

  /**
   * Корректное отключение
   */
  async disconnect() {
    console.log("👋 Отключение от всех сервисов...");

    try {
      // Очищаем интервалы
      if (this.performanceInterval) {
        clearInterval(this.performanceInterval);
        console.log("✅ Интервал мониторинга производительности остановлен");
      }

      // Отключаем MQTT
      await this.mqttManager.disconnect();

      // Останавливаем HTTP сервер
      if (this.httpServer) {
        await this.httpServer.stop();
      }

      // Отключаем Redis
      if (this.redisManager) {
        await this.redisManager.disconnect();
      }

      // Очищаем ресурсы Telegram
      cleanupTelegramResources();

      // Очищаем кэши
      if (this.redisManager) {
        this.redisManager.clearCache();
        console.log("✅ Кэши очищены");
      }

      // Принудительная сборка мусора при отключении
      if (global.gc) {
        global.gc();
        console.log("✅ Выполнена сборка мусора");
      }
    } catch (error) {
      console.error("Ошибка при отключении:", error);
    }
  }
}

/**
 * Главная функция запуска приложения
 */
async function main() {
  console.log("🚀 Запуск Meshtastic MQTT сервера...");
  console.log(`📡 Подключение к ${servers.length} серверам:`);
  servers.forEach((server) => {
    console.log(`  🌐 ${server.name} (${server.address})`);
  });

  const client = new MeshtasticRedisClient();

  // Обработка сигналов для корректного завершения
  const gracefulShutdown = async (signal) => {
    // console.log(`\n👋 Получен сигнал ${signal}, завершение работы...`);
    await client.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  // Обработка необработанных исключений
  process.on("uncaughtException", (error) => {
    console.error("🚨 НЕОБРАБОТАННОЕ ИСКЛЮЧЕНИЕ:", error);
    console.error("📊 Stack trace:", error.stack);
    console.error("⏰ Время:", new Date().toISOString());
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("🚨 НЕОБРАБОТАННОЕ ОТКЛОНЕНИЕ PROMISE:", reason);
    console.error("📊 Promise:", promise);
    console.error("⏰ Время:", new Date().toISOString());
  });

  // Запускаем клиент
  await client.init();
}

// Запускаем только если файл запущен напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("❌ Критическая ошибка в main():");
    console.error("  📍 Местоположение: main()");
    console.error("  🔍 Тип ошибки:", error.constructor.name);
    console.error("  💬 Сообщение:", error.message);
    console.error("  📊 Stack trace:", error.stack);
    console.error("  ⏰ Время:", new Date().toISOString());
    process.exit(1);
  });
}

export default MeshtasticRedisClient;
