import fs from "fs";
import crypto from "crypto";
import path from "path";
import protobufjs from "protobufjs";

// Импортируем модули
import {
  servers,
  redisConfig,
  mqttReceiverConfig,
  botSettings,
} from "../config.mjs";
import { MQTTManager } from "./mqtt.mjs";
import { RedisManager } from "./shared/redisManager.mjs";
import { ProtobufDecoder } from "./protobufDecoder.mjs";
import { MessageQueue } from "./shared/messageQueue.mjs";
import { decodeMeshcoreRaw, decodeAdvertPacket } from "./meshcoreParser.mjs";
import {
  shouldLogError,
  bufferToHex,
  formatMacAddress,
  round,
  isValidDeviceMetrics,
  isValidEnvironmentMetrics,
  getMessageType,
  isValidMessage,
  isValidPacket,
  getPortnumName,
  isValidUserName,
  CONSTANTS,
} from "./utils.mjs";
import {
  isValidPacket as isValidPacketOptimized,
  isValidUserName as isValidUserNameOptimized,
} from "./shared/validators.mjs";
import {
  initializeTelegramBot,
  handleTelegramMessage,
  cleanupTelegramResources,
  sendPersonalMessage,
} from "./telegram.mjs";

const {
  MAX_METADATA_ITEMS_COUNT,
  DEVICE_EXPIRY_TIME,
  DECRYPTION_KEYS,
  PROTOBUFS_PATH,
} = CONSTANTS;

/**
 * MQTT Receiver - сервис для приема данных по MQTT и сохранения в Redis
 */
class MqttReceiver {
  constructor() {
    this.mqttManager = new MQTTManager();
    this.redisManager = null;
    this.protoTypes = {};
    this.protobufDecoder = new ProtobufDecoder();
    // Инициализируем очередь для асинхронной обработки сообщений
    this.messageQueue = new MessageQueue({ concurrency: 10 });
    this._setupMessageQueueHandlers();
  }

  /**
   * Настраивает обработчики для очереди сообщений
   */
  _setupMessageQueueHandlers() {
    // Обработчик для всех типов сообщений
    this.messageQueue.addHandler("default", async (data) => {
      return await this.processEventInternal(
        data.server,
        data.fullTopic,
        data.user,
        data.eventName,
        data.eventType,
        data.event
      );
    });
  }

  /**
   * Инициализация сервиса
   */
  async init() {
    try {
      console.log("🚀 [MQTT-Receiver] Инициализация MQTT Receiver...");

      // Проверяем protobufs
      this.checkProtobufs();

      // Загружаем protobuf схемы
      await this.loadProtobufs();

      // Инициализируем Redis (только для записи)
      await this.initializeRedis();

      // Инициализируем Telegram бота
      await this.initializeTelegram();

      // Инициализируем MQTT
      await this.initializeMqtt();

      console.log("✅ [MQTT-Receiver] Инициализация завершена успешно!");
    } catch (error) {
      console.error("❌ [MQTT-Receiver] Ошибка инициализации:", error);
      process.exit(1);
    }
  }

  /**
   * Проверяет наличие protobuf файлов
   */
  checkProtobufs() {
    // Путь к protobufs относительно корня проекта
    const protobufPath = path.join(
      process.cwd(),
      "protobufs",
      "meshtastic/mqtt.proto"
    );
    console.log(`Проверяю protobufs по пути: ${protobufPath}`);
    console.log(`Текущая директория: ${process.cwd()}`);
    if (!fs.existsSync(protobufPath)) {
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
      root.resolvePath = (origin, target) =>
        path.join(process.cwd(), "protobufs", target);
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

      console.log("✅ [MQTT-Receiver] Protobuf схемы успешно загружены");
    } catch (error) {
      console.error("❌ [MQTT-Receiver] Ошибка загрузки protobuf схем:", error);
      throw error;
    }
  }

  /**
   * Инициализирует Redis Manager (только для записи)
   */
  async initializeRedis() {
    const retryDelay = 10000; // 10 секунд между попытками
    let attempt = 0;

    console.log("🔄 [MQTT-Receiver] Подключение к Redis...");

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

        this.redisManager = new RedisManager(redisConfig, "MQTT-Receiver");
        await this.redisManager.ping();

        console.log(
          `✅ [MQTT-Receiver] Redis подключен и настроен (попытка ${attempt})`
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
              `⏳ [MQTT-Receiver] Redis загружает данные в память, ожидание готовности...`
            );
          }
          // Логируем каждые 6 попыток (каждую минуту)
          if (attempt % 6 === 0) {
            console.log(
              `⏳ [MQTT-Receiver] Все еще ожидание загрузки Redis... (попытка ${attempt}, прошло ~${Math.round(
                (attempt * retryDelay) / 60000
              )} минут)`
            );
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue; // Пробуем снова
        }

        // Если это не ошибка загрузки, логируем и пробуем снова
        console.error(
          `❌ [MQTT-Receiver] Ошибка подключения к Redis (попытка ${attempt}):`,
          error.message
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue; // Пробуем снова
      }
    }
  }

  /**
   * Инициализирует Telegram бота
   */
  async initializeTelegram() {
    if (botSettings.ENABLE) {
      console.log("🤖 [MQTT-Receiver] Инициализация Telegram бота...");
      initializeTelegramBot(this.redisManager);
      console.log("✅ [MQTT-Receiver] Telegram бот инициализирован успешно");
    } else {
      console.log(
        "🚫 [MQTT-Receiver] Telegram бот отключен (TELEGRAM_ENABLED=false)"
      );
    }
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
      `✅ [MQTT-Receiver] MQTT подключения установлены: ${result.successful}/${result.total}`
    );
  }

  /**
   * Обрабатывает входящие MQTT сообщения
   */
  handleMessage(server, topic, payload) {
    try {
      // Парсим топик
      const topicParts = topic.split("/");
      
      if (topicParts.length < 3) {
        console.log(
          `⚠️ [MQTT-Receiver] [${server.name}] Неверный формат топика: ${topic}`
        );
        return;
      }

      // Проверяем, является ли это пакетом от meshcore
      // Формат: meshcore/<region>/<gateway_id>/packets
      // topicParts[0] = "meshcore", topicParts[last] = "packets"
      if (topicParts[0] === "meshcore" && topicParts[topicParts.length - 1] === "packets") {
        // Формат: meshcore/<region>/<gateway_id>/packets
        console.log(
          `🔍 [MQTT-Receiver] [${server.name}] Топик: ${topic}, части: [${topicParts.join(", ")}]`
        );
        console.log(
          `📨 [MQTT-Receiver] [${server.name}] Получен meshcore пакет из топика: ${topic}`
        );
        // Вызываем асинхронно, не блокируя обработку других сообщений
        this.handleMeshcoreJsonMessage(server, topic, payload).catch((error) => {
          console.error(
            `❌ [MQTT-Receiver] [${server.name}] Ошибка обработки meshcore:`,
            error.message,
            error.stack
          );
        });
        return;
      }

      const [, , type, channel, user] = topicParts;

      // Пропускаем статусные сообщения
      if (type === "stat") {
        return;
      }

      // Обрабатываем JSON сообщения
      if (type === "json") {
        this.handleJsonMessage(server, topic, user, payload);
        return;
      }

      // Обрабатываем protobuf сообщения
      if (payload && payload.length > 0) {
        this.handleProtobufMessage(
          server,
          topic,
          user,
          new Uint8Array(payload)
        );
      }
    } catch (error) {
      if (shouldLogError(error.message)) {
        console.error(
          `❌ [MQTT-Receiver] [${server.name}] Ошибка обработки сообщения:`,
          error.message
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
      this.processEvent(server, topic, user, "json", "json", jsonData);
    } catch (parseError) {
      console.error(
        `❌ [MQTT-Receiver] [${server.name}] Ошибка парсинга JSON:`,
        parseError.message
      );
    }
  }

  /**
   * Обрабатывает JSON сообщения от meshcore
   */
  async handleMeshcoreJsonMessage(server, topic, payload) {
    try {
      console.log(
        `🔍 [MQTT-Receiver] [${server.name}] Начало обработки meshcore пакета`
      );
      
      const payloadString = payload.toString();
      console.log(
        `📄 [MQTT-Receiver] [${server.name}] Payload длина: ${payloadString.length}`
      );
      
      const jsonData = JSON.parse(payloadString);
      console.log(
        `✅ [MQTT-Receiver] [${server.name}] JSON распарсен, origin_id: ${jsonData.origin_id || "отсутствует"}`
      );
      
      // Извлекаем базовые данные из JSON
      const origin = jsonData.origin || "";
      const originId = jsonData.origin_id || "";
      // s_time всегда устанавливается как время сервера в методе saveMeshcoreDot (по аналогии с meshtastic данными)

      if (!originId) {
        console.log(`⚠️ [MQTT-Receiver] [${server.name}] Нет origin_id в пакете meshcore`);
        return;
      }

      console.log(
        `📊 [MQTT-Receiver] [${server.name}] Извлечены данные: origin=${origin}, origin_id=${originId}`
      );

      // Инициализируем данные для сохранения устройства
      let deviceId = null; // ID устройства (public_key из ADVERT)
      let lat = null;
      let lon = null;
      let name = null;

      // Если есть raw данные, декодируем как MeshCore пакет (не protobuf!)
      if (jsonData.raw) {
        try {
          // Декодируем MeshCore пакет
          const meshcorePacket = decodeMeshcoreRaw(jsonData.raw);
          
          if (meshcorePacket) {
            console.log(
              `📦 [MQTT-Receiver] [${server.name}] MeshCore пакет: тип=${meshcorePacket.header.payloadType}, маршрут=${meshcorePacket.header.routeType}`
            );
            
            // Если это ADVERT пакет, декодируем его полностью
            if (meshcorePacket.header.payloadType === "ADVERT") {
              const advertPacket = decodeAdvertPacket(jsonData.raw);
              
              if (advertPacket && advertPacket.advertData) {
                const advertData = advertPacket.advertData;
                
                // Извлекаем ID устройства (public_key) - это основной идентификатор
                if (advertData.publicKey) {
                  deviceId = advertData.publicKey;
                  console.log(
                    `🔑 [MQTT-Receiver] [${server.name}] ID устройства (public_key): ${deviceId}`
                  );
                }
                
                // Извлекаем координаты из ADVERT
                if (advertData.lat !== undefined && advertData.lon !== undefined) {
                  lat = advertData.lat;
                  lon = advertData.lon;
                  console.log(
                    `📍 [MQTT-Receiver] [${server.name}] Координаты из ADVERT: lat=${lat}, lon=${lon}`
                  );
                }
                
                // Извлекаем имя из ADVERT
                if (advertData.name) {
                  name = advertData.name;
                  console.log(
                    `👤 [MQTT-Receiver] [${server.name}] Имя из ADVERT: ${name}`
                  );
                }
              }
            }
          } else {
            console.log(
              `⚠️ [MQTT-Receiver] [${server.name}] Не удалось декодировать MeshCore пакет`
            );
          }
        } catch (decodeError) {
          // Если не удалось декодировать, не сохраняем данные устройства
          console.log(
            `⚠️ [MQTT-Receiver] [${server.name}] Ошибка декодирования MeshCore пакета:`,
            decodeError.message
          );
        }
      }

      // Сохраняем данные устройства только если есть ID устройства (public_key)
      if (!deviceId) {
        console.log(
          `⚠️ [MQTT-Receiver] [${server.name}] Нет ID устройства (public_key) из ADVERT, пропускаем сохранение. Шлюз: origin=${origin}, origin_id=${originId}`
        );
        return;
      }

      // Сохраняем данные устройства: ID устройства, координаты, имя, информация о шлюзе
      // s_time всегда устанавливается как время сервера в методе saveMeshcoreDot
      const deviceData = {
        device_id: deviceId, // ID устройства из ADVERT (public_key)
        lat,
        lon,
        name: name || null,
        gateway_origin: origin, // Информация о шлюзе (через какой шлюз получены данные)
        gateway_origin_id: originId, // ID шлюза
      };

      console.log(
        `💾 [MQTT-Receiver] [${server.name}] Сохранение данных устройства в Redis для ${deviceId} (шлюз: ${origin})...`
      );

      await this.redisManager.saveMeshcoreDot(deviceId, deviceData);

      // Логируем для отладки
      const serverTime = Date.now();
      console.log(
        `✅ [MQTT-Receiver] [${server.name}] Сохранены данные устройства для ${deviceId}:`,
        JSON.stringify({
          device_id: deviceId,
          name: name || null,
          lat: lat !== null ? lat.toFixed(7) : null,
          lon: lon !== null ? lon.toFixed(7) : null,
          gateway: { origin, origin_id: originId },
          s_time: new Date(serverTime).toISOString(),
        })
      );
    } catch (parseError) {
      console.error(
        `❌ [MQTT-Receiver] [${server.name}] Ошибка парсинга meshcore JSON:`,
        parseError.message,
        parseError.stack
      );
    }
  }

  /**
   * Обрабатывает protobuf сообщения
   */
  handleProtobufMessage(server, fullTopic, user, arrayBuffer) {
    try {
      // Валидация пакета (используем оптимизированную версию)
      if (!isValidPacketOptimized(arrayBuffer)) {
        arrayBuffer = null;
        return;
      }

      // Ограничения размера
      if (arrayBuffer.length > 524288) {
        console.log(
          `❌ [MQTT-Receiver] [${server.name}] Пакет слишком большой: ${arrayBuffer.length} байт от ${user}`
        );
        arrayBuffer = null;
        return;
      }

      if (arrayBuffer.length < 10) {
        arrayBuffer = null;
        return;
      }

      let serviceEnvelope;
      try {
        serviceEnvelope = this.protoTypes.ServiceEnvelope.decode(arrayBuffer);
      } catch (decodeError) {
        if (shouldLogError(decodeError.message)) {
          console.error(
            `❌ [MQTT-Receiver] Ошибка декодирования ServiceEnvelope: ${decodeError.message}`
          );
        }
        return;
      }

      if (!serviceEnvelope?.packet) {
        return;
      }

      const meshPacket = serviceEnvelope.packet;
      const { channelId, gatewayId } = serviceEnvelope;

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
      }
    } catch (error) {
      console.error(
        `❌ [MQTT-Receiver] Ошибка обработки protobuf:`,
        error.message
      );
    } finally {
      arrayBuffer = null;
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
    const decrypted = this.decrypt(meshPacket);
    if (decrypted) {
      const event = this.createEvent(
        server,
        fullTopic,
        user,
        meshPacket,
        gatewayId,
        decrypted
      );
      const eventType = this.getEventTypeByPortnum(decrypted.portnum);

      if (eventType) {
        this.processEvent(server, fullTopic, user, "decoded", eventType, event);
      }
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
      to: meshPacket.to,
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
   * Основная функция обработки событий (добавляет в очередь)
   */
  async processEvent(server, fullTopic, user, eventName, eventType, event) {
    // Добавляем сообщение в очередь для асинхронной обработки
    try {
      await this.messageQueue.enqueue("default", {
        server,
        fullTopic,
        user,
        eventName,
        eventType,
        event,
      });
    } catch (error) {
      console.error(
        "❌ [MQTT-Receiver] Ошибка добавления в очередь:",
        error.message
      );
    }
  }

  /**
   * Внутренняя функция обработки событий (вызывается из очереди)
   */
  async processEventInternal(
    server,
    fullTopic,
    user,
    eventName,
    eventType,
    event
  ) {
    try {
      const { from } = event;
      if (!from) {
        return;
      }

      // Обновляем время последней активности для карты
      await this.updateDotActivityTime(from, event, server);

      let dataToSave = event.data;

      // Сохраняем все расшифрованные сообщения по portnum
      if (event.data?.portnum) {
        // Декодируем payload если он есть
        if (event.data.payload) {
          try {
            const payloadBuffer = Buffer.from(event.data.payload, "base64");
            const decodedPayload = this.protobufDecoder.decodePayload(
              event.data.portnum,
              payloadBuffer
            );

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

      // Обрабатываем Telegram сообщения для текстовых сообщений
      if (
        eventType === "message" &&
        event.data?.portnum === 1 &&
        botSettings.ENABLE
      ) {
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
      console.error(
        "❌ [MQTT-Receiver] Ошибка обработки события:",
        error.message
      );
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
      if (portnum === 4 || portnum === "NODEINFO_APP") {
        // Данные пользователя
        const longName = decodedData.long_name || decodedData.longName;
        const shortName = decodedData.short_name || decodedData.shortName;

        const validLongName =
          longName && isValidUserNameOptimized(longName) ? longName : "";
        const validShortName =
          shortName && isValidUserNameOptimized(shortName) ? shortName : "";

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
        `[MQTT-Receiver] Error updating dot data from portnum ${portnum} (${portnumName}):`,
        error.message
      );
    }
  }

  /**
   * Обновляет время активности для карты
   */
  async updateDotActivityTime(from, event, server) {
    try {
      await this.redisManager.updateDotData(from, {});
    } catch (error) {
      console.error(
        "[MQTT-Receiver] Error updating dot activity time:",
        error.message
      );
    }
  }

  /**
   * Расшифровывает пакет
   */
  decrypt(packet) {
    if (!packet?.encrypted || !packet.id || !packet.from) {
      return null;
    }

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

        if (decryptedBuffer.length === 0 || decryptedBuffer.length > 65536) {
          continue;
        }

        try {
          return this.protoTypes.Data.decode(decryptedBuffer);
        } catch (decodeError) {
          continue;
        }
      } catch (e) {
        // Пробуем следующий ключ
      }
    }

    return null;
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
   * Получает название portnum по номеру
   */
  getPortnumName(portnum) {
    return getPortnumName(portnum) || `UNKNOWN_${portnum}`;
  }

  /**
   * Корректное отключение
   */
  async disconnect() {
    console.log("👋 [MQTT-Receiver] Отключение от всех сервисов...");

    try {
      if (this.performanceInterval) {
        clearInterval(this.performanceInterval);
        console.log(
          "✅ [MQTT-Receiver] Интервал мониторинга производительности остановлен"
        );
      }

      // Ожидаем завершения обработки всех сообщений в очереди
      await this.messageQueue.drain();

      await this.mqttManager.disconnect();

      if (this.redisManager) {
        await this.redisManager.disconnect();
      }

      // Очищаем ресурсы Telegram
      cleanupTelegramResources();

      this.protoTypes = {};
    } catch (error) {
      console.error("[MQTT-Receiver] Ошибка при отключении:", error);
    }
  }
}

/**
 * Главная функция запуска приложения
 */
async function main() {
  console.log("🚀 [MQTT-Receiver] Запуск MQTT Receiver сервиса...");

  console.log(`📡 Подключение к ${servers.length} серверам:`);
  servers.forEach((server) => {
    console.log(`  🌐 ${server.name} (${server.address})`);
  });

  const receiver = new MqttReceiver();

  // Обработка сигналов для корректного завершения
  const gracefulShutdown = async (signal) => {
    console.log(
      `\n👋 [MQTT-Receiver] Получен сигнал ${signal}, завершение работы...`
    );
    await receiver.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  // Обработка необработанных исключений
  process.on("uncaughtException", (error) => {
    console.error("🚨 [MQTT-Receiver] НЕОБРАБОТАННОЕ ИСКЛЮЧЕНИЕ:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error(
      "🚨 [MQTT-Receiver] НЕОБРАБОТАННОЕ ОТКЛОНЕНИЕ PROMISE:",
      reason
    );
  });

  // Запускаем приемник
  await receiver.init();

  // Отправляем сообщение о запуске сервера пользователю с ID 14259
  try {
    const startupMessage =
      `🚀` +
      `${new Date().toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
      })}\n`;

    await sendPersonalMessage(14259, startupMessage);
  } catch (error) {
    console.error("❌ Ошибка отправки сообщения о запуске:", error.message);
  }
}

// Запускаем только если файл запущен напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("❌ [MQTT-Receiver] Критическая ошибка в main():");
    console.error("  💬 Сообщение:", error.message);
    console.error("  📊 Stack trace:", error.stack);
    process.exit(1);
  });
}

export default MqttReceiver;
