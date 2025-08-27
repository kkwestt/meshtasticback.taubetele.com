import fs from "fs";
import crypto from "crypto";
import path from "path";
import protobufjs from "protobufjs";

// Импортируем новые оптимизированные модули
import { servers, redisConfig, serverConfig } from "./config.mjs";
import { MQTTManager } from "./mqtt.mjs";
import { RedisManager } from "./redisManager.mjs";
import { HTTPServer } from "./httpServer.mjs";
import { handleTelegramMessage, initializeTelegramBot } from "./telegram.mjs";
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
  CONSTANTS,
} from "./utils.mjs";

const {
  MAX_METADATA_ITEMS_COUNT,
  DEVICE_EXPIRY_TIME,
  DECRYPTION_KEYS,
  PROTOBUFS_PATH,
} = CONSTANTS;

/**
 * Оптимизированный Meshtastic Redis клиент
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
    initializeTelegramBot(this.redisManager.redis);
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

      // console.log("=".repeat(50));
      // console.log(`📨 [${server.name}] Получено сообщение на топик: ${topic}`);

      // Парсим топик
      const topicParts = topic.split("/");
      if (topicParts.length < 3) {
        console.log(`⚠️ Неверный формат топика: ${topic}`);
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

      // Валидация пакета
      if (!isValidPacket(arrayBuffer)) {
        // console.log(`❌ Пакет НЕ валидный`);
        return;
      }

      // Дополнительная проверка размера перед декодированием
      if (arrayBuffer.length > 1048576) {
        // 1MB лимит
        console.log(`❌ Пакет слишком большой: ${arrayBuffer.length} байт`);
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
        console.log(
          `⚠️ Неизвестный portnum в расшифрованном: ${decrypted.portnum}`
        );
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
   * Основная функция обработки событий
   */
  async processEvent(server, fullTopic, user, eventName, eventType, event) {
    try {
      const { from } = event;
      if (!from) {
        return;
      }

      const key = `device:${from}`;
      const serverTime = Date.now();

      // Обновляем время последней активности для карты [[memory:3665001]]
      await this.updateDotActivityTime(from, event, server);

      // Сохраняем все расшифрованные сообщения по portnum
      if (event.data?.portnum) {
        // Декодируем payload если он есть
        let dataToSave = event.data;
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

            // Сохраняем в старую схему для соответствующих типов
            if (
              event.data.portnum === 4 ||
              event.data.portnum === "NODEINFO_APP"
            ) {
              await this.saveUserDataToOldSchema(
                server,
                event,
                key,
                serverTime,
                decodedPayload.data
              );
            } else if (
              event.data.portnum === 3 ||
              event.data.portnum === "POSITION_APP"
            ) {
              await this.savePositionDataToOldSchema(
                server,
                event,
                key,
                serverTime,
                decodedPayload.data
              );
            } else if (
              event.data.portnum === 67 ||
              event.data.portnum === "TELEMETRY_APP"
            ) {
              await this.saveTelemetryDataToOldSchema(
                server,
                event,
                key,
                serverTime,
                decodedPayload.data
              );
            }
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

        await this.redisManager.savePortnumMessage(
          event.data.portnum,
          event.from,
          portnumData
        );
      }

      // СТАРАЯ СХЕМА: Обрабатываем разные типы событий как было раньше (кроме user - он уже обработан выше)
      switch (eventType) {
        // case "user": // Убрано - теперь обрабатывается в новой схеме
        //   await this.handleUserEvent(server, event, key, serverTime);
        //   break;
        case "position":
          await this.handlePositionEvent(server, event, key, serverTime);
          break;
        case "telemetry":
          await this.handleTelemetryEvent(server, event, key, serverTime);
          break;
        case "message":
          await this.handleMessageEvent(
            server,
            fullTopic,
            event,
            key,
            serverTime
          );
          break;
        case "neighborInfo":
          await this.handleNeighborInfoEvent(server, event, from, serverTime);
          break;
        case "mapReport":
          await this.handleMapReportEvent(server, event, from, serverTime);
          break;
        default:
        // Неизвестный тип события
      }
    } catch (error) {
      console.error("❌ Ошибка обработки события:", error.message);
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
   * Общий метод для создания deviceData структуры
   */
  createDeviceData(event, data) {
    return {
      timestamp: Date.now(),
      rxTime: event.packet?.rxTime * 1000 || Date.now(),
      type: "broadcast",
      from: event.from,
      to: event.packet?.to || 4294967295,
      rxSnr: event.rxSnr,
      hopLimit: event.hopLimit,
      rxRssi: event.rxRssi,
      gatewayId: event.gatewayId,
      data,
    };
  }

  /**
   * Общий метод для сохранения данных в Redis (старая схема)
   */
  async saveToRedis(key, serverTime, data, server, dataType) {
    await this.redisManager.saveDeviceData(key, {
      server: server.name,
      timestamp: serverTime,
      [dataType]: JSON.stringify(data),
    });
  }

  /**
   * Сохраняет декодированные данные пользователя в старую схему
   */
  async saveUserDataToOldSchema(
    server,
    event,
    key,
    serverTime,
    decodedUserData
  ) {
    try {
      console.log(
        `🔍 [DEBUG] NODEINFO_APP data for device ${event.from}:`,
        decodedUserData
      );

      const id = decodedUserData.id;
      const longName = decodedUserData.long_name || decodedUserData.longName;
      const shortName = decodedUserData.short_name || decodedUserData.shortName;
      const macaddr = decodedUserData.macaddr;
      const publicKey = decodedUserData.public_key || decodedUserData.publicKey;
      const hwModel = decodedUserData.hw_model || decodedUserData.hwModel;
      const role = decodedUserData.role;

      console.log(
        `🔍 [DEBUG] Extracted names - longName: "${longName}", shortName: "${shortName}"`
      );

      const userRecord = {
        from: event.from,
        shortName,
        longName,
        macaddr: formatMacAddress(macaddr),
        publicKey: bufferToHex(publicKey),
        hwModel,
        role,
      };

      // Сохраняем данные пользователя отдельно в user:!hexId
      await this.redisManager.saveUserData(id, userRecord);

      // Сохраняем в device ключ
      const deviceData = this.createDeviceData(event, userRecord);
      await this.saveToRedis(key, serverTime, deviceData, server, "user");

      // Обновляем информацию об устройстве в dots ключе
      await this.redisManager.updateDotData(event.from, {
        shortName: shortName,
        longName: longName,
        hw_model: hwModel,
        role,
      });
    } catch (error) {
      console.error("❌ Error saving user data to old schema:", error.message);
    }
  }

  /**
   * Сохраняет декодированные данные позиции в старую схему
   */
  async savePositionDataToOldSchema(
    server,
    event,
    key,
    serverTime,
    decodedPositionData
  ) {
    try {
      const {
        latitude_i: latitudeI,
        longitude_i: longitudeI,
        altitude,
        sats_in_view: satsInView,
        time: posTime,
      } = decodedPositionData;

      // Проверяем валидность координат
      if (latitudeI && longitudeI && latitudeI !== 0 && longitudeI !== 0) {
        // Сохраняем в gps ключ
        const gpsKey = `gps:${event.from}`;
        const newPosItem = {
          latitudeI,
          longitudeI,
          altitude: altitude || undefined,
          time: serverTime,
        };

        await this.redisManager.upsertItem(gpsKey, serverTime, newPosItem);

        // Сохраняем в device ключ
        const deviceData = this.createDeviceData(event, {
          latitudeI,
          longitudeI,
          altitude: altitude || undefined,
          time: posTime || undefined,
          satsInView,
        });

        await this.saveToRedis(key, serverTime, deviceData, server, "position");

        // Обновляем геолокацию в dots ключе
        const latitude = latitudeI / 1e7;
        const longitude = longitudeI / 1e7;

        await this.redisManager.updateDotData(event.from, {
          latitude,
          longitude,
        });
      }
    } catch (error) {
      console.error(
        "❌ Error saving position data to old schema:",
        error.message
      );
    }
  }

  /**
   * Сохраняет декодированные данные телеметрии в старую схему
   */
  async saveTelemetryDataToOldSchema(
    server,
    event,
    key,
    serverTime,
    decodedTelemetryData
  ) {
    try {
      const { type, variant } =
        decodedTelemetryData.rawData || decodedTelemetryData;

      if (type === "deviceMetrics" && variant?.value) {
        const deviceMetrics = variant.value;
        await this.handleDeviceMetrics(
          server,
          event,
          key,
          serverTime,
          deviceMetrics
        );
      } else if (type === "environmentMetrics" && variant?.value) {
        const environmentMetrics = variant.value;
        await this.handleEnvironmentMetrics(
          server,
          event,
          key,
          serverTime,
          environmentMetrics
        );
      }
    } catch (error) {
      console.error(
        "❌ Error saving telemetry data to old schema:",
        error.message
      );
    }
  }

  /**
   * Обрабатывает события позиции (СТАРАЯ СХЕМА)
   */
  async handlePositionEvent(server, event, key, serverTime) {
    try {
      if (!event.data?.payload) return;

      const positionData = this.decodePayload("Position", event.data.payload);
      if (!positionData) return; // Пропускаем если декодирование не удалось

      const {
        latitudeI,
        longitudeI,
        altitude,
        satsInView,
        time: posTime,
      } = positionData;

      // Проверяем валидность координат
      if (latitudeI && longitudeI && latitudeI !== 0 && longitudeI !== 0) {
        // Сохраняем в gps ключ
        const gpsKey = `gps:${event.from}`;
        const newPosItem = {
          latitudeI,
          longitudeI,
          altitude: altitude || undefined,
          time: serverTime,
        };

        await this.redisManager.upsertItem(gpsKey, serverTime, newPosItem);

        // Сохраняем в device ключ
        const deviceData = this.createDeviceData(event, {
          latitudeI,
          longitudeI,
          altitude: altitude || undefined,
          time: posTime || undefined,
          satsInView,
        });

        await this.saveToRedis(key, serverTime, deviceData, server, "position");
      }
    } catch (error) {
      console.error("Error handling position event:", error.message);
    }
  }

  /**
   * Обрабатывает телеметрические события (СТАРАЯ СХЕМА)
   */
  async handleTelemetryEvent(server, event, key, serverTime) {
    try {
      if (!event.data?.payload) return;

      const telemetryData = this.decodePayload("Telemetry", event.data.payload);
      if (!telemetryData) return; // Пропускаем если декодирование не удалось

      // Определяем тип телеметрии
      let deviceMetrics = null;
      let environmentMetrics = null;

      if (telemetryData.variant?.case === "deviceMetrics") {
        deviceMetrics = telemetryData.variant.value;
      } else if (telemetryData.variant?.case === "environmentMetrics") {
        environmentMetrics = telemetryData.variant.value;
      } else if (telemetryData.deviceMetrics) {
        deviceMetrics = telemetryData.deviceMetrics;
      } else if (telemetryData.environmentMetrics) {
        environmentMetrics = telemetryData.environmentMetrics;
      }

      if (deviceMetrics) {
        await this.handleDeviceMetrics(
          server,
          event,
          key,
          serverTime,
          deviceMetrics
        );
      } else if (environmentMetrics) {
        await this.handleEnvironmentMetrics(
          server,
          event,
          key,
          serverTime,
          environmentMetrics
        );
      }
    } catch (error) {
      console.error("Error handling telemetry event:", error.message);
    }
  }

  /**
   * Обрабатывает метрики устройства (СТАРАЯ СХЕМА)
   */
  async handleDeviceMetrics(server, event, key, serverTime, deviceMetrics) {
    let {
      batteryLevel,
      voltage,
      channelUtilization,
      airUtilTx,
      uptimeSeconds,
    } = deviceMetrics;

    // Округляем значения
    batteryLevel = batteryLevel > 100 ? 100 : round(batteryLevel, 0);
    voltage = round(voltage, 3);
    channelUtilization = round(channelUtilization, 1);
    airUtilTx = round(airUtilTx, 3);

    const newMetricsItem = {
      batteryLevel,
      voltage,
      channelUtilization,
      airUtilTx,
      uptimeSeconds,
    };

    if (isValidDeviceMetrics(newMetricsItem)) {
      // Сохраняем в deviceMetrics ключ
      const telemetryKey = `deviceMetrics:${event.from}`;
      await this.redisManager.upsertItem(
        telemetryKey,
        serverTime,
        newMetricsItem
      );

      // Сохраняем в device ключ
      const deviceData = this.createDeviceData(event, {
        variant: {
          case: "deviceMetrics",
          value: newMetricsItem,
        },
      });

      await this.saveToRedis(
        key,
        serverTime,
        deviceData,
        server,
        "deviceMetrics"
      );

      // Обновляем основные метрики в dots ключе
      await this.redisManager.updateDotData(event.from, {
        battery_level: batteryLevel,
        voltage,
        channel_utilization: channelUtilization,
        air_util_tx: airUtilTx,
        uptime_seconds: uptimeSeconds,
      });
    }
  }

  /**
   * Обрабатывает метрики окружения (СТАРАЯ СХЕМА)
   */
  async handleEnvironmentMetrics(
    server,
    event,
    key,
    serverTime,
    environmentMetrics
  ) {
    let {
      temperature,
      relativeHumidity,
      barometricPressure,
      gasResistance,
      voltage,
      current,
    } = environmentMetrics;

    // Округляем значения
    temperature = round(temperature, 1);
    relativeHumidity = round(relativeHumidity, 0);
    barometricPressure = round(barometricPressure, 0);
    gasResistance = round(gasResistance, 0);
    voltage = round(voltage, 2);
    current = round(current, 2);

    const newEnvItem = {
      temperature,
      relativeHumidity,
      barometricPressure,
      gasResistance,
      voltage,
      current,
    };

    if (isValidEnvironmentMetrics(newEnvItem)) {
      // Сохраняем в environmentMetrics ключ
      const telemetryKey = `environmentMetrics:${event.from}`;
      await this.redisManager.upsertItem(telemetryKey, serverTime, newEnvItem);

      // Сохраняем в device ключ
      const deviceData = this.createDeviceData(event, {
        variant: {
          case: "environmentMetrics",
          value: newEnvItem,
        },
      });

      await this.saveToRedis(
        key,
        serverTime,
        deviceData,
        server,
        "environmentMetrics"
      );
    }
  }

  /**
   * Обрабатывает сообщения (СТАРАЯ СХЕМА)
   */
  async handleMessageEvent(server, fullTopic, event, key, serverTime) {
    const messageType = getMessageType(event);

    let messageText = "";
    try {
      if (event.data?.payload) {
        const payloadBuffer = Buffer.from(event.data.payload, "base64");
        messageText = payloadBuffer.toString("utf8");
      }
    } catch (error) {
      console.error("Error decoding message:", error.message);
      return;
    }

    if (messageText && messageText.trim() !== "") {
      // Сохраняем в message ключ
      const messageKey = `message:${event.from}`;
      const messageItem = {
        rxTime: event.packet?.rxTime * 1000 || Date.now(),
        type: messageType,
        rxSnr: event.rxSnr,
        hopLimit: event.hopLimit,
        rxRssi: event.rxRssi,
        gatewayId: event.gatewayId,
        data: messageText,
      };

      await this.redisManager.upsertItem(messageKey, serverTime, messageItem);

      // Сохраняем в device ключ только broadcast сообщения
      if (messageType === "broadcast") {
        const deviceData = this.createDeviceData(event, messageText);
        await this.saveToRedis(key, serverTime, deviceData, server, "message");
      }

      console.log(
        `💬 Сообщение сохранено: "${messageText.substring(0, 50)}${
          messageText.length > 50 ? "..." : ""
        }"`
      );

      // Отправляем в Telegram
      const telegramEvent = {
        ...event,
        type: messageType,
        data: messageText,
      };
      handleTelegramMessage(
        this.redisManager.redis,
        server,
        fullTopic,
        telegramEvent
      );
    }
  }

  /**
   * Обрабатывает информацию о соседях (СТАРАЯ СХЕМА)
   */
  async handleNeighborInfoEvent(server, event, from, serverTime) {
    try {
      if (!event.data?.payload) return;

      const neighborInfoData = this.decodePayload(
        "NeighborInfo",
        event.data.payload
      );
      if (!neighborInfoData) return; // Пропускаем если декодирование не удалось

      const { nodeId, lastSentById, nodeBroadcastIntervalSecs, neighbors } =
        neighborInfoData;

      const processedNeighbors = neighbors
        ? neighbors.map((neighbor) => ({
            nodeId: neighbor.nodeId,
            snr: neighbor.snr ? round(neighbor.snr, 2) : undefined,
            lastRxTime: neighbor.lastRxTime,
            nodeIdStr: neighbor.nodeId
              ? `!${neighbor.nodeId.toString(16).padStart(8, "0")}`
              : undefined,
          }))
        : [];

      const newNeighborInfoItem = {
        nodeId,
        nodeIdStr: nodeId
          ? `!${nodeId.toString(16).padStart(8, "0")}`
          : undefined,
        lastSentById,
        lastSentByIdStr: lastSentById
          ? `!${lastSentById.toString(16).padStart(8, "0")}`
          : undefined,
        nodeBroadcastIntervalSecs,
        neighborsCount: processedNeighbors.length,
        neighbors: processedNeighbors,
      };

      // Сохраняем в neighborInfo ключ
      const neighborInfoKey = `neighborInfo:${from}`;
      await this.redisManager.upsertItem(
        neighborInfoKey,
        serverTime,
        newNeighborInfoItem
      );
    } catch (error) {
      console.error("Error handling neighbor info event:", error.message);
    }
  }

  /**
   * Обрабатывает отчеты карты (СТАРАЯ СХЕМА)
   */
  async handleMapReportEvent(server, event, from, serverTime) {
    try {
      // Данные уже декодированы в protobufDecoder.mjs
      const mapReportData = event.data?.decoded;

      if (mapReportData) {
        const {
          longName,
          shortName,
          role,
          hwModel,
          firmwareVersion,
          region,
          modemPreset,
          hasDefaultChannel,
          latitudeI,
          longitudeI,
          altitude,
          positionPrecision,
          numOnlineLocalNodes,
        } = mapReportData;

        const newMapReportItem = {
          longName,
          shortName,
          role,
          hwModel,
          firmwareVersion,
          region,
          modemPreset,
          hasDefaultChannel,
          latitude: latitudeI ? round(latitudeI / 1e7, 6) : undefined,
          longitude: longitudeI ? round(longitudeI / 1e7, 6) : undefined,
          altitude: altitude ? round(altitude, 0) : undefined,
          positionPrecision,
          numOnlineLocalNodes,
        };

        // Сохраняем в mapReport ключ
        const mapReportKey = `mapReport:${from}`;
        await this.redisManager.upsertItem(
          mapReportKey,
          serverTime,
          newMapReportItem
        );
      }
    } catch (error) {
      console.error("Error handling map report event:", error.message);
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
      return null;
    }

    // Проверяем размер зашифрованных данных
    if (packet.encrypted.length === 0 || packet.encrypted.length > 65536) {
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
   * Возвращает статистику приложения
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    const mqttStats = this.mqttManager.getConnectionStats();
    const cacheStats = this.redisManager.getCacheStats();

    return {
      uptime,
      messages: {
        processed: this.stats.messagesProcessed,
        errors: this.stats.errorsCount,
        rate: this.stats.messagesProcessed / (uptime / 1000), // сообщений в секунду
      },
      mqtt: mqttStats,
      cache: cacheStats,
      memory: process.memoryUsage(),
    };
  }

  /**
   * Корректное отключение
   */
  async disconnect() {
    console.log("👋 Отключение от всех сервисов...");

    try {
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
    } catch (error) {}
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
    console.log(`\n👋 Получен сигнал ${signal}, завершение работы...`);

    // Выводим статистику
    const stats = client.getStats();
    console.log(`📊 Статистика работы:`);
    console.log(`  📨 Обработано сообщений: ${stats.messages.processed}`);
    console.log(`  ❌ Ошибок: ${stats.messages.errors}`);
    console.log(`  ⏱️ Время работы: ${Math.round(stats.uptime / 1000)}с`);
    console.log(
      `  🌐 MQTT подключений: ${stats.mqtt.connected}/${stats.mqtt.total}`
    );

    await client.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  // Запускаем клиент
  await client.init();

  // Периодический вывод статистики
  setInterval(() => {
    const stats = client.getStats();
    console.log(
      `📊 Статистика: ${
        stats.messages.processed
      } сообщений, ${stats.messages.rate.toFixed(2)} сообщений/с`
    );
  }, 300000); // Каждые 5 минут
}

// Запускаем только если файл запущен напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default MeshtasticRedisClient;
