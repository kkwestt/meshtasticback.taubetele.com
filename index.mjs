import fs from "fs";
import crypto from "crypto";
import path from "path";
import protobufjs from "protobufjs";
import Redis from "ioredis";
import express from "express";
import compression from "compression";
import cors from "cors";

// Импортируем конфигурацию и MQTT менеджер
import { servers, redisConfig } from "./config.mjs";
import { MQTTManager } from "./mqtt.mjs";
import { handleTelegramMessage, initializeTelegramBot } from "./telegram.mjs";

const PROTOBUFS_PATH = "./protobufs";

// Ключи расшифровки
const DECRYPTION_KEYS = ["1PG7OiApB1nwvP+rz05pAQ==", "AQ=="];

// Константы
const MAX_METADATA_ITEMS_COUNT = 200;
const CACHE_REFRESH_INTERVAL = 5000;
const DEVICE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours

// Функция для конвертации Buffer в hex строку
const bufferToHex = (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  return buffer.toString("hex").toUpperCase();
};

// Функция для форматирования MAC адреса
const formatMacAddress = (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  return buffer.toString("hex").toUpperCase().match(/.{2}/g).join(":");
};

// Функция для фильтрации ошибок
const shouldLogError = (errorMessage) => {
  const suppressedErrors = [
    "undefined",
    "illegal tag",
    "Error received for packet",
    "NO_RESPONSE",
    "TIMEOUT",
    "NO_INTERFACE",
    "MAX_RETRANSMIT",
    "NO_CHANNEL",
    "TOO_LARGE",
    "NO_ACK",
    "NOT_AUTHORIZED",
    "invalid wire type",
    "index out of range",
  ];
  return !suppressedErrors.some((error) => errorMessage.includes(error));
};

// Валидация пакетов
const isValidPacket = (arrayBuffer) => {
  if (!arrayBuffer || arrayBuffer.length === 0) return false;
  if (arrayBuffer.length < 4) return false;
  try {
    const view = new DataView(arrayBuffer.buffer || arrayBuffer);
    const firstByte = view.getUint8(0);
    return firstByte >= 0x08 && firstByte <= 0x78;
  } catch {
    return false;
  }
};

// Функция округления
const round = (num, decimalPlaces = 0) => {
  if (typeof num !== "number" || isNaN(num)) return 0;
  const factor = Math.pow(10, decimalPlaces);
  return Math.round(num * factor) / factor;
};

// Функция проверки валидности deviceMetrics
const isValidDeviceMetrics = (metrics) => {
  const { batteryLevel, voltage, channelUtilization, airUtilTx } = metrics;

  const hasValidBattery =
    batteryLevel !== undefined && batteryLevel !== null && batteryLevel >= 0;
  const hasValidVoltage =
    voltage !== undefined && voltage !== null && !isNaN(voltage);
  const hasValidChannelUtil =
    channelUtilization !== undefined &&
    channelUtilization !== null &&
    channelUtilization >= 0;
  const hasValidAirUtil =
    airUtilTx !== undefined && airUtilTx !== null && airUtilTx >= 0;

  return (
    hasValidBattery || hasValidVoltage || hasValidChannelUtil || hasValidAirUtil
  );
};

// Функция проверки валидности environmentMetrics
const isValidEnvironmentMetrics = (metrics) => {
  const {
    temperature,
    relativeHumidity,
    barometricPressure,
    gasResistance,
    voltage,
    current,
  } = metrics;

  const hasValidTemp =
    temperature !== undefined && temperature !== null && temperature !== 0;
  const hasValidHumidity = relativeHumidity && relativeHumidity > 0;
  const hasValidPressure = barometricPressure && barometricPressure > 0;
  const hasValidGas = gasResistance && gasResistance > 0;
  const hasValidVoltage = voltage && voltage > 0;
  const hasValidCurrent = current && current > 0;

  return (
    hasValidTemp ||
    hasValidHumidity ||
    hasValidPressure ||
    hasValidGas ||
    hasValidVoltage ||
    hasValidCurrent
  );
};

// Функция проверки валидности сообщения
const isValidMessage = (event) => {
  // Проверяем portnum - должен быть TEXT_MESSAGE_APP (1)
  if (event.data?.portnum !== "TEXT_MESSAGE_APP" && event.data?.portnum !== 1) {
    return false;
  }

  // Проверяем, что есть текст сообщения
  if (!event.data?.payload && !event.data?.text) {
    return false;
  }

  // Пропускаем приватные сообщения (direct)
  if (event.type === "direct") {
    return false;
  }

  return true;
};

// ИСПРАВЛЕННАЯ функция определения типа сообщения
const getMessageType = (event) => {
  // Если сообщение адресовано всем (broadcast) - to = 0xffff (4294967295)
  if (
    !event.packet?.to ||
    event.packet.to === 0xffff ||
    event.packet.to === 4294967295
  ) {
    return "broadcast";
  }

  // Иначе это direct (приватное сообщение)
  return "direct";
};

class MeshtasticRedisClient {
  constructor() {
    this.mqttManager = new MQTTManager();
    this.protoTypes = {};
    this.redis = null;
    this.app = null;
    this.cachedKeys = [];
    this.cachedValues = [];
    this.isQuerying = false;
  }

  async init() {
    try {
      this.checkProtobufs();
      await this.loadProtobufs();
      await this.connectToRedis();
      this.setupHttpServer();

      // Инициализируем Telegram бот с обработчиками команд
      initializeTelegramBot(this.redis);

      // Устанавливаем обработчик сообщений для MQTT менеджера
      this.mqttManager.setMessageHandler((server, topic, payload) => {
        this.handleMessage(server, topic, payload);
      });

      await this.mqttManager.connectToAllServers(servers);
    } catch (error) {
      console.error("❌ Ошибка инициализации:", error);
      process.exit(1);
    }
  }

  async connectToRedis() {
    try {
      this.redis = new Redis(redisConfig);

      this.redis.on("error", (err) =>
        console.error("Redis Client Error:", err)
      );
      this.redis.on("connect", () => console.log("✅ Connected to Redis"));
      this.redis.on("reconnecting", () =>
        console.log("🔄 Reconnecting to Redis...")
      );

      // Проверяем подключение
      await this.redis.ping();
      console.log("✅ Redis connection established");
    } catch (error) {
      console.error("❌ Failed to connect to Redis:", error.message);
      process.exit(1);
    }
  }

  setupHttpServer() {
    this.app = express();

    this.app.use(compression());
    this.app.use(
      cors({
        origin: (origin, callback) => callback(null, origin || "*"),
        allowedHeaders: ["Content-Type"],
      })
    );

    // Запускаем периодическое обновление кэша
    this.queryData();
    setInterval(() => this.queryData(), CACHE_REFRESH_INTERVAL);

    // API endpoints
    this.setupRoutes();

    const PORT = process.env.PORT || 80;
    this.app.listen(PORT, () => {
      console.log(`🌐 HTTP Server running on port ${PORT}`);
    });
  }

  setupRoutes() {
    // GPS данные для устройства
    this.app.get("/gps:from", async (req, res) => {
      try {
        const from = req.params.from.substring(1);
        const data = await this.queryMetadata(from, "gps");
        res.json({ from, data });
      } catch (error) {
        console.error("GPS endpoint error:", error.message);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Device metrics для устройства
    this.app.get("/deviceMetrics:from", async (req, res) => {
      try {
        const from = req.params.from.substring(1);
        const data = await this.queryMetadata(from, "deviceMetrics");
        res.json({ from, data });
      } catch (error) {
        console.error("Device metrics endpoint error:", error.message);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Environment metrics для устройства
    this.app.get("/environmentMetrics:from", async (req, res) => {
      try {
        const from = req.params.from.substring(1);
        const data = await this.queryMetadata(from, "environmentMetrics");
        res.json({ from, data });
      } catch (error) {
        console.error("Environment metrics endpoint error:", error.message);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // ДОБАВЛЕН /api endpoint как в оригинале
    this.app.get("/api", async (req, res) => {
      try {
        if (!this.cachedKeys || this.cachedKeys.length === 0) {
          await this.queryData();
        }

        if (!this.cachedKeys || !this.cachedValues) {
          return res.json({});
        }

        const result = this.cachedKeys.reduce((result, key, index) => {
          if (!this.cachedValues[index]) return result;

          const { server, timestamp, ...rest } = this.cachedValues[index];
          const isExpired =
            Date.now() - new Date(timestamp).getTime() >= DEVICE_EXPIRY_TIME;

          if (isExpired) return result;

          const data = { server, timestamp };
          Object.entries(rest).forEach(([key, value]) => {
            try {
              data[key] = JSON.parse(value);
            } catch {
              data[key] = value;
            }
          });

          const from = key.substr(7); // Remove "device:" prefix
          result[from] = data;
          return result;
        }, {});

        res.json(result);
      } catch (error) {
        console.error("API endpoint error:", error.message);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Главный endpoint - все данные устройств (БЕЗ фильтрации устаревших как в оригинале)
    this.app.get("/", async (req, res) => {
      try {
        if (!this.cachedKeys || this.cachedKeys.length === 0) {
          await this.queryData();
        }

        if (!this.cachedKeys || !this.cachedValues) {
          return res.json({});
        }

        const result = this.cachedKeys.reduce((result, key, index) => {
          if (!this.cachedValues[index]) return result;

          const { server, timestamp, ...rest } = this.cachedValues[index];
          const data = { server, timestamp };
          Object.entries(rest).forEach(([key, value]) => {
            try {
              data[key] = JSON.parse(value);
            } catch {
              data[key] = value;
            }
          });

          const from = key.substr(7); // Remove "device:" prefix
          result[from] = data;
          return result;
        }, {});

        res.json(result);
      } catch (error) {
        console.error("Root endpoint error:", error.message);
        res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  async queryData() {
    if (this.isQuerying) return;
    this.isQuerying = true;

    try {
      const keys = await this.redis.keys("device:*");
      const values = await Promise.all(
        keys.map(async (key) => {
          try {
            return await this.redis.hgetall(key);
          } catch (error) {
            console.error(`Error getting data for key ${key}:`, error.message);
            return null;
          }
        })
      );

      this.cachedKeys = keys || [];
      this.cachedValues = values.filter(Boolean) || [];
    } catch (error) {
      console.error("Error querying data:", error.message);
      this.cachedKeys = [];
      this.cachedValues = [];
    } finally {
      this.isQuerying = false;
    }
  }

  async queryMetadata(from, type) {
    try {
      const data = await this.redis.lrange(
        `${type}:${from}`,
        0,
        MAX_METADATA_ITEMS_COUNT
      );
      return data
        .map((item) => {
          try {
            return JSON.parse(item);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      console.error(
        `Error querying metadata for ${type}:${from}:`,
        error.message
      );
      return [];
    }
  }

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

      console.log("✅ Protobuf схемы успешно загружены");
    } catch (error) {
      console.error("❌ Ошибка загрузки protobuf схем:", error);
      throw error;
    }
  }

  // Функция upsertItem с ограничением записей
  async upsertItem(key, serverTime, newItem) {
    try {
      const res = await this.redis.lrange(key, -1, -1);
      const [lastItemStr] = res;
      const isNewItem = !lastItemStr;
      let isUpdated = false;

      if (!isNewItem) {
        try {
          const { time, ...lastPosItem } = JSON.parse(lastItemStr);
          const diff = Object.keys(newItem).filter((key) => {
            const aValue = newItem[key];
            const bValue = lastPosItem[key];
            if (typeof aValue === "number" && typeof bValue === "number") {
              return aValue.toFixed(5) !== bValue.toFixed(5);
            }
            return JSON.stringify(aValue) !== JSON.stringify(bValue);
          });
          isUpdated = diff.length > 0;
        } catch (error) {
          console.error("Error parsing last item:", error.message);
          isUpdated = true;
        }
      }

      if (isNewItem || isUpdated) {
        const length = await this.redis.rpush(
          key,
          JSON.stringify({ time: serverTime, ...newItem })
        );

        // Ограничиваем количество записей для всех ключей кроме device:*
        if (!key.startsWith("device:") && length > MAX_METADATA_ITEMS_COUNT) {
          const diff = length - MAX_METADATA_ITEMS_COUNT;
          await this.redis.ltrim(key, diff, length);
          console.log(
            `🗑️ Обрезали ${key} до ${MAX_METADATA_ITEMS_COUNT} записей`
          );
        }
      }
    } catch (error) {
      console.error("Error upserting item:", error.message);
    }
  }

  // Определение типа события по portnum
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
      default:
        return null;
    }
  }

  handleMessage(server, topic, payload) {
    try {
      console.log("=".repeat(50));
      console.log(`📨 [${server.name}] Получено сообщение на топик: ${topic}`);

      // Парсим топик
      const topicParts = topic.split("/");
      if (topicParts.length < 3) {
        console.log(`⚠️ Неверный формат топика: ${topic}`);
        return;
      }

      const [, , type, channel, user] = topicParts;
      console.log(`📋 Тип: ${type}, Канал: ${channel}, Пользователь: ${user}`);

      // Пропускаем статусные сообщения
      if (type === "stat") {
        console.log(`📊 Пропускаем статусное сообщение`);
        return;
      }

      // Обрабатываем JSON сообщения
      if (type === "json") {
        try {
          const jsonData = JSON.parse(payload.toString());
          console.log(`📄 JSON данные:`, jsonData);
          this.processEvent(server, topic, user, "json", "json", jsonData);
          return;
        } catch (parseError) {
          console.error(
            `❌ [${server.name}] Ошибка парсинга JSON:`,
            parseError.message
          );
        }
        return;
      }

      // Обрабатываем protobuf сообщения
      if (payload && payload.length > 0) {
        console.log(
          `🔧 Обрабатываем protobuf сообщение, размер: ${payload.length} байт`
        );
        this.handleProtobufServiceEnvelopePacket(
          server,
          topic,
          user,
          new Uint8Array(payload)
        );
      } else {
        console.log(`⚠️ Пустой payload`);
      }
    } catch (error) {
      console.error(
        `❌ [${server.name}] Ошибка обработки сообщения:`,
        error.message
      );
    }
  }

  handleProtobufServiceEnvelopePacket(server, fullTopic, user, arrayBuffer) {
    try {
      console.log(`🔍 Декодируем ServiceEnvelope...`);

      // Валидация пакета
      if (!isValidPacket(arrayBuffer)) {
        console.log(`❌ Невалидный пакет`);
        return;
      }

      const serviceEnvelope =
        this.protoTypes.ServiceEnvelope.decode(arrayBuffer);
      console.log(`✅ ServiceEnvelope декодирован`);

      if (!serviceEnvelope?.packet) {
        console.log(`❌ Нет пакета в ServiceEnvelope`);
        return;
      }

      const meshPacket = serviceEnvelope.packet;
      const { channelId, gatewayId } = serviceEnvelope;

      console.log(`📦 MeshPacket от ${meshPacket.from}, ID: ${meshPacket.id}`);

      // Проверяем наличие decoded данных
      if (meshPacket.decoded) {
        console.log(
          `🔓 Найдены decoded данные, portnum: ${meshPacket.decoded.portnum}`
        );

        // Создаем событие
        const event = {
          mqttChannel: fullTopic,
          mqttUser: user,
          rxSnr: meshPacket.rxSnr,
          hopLimit: meshPacket.hopLimit,
          wantAck: meshPacket.wantAck,
          rxRssi: meshPacket.rxRssi,
          gatewayId,
          from: meshPacket.from,
          id: meshPacket.id,
          data: meshPacket.decoded,
          packet: meshPacket,
        };

        // Определяем тип по portnum
        const eventType = this.getEventTypeByPortnum(
          meshPacket.decoded.portnum
        );
        console.log(`🎯 Тип события по portnum: ${eventType}`);

        if (eventType) {
          this.processEvent(
            server,
            fullTopic,
            user,
            "decoded",
            eventType,
            event
          );
        } else {
          console.log(`⚠️ Неизвестный portnum: ${meshPacket.decoded.portnum}`);
        }
      }
      // Обрабатываем зашифрованные пакеты
      else if (meshPacket.encrypted?.length > 0) {
        console.log(`🔐 Пытаемся расшифровать пакет`);
        const decrypted = this.decrypt(meshPacket);
        if (decrypted) {
          console.log(`✅ Пакет расшифрован, portnum: ${decrypted.portnum}`);

          const event = {
            mqttChannel: fullTopic,
            mqttUser: user,
            rxSnr: meshPacket.rxSnr,
            hopLimit: meshPacket.hopLimit,
            wantAck: meshPacket.wantAck,
            rxRssi: meshPacket.rxRssi,
            gatewayId,
            from: meshPacket.from,
            id: meshPacket.id,
            data: decrypted,
            packet: meshPacket,
          };

          const eventType = this.getEventTypeByPortnum(decrypted.portnum);
          console.log(`🎯 Тип расшифрованного события: ${eventType}`);

          if (eventType) {
            this.processEvent(
              server,
              fullTopic,
              user,
              "decoded",
              eventType,
              event
            );
          } else {
            console.log(
              `⚠️ Неизвестный portnum в расшифрованном: ${decrypted.portnum}`
            );
          }
        } else {
          console.log(`❌ Не удалось расшифровать пакет`);
        }
      } else {
        console.log(`⚠️ Нет decoded и encrypted данных в пакете`);
      }
    } catch (error) {
      console.error(`❌ Ошибка обработки protobuf:`, error.message);
    }
  }

  // Основная функция обработки событий
  async processEvent(server, fullTopic, user, eventName, eventType, event) {
    try {
      console.log(`🔄 Обрабатываем событие: ${eventName}/${eventType}`);

      const { from } = event;
      if (!from) {
        console.log(`⚠️ Нет отправителя, пропускаем`);
        return;
      }

      console.log(`👤 От устройства: ${from}`);

      const key = `device:${from}`;
      const serverTime = Date.now();

      // Переменные для сохранения в device ключ
      let shouldSaveToDevice = true;
      let deviceEventData = null;

      // Handle user data
      if (eventType === "user") {
        console.log(`👤 Обрабатываем user данные...`);

        // Декодируем User payload
        try {
          if (event.data?.payload) {
            const payloadBuffer = Buffer.from(event.data.payload, "base64");
            const userData = this.protoTypes.User.decode(payloadBuffer);

            console.log(`👤 User данные декодированы:`, userData);

            const {
              shortName,
              longName,
              id,
              macaddr,
              publicKey,
              hwModel,
              role,
            } = userData;

            // Сохраняем с форматированными данными
            const userRecord = {
              from,
              shortName,
              longName,
              macaddr: formatMacAddress(macaddr),
              publicKey: bufferToHex(publicKey),
              hwModel,
              role,
            };

            await this.redis.hset(`user:${id}`, userRecord);
            console.log(`👤 User данные сохранены: ${shortName} (${longName})`);
            console.log(
              `📱 MAC: ${formatMacAddress(
                macaddr
              )}, HW: ${hwModel}, Role: ${role}`
            );

            // Подготавливаем данные для device ключа
            deviceEventData = {
              serverTime,
              rxTime: new Date(
                event.packet?.rxTime * 1000 || serverTime
              ).toISOString(),
              type: "broadcast",
              from: event.from,
              to: event.packet?.to || 4294967295,
              rxSnr: event.rxSnr,
              hopLimit: event.hopLimit,
              rxRssi: event.rxRssi,
              gatewayId: event.gatewayId,
              data: {
                shortName,
                longName,
                macaddr: formatMacAddress(macaddr),
                publicKey: bufferToHex(publicKey),
                hwModel,
                role,
              },
            };
          }
        } catch (decodeError) {
          console.log(`❌ Ошибка декодирования User:`, decodeError.message);
          shouldSaveToDevice = false;
        }
      }

      // Handle position data
      else if (eventType === "position") {
        console.log(`📍 Обрабатываем GPS данные...`);
        const gpsKey = `gps:${from}`;

        try {
          if (event.data?.payload) {
            const payloadBuffer = Buffer.from(event.data.payload, "base64");
            const positionData = this.protoTypes.Position.decode(payloadBuffer);
            console.log(`📍 GPS данные декодированы:`, positionData);

            const {
              latitudeI,
              longitudeI,
              altitude,
              satsInView,
              time: posTime,
            } = positionData;
            console.log(
              `📍 GPS координаты: lat=${latitudeI}, lon=${longitudeI}, alt=${altitude}`
            );

            // Проверяем валидность координат
            if (
              !latitudeI ||
              !longitudeI ||
              latitudeI === 0 ||
              longitudeI === 0 ||
              isNaN(latitudeI) ||
              isNaN(longitudeI)
            ) {
              console.log(`❌ Невалидные GPS координаты`);
              shouldSaveToDevice = false;
            } else {
              const newPosItem = {
                latitudeI,
                longitudeI,
                altitude: altitude || undefined,
                time: serverTime,
              };

              await this.upsertItem(gpsKey, serverTime, newPosItem);
              console.log(`📍 GPS данные сохранены в ${gpsKey}`);

              // Подготавливаем данные для device ключа в нужном формате
              deviceEventData = {
                serverTime,
                rxTime: new Date(
                  event.packet?.rxTime * 1000 || serverTime
                ).toISOString(),
                type: "broadcast",
                from: event.from,
                to: event.packet?.to || 4294967295,
                rxSnr: event.rxSnr,
                hopLimit: event.hopLimit,
                rxRssi: event.rxRssi,
                gatewayId: event.gatewayId,
                data: {
                  latitudeI,
                  longitudeI,
                  altitude: altitude || undefined,
                  time: posTime || undefined,
                  satsInView: satsInView,
                },
              };
            }
          }
        } catch (decodeError) {
          console.log(`❌ Ошибка декодирования GPS:`, decodeError.message);
          shouldSaveToDevice = false;
        }
      }

      // Handle telemetry data
      else if (eventType === "telemetry") {
        console.log(`📊 Обрабатываем telemetry данные...`);

        try {
          if (event.data?.payload) {
            const payloadBuffer = Buffer.from(event.data.payload, "base64");
            const telemetryData =
              this.protoTypes.Telemetry.decode(payloadBuffer);
            console.log(`📊 Telemetry данные декодированы:`, telemetryData);

            // Проверяем разные варианты структуры telemetry
            let deviceMetrics = null;
            let environmentMetrics = null;

            // Вариант 1: данные в variant (новая структура)
            if (telemetryData.variant?.case === "deviceMetrics") {
              deviceMetrics = telemetryData.variant.value;
            } else if (telemetryData.variant?.case === "environmentMetrics") {
              environmentMetrics = telemetryData.variant.value;
            }
            // Вариант 2: данные напрямую в telemetryData (старая структура)
            else if (telemetryData.deviceMetrics) {
              deviceMetrics = telemetryData.deviceMetrics;
            } else if (telemetryData.environmentMetrics) {
              environmentMetrics = telemetryData.environmentMetrics;
            }

            // Handle device metrics
            if (deviceMetrics) {
              const telemetryKey = `deviceMetrics:${from}`;
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
              uptimeSeconds = uptimeSeconds || undefined;

              const newMetricsItem = {
                batteryLevel,
                voltage,
                channelUtilization,
                airUtilTx,
                uptimeSeconds,
              };

              // Проверяем валидность данных
              if (!isValidDeviceMetrics(newMetricsItem)) {
                console.log(`⚠️ Невалидные device metrics, пропускаем`);
                shouldSaveToDevice = false;
              } else {
                await this.upsertItem(telemetryKey, serverTime, newMetricsItem);

                // Подготавливаем данные для device ключа
                deviceEventData = {
                  serverTime,
                  rxTime: new Date(
                    event.packet?.rxTime * 1000 || serverTime
                  ).toISOString(),
                  type: "broadcast",
                  from: event.from,
                  to: event.packet?.to || 4294967295,
                  rxSnr: event.rxSnr,
                  hopLimit: event.hopLimit,
                  rxRssi: event.rxRssi,
                  gatewayId: event.gatewayId,
                  data: {
                    variant: {
                      case: "deviceMetrics",
                      value: newMetricsItem,
                    },
                  },
                };
              }
            }

            // Handle environment metrics - ИСПРАВЛЕНО: теперь сохраняется и в device ключ
            else if (environmentMetrics) {
              const telemetryKey = `environmentMetrics:${from}`;
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

              // Проверяем валидность данных
              if (!isValidEnvironmentMetrics(newEnvItem)) {
                console.log(`⚠️ Невалидные environment metrics, пропускаем`);
                shouldSaveToDevice = false;
              } else {
                // Сохраняем в отдельный ключ environmentMetrics:deviceId
                await this.upsertItem(telemetryKey, serverTime, newEnvItem);
                console.log(
                  `🌡️ Environment metrics сохранены для устройства ${from}:`,
                  newEnvItem
                );

                // ИСПРАВЛЕНО: Подготавливаем данные для device ключа с правильной структурой
                deviceEventData = {
                  serverTime,
                  rxTime: new Date(
                    event.packet?.rxTime * 1000 || serverTime
                  ).toISOString(),
                  type: "broadcast",
                  from: event.from,
                  to: event.packet?.to || 4294967295,
                  rxSnr: event.rxSnr,
                  hopLimit: event.hopLimit,
                  rxRssi: event.rxRssi,
                  gatewayId: event.gatewayId,
                  data: {
                    variant: {
                      case: "environmentMetrics",
                      value: newEnvItem,
                    },
                  },
                };
              }
            } else {
              console.log(`⚠️ Неизвестный тип telemetry данных`);
              console.log(
                `🔍 Структура telemetryData:`,
                Object.keys(telemetryData)
              );
              shouldSaveToDevice = false;
            }
          }
        } catch (decodeError) {
          console.log(
            `❌ Ошибка декодирования Telemetry:`,
            decodeError.message
          );
          shouldSaveToDevice = false;
        }
      }

      // Handle neighbor info data - НЕ сохраняем в device ключ
      else if (eventType === "neighborInfo") {
        console.log(`🏘️ Обрабатываем neighbor info данные...`);
        shouldSaveToDevice = false; // НЕ сохраняем в device ключ

        try {
          if (event.data?.payload) {
            const payloadBuffer = Buffer.from(event.data.payload, "base64");
            const neighborInfoData =
              this.protoTypes.NeighborInfo.decode(payloadBuffer);
            console.log(
              `🏘️ NeighborInfo данные декодированы:`,
              neighborInfoData
            );

            const neighborInfoKey = `neighborInfo:${from}`;
            const {
              nodeId,
              lastSentById,
              nodeBroadcastIntervalSecs,
              neighbors,
            } = neighborInfoData;

            // Обрабатываем список соседей
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

            await this.upsertItem(
              neighborInfoKey,
              serverTime,
              newNeighborInfoItem
            );
            console.log(
              `🏘️ NeighborInfo сохранен в отдельный ключ ${neighborInfoKey}:`,
              {
                nodeId: newNeighborInfoItem.nodeIdStr,
                neighborsCount: processedNeighbors.length,
                neighbors: processedNeighbors
                  .map((n) => n.nodeIdStr)
                  .join(", "),
              }
            );
          }
        } catch (decodeError) {
          console.log(
            `❌ Ошибка декодирования NeighborInfo:`,
            decodeError.message
          );
        }
      }

      // Handle map report data - НЕ сохраняем в device ключ
      else if (eventType === "mapReport") {
        console.log(`🗺️ Обрабатываем map report данные...`);
        shouldSaveToDevice = false; // НЕ сохраняем в device ключ

        try {
          if (event.data?.payload) {
            const payloadBuffer = Buffer.from(event.data.payload, "base64");
            const mapReportData =
              this.protoTypes.MapReport.decode(payloadBuffer);
            console.log(`🗺️ Map report данные декодированы:`, mapReportData);

            const mapReportKey = `mapReport:${from}`;
            const {
              longName,
              shortName,
              role,
              hwModel,
              firmwareVersion,
              region,
              modemPreset,
              hasDefaultChannel,
              latitude,
              longitude,
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
              latitude: latitude ? round(latitude, 6) : undefined,
              longitude: longitude ? round(longitude, 6) : undefined,
              altitude: altitude ? round(altitude, 0) : undefined,
              positionPrecision,
              numOnlineLocalNodes,
            };

            await this.upsertItem(mapReportKey, serverTime, newMapReportItem);
            console.log(
              `🗺️ Map report сохранен в отдельный ключ ${mapReportKey}:`,
              {
                name: `${shortName} (${longName})`,
                firmware: firmwareVersion,
                position:
                  latitude && longitude
                    ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
                    : "N/A",
              }
            );
          }
        } catch (decodeError) {
          console.log(
            `❌ Ошибка декодирования MapReport:`,
            decodeError.message
          );
        }
      }

      // Handle messages
      else if (eventType === "message") {
        console.log(`💬 Обрабатываем сообщение...`);

        // Определяем тип сообщения
        const messageType = getMessageType(event);
        console.log(`💬 Тип сообщения: ${messageType}`);

        // Декодируем текст сообщения
        let messageText = "";
        try {
          if (event.data?.payload) {
            // Декодируем payload как строку
            const payloadBuffer = Buffer.from(event.data.payload, "base64");
            messageText = payloadBuffer.toString("utf8");
            console.log(`💬 Текст декодирован из payload: "${messageText}"`);
          }
        } catch (decodeError) {
          console.log(
            `❌ Ошибка декодирования сообщения:`,
            decodeError.message
          );
          shouldSaveToDevice = false;
        }

        // Пропускаем приватные сообщения для сохранения в device ключ
        if (messageType === "direct") {
          console.log(
            `⚠️ Приватное сообщение, пропускаем сохранение в device ключ`
          );
          shouldSaveToDevice = false;
        } else {
          const messageKey = `message:${from}`;

          if (!messageText || messageText.trim() === "") {
            console.log(`⚠️ Пустое сообщение, пропускаем`);
            shouldSaveToDevice = false;
          } else {
            // Создаем объект сообщения
            const messageItem = {
              rxTime: new Date(
                event.packet?.rxTime * 1000 || serverTime
              ).toISOString(),
              type: messageType,
              rxSnr: event.rxSnr,
              hopLimit: event.hopLimit,
              rxRssi: event.rxRssi,
              gatewayId: event.gatewayId,
              data: messageText,
            };

            await this.upsertItem(messageKey, serverTime, messageItem);
            console.log(
              `💬 Сообщение: "${messageText.substring(0, 50)}${
                messageText.length > 50 ? "..." : ""
              }"`
            );

            // Подготавливаем данные для device ключа
            deviceEventData = {
              serverTime,
              rxTime: new Date(
                event.packet?.rxTime * 1000 || serverTime
              ).toISOString(),
              type: messageType,
              from: event.from,
              to: event.packet?.to || 4294967295,
              rxSnr: event.rxSnr,
              hopLimit: event.hopLimit,
              rxRssi: event.rxRssi,
              gatewayId: event.gatewayId,
              data: messageText,
            };
          }
        }

        // Handle messages - вызываем функцию из telegram.mjs для всех сообщений (включая direct)
        if (messageType === "broadcast" || messageType === "direct") {
          // Создаем событие в формате, ожидаемом telegram.mjs
          const telegramEvent = {
            ...event,
            type: messageType,
            data: messageText || event.data?.payload || "",
          };

          // Обрабатываем Telegram уведомления
          handleTelegramMessage(this.redis, server, fullTopic, telegramEvent);
        }
      }

      // Сохраняем в device ключ ТОЛЬКО если есть подготовленные данные
      if (shouldSaveToDevice && deviceEventData) {
        // ИСПРАВЛЕНО: Определяем правильный ключ для сохранения
        let saveKey;
        if (eventType === "telemetry") {
          // Для telemetry определяем тип по данным
          if (deviceEventData.data?.variant?.case === "deviceMetrics") {
            saveKey = "deviceMetrics";
          } else if (
            deviceEventData.data?.variant?.case === "environmentMetrics"
          ) {
            saveKey = "environmentMetrics";
          } else {
            saveKey = "telemetry";
          }
        } else {
          saveKey = eventType;
        }

        await this.redis.hset(key, {
          server: server.name,
          timestamp: new Date(serverTime).toISOString(),
          [saveKey]: JSON.stringify(deviceEventData),
        });

        console.log(`💾 Сохранено в Redis: ${key} под ключом ${saveKey}`);
      } else if (shouldSaveToDevice) {
        console.log(`⚠️ Нет подготовленных данных для сохранения в ${key}`);
      } else {
        console.log(`🚫 ${eventType} не сохраняется в device ключ`);
      }
    } catch (error) {
      console.error("❌ Ошибка обработки события:", error.message);
      console.error("Stack:", error.stack);
    }
  }

  createNonce(packetId, fromNode) {
    const packetId64 = BigInt(packetId);
    const blockCounter = 0;
    const buf = Buffer.alloc(16);

    buf.writeBigUInt64LE(packetId64, 0);
    buf.writeUInt32LE(fromNode, 8);
    buf.writeUInt32LE(blockCounter, 12);

    return buf;
  }

  decrypt(packet) {
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

        return this.protoTypes.Data.decode(decryptedBuffer);
      } catch (e) {
        // Пробуем следующий ключ
      }
    }

    return null;
  }

  async disconnect() {
    console.log("👋 Отключение от всех серверов...");
    this.mqttManager.disconnect();

    if (this.redis) {
      await this.redis.quit();
      console.log("✅ Redis отключен");
    }
  }
}

async function main() {
  console.log(
    "🚀 Запуск Meshtastic MQTT клиента с Redis интеграцией, HTTP сервером и Telegram ботом..."
  );
  console.log(`📡 Подключение к ${servers.length} серверам:`);
  servers.forEach((server) => {
    console.log(`  🌐 ${server.name} (${server.address})`);
  });

  const client = new MeshtasticRedisClient();
  await client.init();

  // Graceful shutdown
  const gracefulShutdown = async () => {
    console.log("👋 Завершение работы...");
    await client.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
}

// Запускаем только если файл запущен напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default MeshtasticRedisClient;
