import { Telegraf } from "telegraf";
import { botSettings } from "./config.mjs";

const MESSAGE_GROUP_TIMEOUT = 8000;

// Helper function to format hop count
const formatHopCount = (hop) => {
  if (hop === null || hop === undefined || hop === "N/A") {
    return null;
  }

  const hopValue = typeof hop === "string" ? parseInt(hop, 10) : hop;

  if (hopValue === 7) {
    return "Direct";
  } else if (hopValue >= 0 && hopValue < 7) {
    return `${7 - hopValue} Hop`;
  }

  return hop; // fallback for unexpected values
};

let bot = null;
if (botSettings.ENABLE && botSettings.BOT_TOKEN) {
  bot = new Telegraf(botSettings.BOT_TOKEN);
  // console.log("Telegram bot initialized");
}

const messageGroups = new Map();
const processedMessages = new Set();

// Cleanup processed messages every 10 minutes
setInterval(() => processedMessages.clear(), 10 * 60 * 1000);

// Hardware models map
const HW_MODELS = {
  0: "UNSET",
  1: "TLORA V2",
  2: "TLORA V1",
  3: "TLORA V2.1 1.6",
  4: "TBEAM",
  5: "HELTEC V2.0",
  6: "TBEAM V0.7",
  7: "T-ECHO",
  8: "TLORA V1.1.3",
  9: "RAK4631",
  10: "HELTEC V2.1",
  11: "HELTEC V1",
  12: "LILYGO TBEAM S3 CORE",
  13: "RAK11200",
  14: "NANO G1",
  15: "TLORA V2.1.1.8",
  16: "TLORA T3 S3",
  17: "NANO G1 EXPLORER",
  18: "NANO G2 ULTRA",
  19: "LORA TYPE",
  20: "WIPHONE",
  21: "WIO WM1110",
  22: "RAK2560",
  23: "HELTEC HRU 3601",
  24: "HELTEC WIRELESS BRIDGE",
  25: "STATION G1",
  26: "RAK11310",
  27: "SENSELORA RP2040",
  28: "SENSELORA S3",
  29: "CANARYONE",
  30: "RP2040 LORA",
  31: "STATION G2",
  32: "LORA RELAY V1",
  33: "NRF52840DK",
  34: "PPR",
  35: "GENIEBLOCKS",
  36: "NRF52 UNKNOWN",
  37: "PORTDUINO",
  38: "ANDROID SIM",
  39: "DIY V1",
  40: "NRF52840 PCA10059",
  41: "DR DEV",
  42: "M5STACK",
  43: "HELTEC V3",
  44: "HELTEC WSL V3",
  45: "BETAFPV 2400 TX",
  46: "BETAFPV 900 NANO TX",
  47: "RPI PICO",
  48: "HELTEC WIRELESS TRACKER",
  49: "HELTEC WIRELESS PAPER",
  50: "T DECK",
  51: "T WATCH S3",
  52: "PICOMPUTER S3",
  53: "HELTEC HT62",
  54: "EBYTE ESP32 S3",
  55: "ESP32 S3 PICO",
  56: "CHATTER 2",
  57: "HELTEC WIRELESS PAPER V1.0",
  58: "HELTEC WIRELESS TRACKER V1.0",
  59: "UNPHONE",
  60: "TD LORAC",
  61: "CDEBYTE EORA S3",
  62: "TWC MESH V4",
  63: "NRF52 PROMICRO DIY",
  64: "RADIOMASTER 900 BANDIT NANO",
  65: "HELTEC CAPSULE SENSOR V3",
  66: "HELTEC VISION MASTER T190",
  67: "HELTEC VISION MASTER E213",
  68: "HELTEC VISION MASTER E290",
  69: "HELTEC MESH NODE T114",
  70: "SENSECAP INDICATOR",
  71: "TRACKER T1000 E",
  72: "RAK3172",
  73: "WIO E5",
  74: "RADIOMASTER 900 BANDIT",
  75: "ME25LS01 4Y10TD",
  76: "RP2040 FEATHER RFM95",
  77: "M5STACK COREBASIC",
  78: "M5STACK CORE2",
  79: "RPI PICO2",
  80: "M5STACK CORES3",
  81: "SEEED XIAO S3",
  82: "MS24SF1",
  83: "TLORA C6",
  84: "WISMESH TAP",
  85: "ROUTASTIC",
  86: "MESH TAB",
  87: "MESHLINK",
  88: "XIAO NRF52 KIT",
  89: "THINKNODE M1",
  90: "THINKNODE M2",
  91: "T ETH ELITE",
  92: "HELTEC SENSOR HUB",
  93: "RESERVED FRIED CHICKEN",
  94: "HELTEC MESH POCKET",
  95: "SEEED SOLAR NODE",
  96: "NOMADSTAR METEOR PRO",
  97: "CROWPANEL",
  98: "LINK 32",
  99: "SEEED WIO TRACKER L1",
  100: "SEEED WIO TRACKER L1 EINK",
  101: "QWANTZ TINY ARMS",
  102: "T DECK PRO",
  103: "T LORA PAGER",
  104: "GAT562 MESH TRIAL TRACKER",
  105: "WISMESH TAG",
  106: "RAK3312",
  107: "THINKNODE M5",
  255: "PRIVATE HW",
};

const ROLES = {
  0: "CLIENT",
  1: "CLIENT MUTE",
  2: "ROUTER",
  3: "ROUTER CLIENT", // deprecated
  4: "REPEATER",
  5: "TRACKER",
  6: "SENSOR",
  7: "TAK",
  8: "CLIENT HIDDEN",
  9: "LOST AND FOUND",
  10: "TAK TRACKER",
  11: "ROUTER LATE",
};

// Utility functions
const escapeHtml = (text) =>
  String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

const formatTimeAgo = (timestamp) => {
  if (
    !timestamp ||
    timestamp === "N/A" ||
    timestamp === null ||
    timestamp === undefined
  )
    return "";

  try {
    const timestampDate = new Date(timestamp);
    if (isNaN(timestampDate.getTime())) return "";

    const diffMs = Date.now() - timestampDate.getTime();
    if (diffMs < 0) return ""; // Время в будущем - некорректно

    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 360000);
    const diffDays = Math.floor(diffMs / 8640000);

    if (diffMinutes < 1) return "[только что]";
    if (diffMinutes < 60) return `[${diffMinutes} мин назад]`;
    if (diffHours < 24) return `[${diffHours} ч назад]`;
    return `[${diffDays} дн назад]`;
  } catch (error) {
    return "";
  }
};

const formatUptime = (hours) => {
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    if (remainingHours === 0) {
      return `${days}д`;
    } else {
      return `${days}д ${remainingHours}ч`;
    }
  } else {
    return `${hours}ч`;
  }
};

const getHwModelName = (hwModel) =>
  HW_MODELS[hwModel] || `Unknown (${hwModel})`;
const getRoleName = (role) => ROLES[role] || `Unknown (${role})`;

// Safe JSON parse
const safeJsonParse = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

// Convert hex ID to numeric
const toNumericId = (deviceId) => {
  return typeof deviceId === "string" && deviceId.startsWith("!")
    ? parseInt(deviceId.substring(1), 16)
    : deviceId;
};

// Check if device is an MQTT gateway
const checkIfGateway = (role, server, deviceId, gatewayInfoMap) => {
  try {
    // Защитные проверки
    if (!deviceId || !gatewayInfoMap) {
      return false;
    }

    // Устройство считается MQTT шлюзом ТОЛЬКО если:
    // Оно реально выступает gatewayId для других устройств в сети
    const numericDeviceId = toNumericId(deviceId);
    const isActingAsGateway = Object.values(gatewayInfoMap).some(
      (gateway) => toNumericId(gateway.idHex) === numericDeviceId
    );

    // Показываем "MQTT Шлюз" только для устройств, которые реально
    // ретранслируют сообщения от других устройств
    return isActingAsGateway;
  } catch (error) {
    console.error("Error in checkIfGateway:", error.message);
    return false;
  }
};

// Get gateway information batch
const getGatewayInfoBatch = async (redis, gatewayIds) => {
  try {
    const gatewayInfoMap = {};

    for (const gatewayId of gatewayIds) {
      if (!gatewayId) continue;

      try {
        const numericId = toNumericId(gatewayId);

        // Сначала пытаемся получить данные из NODEINFO_APP
        const userData = await redis.getPortnumMessages(
          "NODEINFO_APP",
          numericId,
          1
        );

        let longName = "Unknown";
        let shortName = "N/A";

        if (userData && userData[0]) {
          // Проверяем разные варианты структуры данных
          const rawData = userData[0].rawData || userData[0].data;
          longName =
            rawData?.longName ||
            rawData?.long_name ||
            rawData?.text ||
            longName;
          shortName = rawData?.shortName || rawData?.short_name || shortName;
        } else {
          // Если нет данных в NODEINFO_APP, пытаемся получить из dots (карта устройств)
          try {
            const rawData = await redis.redis.hgetall(`dots:${numericId}`);
            if (rawData && Object.keys(rawData).length > 0) {
              // Парсим данные как в Redis менеджере
              const dotData = {};
              Object.entries(rawData).forEach(([key, value]) => {
                try {
                  dotData[key] = JSON.parse(value);
                } catch {
                  if (!isNaN(value) && value !== "") {
                    dotData[key] = Number(value);
                  } else {
                    dotData[key] = value;
                  }
                }
              });

              // Используем данные из dots если они есть
              if (dotData.longName && dotData.longName.trim() !== "") {
                longName = dotData.longName;
              }
              if (dotData.shortName && dotData.shortName.trim() !== "") {
                shortName = dotData.shortName;
              }
            }
          } catch (dotError) {
            console.error(
              `Error getting dot data for gateway ${gatewayId}:`,
              dotError.message
            );
          }
        }

        gatewayInfoMap[gatewayId] = {
          idHex: gatewayId,
          numericId: numericId,
          longName: longName,
          shortName: shortName,
        };
      } catch (error) {
        console.error(
          `Error getting gateway info for ${gatewayId}:`,
          error.message
        );
        // Создаем базовую информацию в случае ошибки
        gatewayInfoMap[gatewayId] = {
          idHex: gatewayId,
          numericId: toNumericId(gatewayId),
          longName: "Unknown",
          shortName: "N/A",
        };
      }
    }

    return gatewayInfoMap;
  } catch (error) {
    console.error("Error in getGatewayInfoBatch:", error.message);
    return {};
  }
};

// Get device statistics from Redis using new schema
const getDeviceStats = async (redis, deviceId) => {
  try {
    const numericId = toNumericId(deviceId);

    // Получаем данные по новой схеме (по portnum)
    const [
      userMessages,
      positionMessages,
      deviceMetricsMessages,
      environmentMetricsMessages,
    ] = await Promise.all([
      redis.getPortnumMessages("NODEINFO_APP", numericId, 1),
      redis.getPortnumMessages("POSITION_APP", numericId, 1),
      redis.getPortnumMessages("TELEMETRY_APP", numericId, 1),
      redis.getPortnumMessages("TELEMETRY_APP", numericId, 1), // Environment metrics тоже в TELEMETRY_APP
    ]);

    // Получаем последние сообщения для истории
    const [
      userHistory,
      positionHistory,
      deviceMetricsHistory,
      envMetricsHistory,
    ] = await Promise.all([
      redis.getPortnumMessages("NODEINFO_APP", numericId, 10),
      redis.getPortnumMessages("POSITION_APP", numericId, 10),
      redis.getPortnumMessages("TELEMETRY_APP", numericId, 10),
      redis.getPortnumMessages("TELEMETRY_APP", numericId, 10),
    ]);

    // Получаем последние текстовые сообщения
    const lastMessages = await redis.getPortnumMessages(
      "TEXT_MESSAGE_APP",
      numericId,
      5
    );

    // Получаем данные для карты (dots) - используем прямой доступ к Redis клиенту
    let dotData = {};
    try {
      const rawData = await redis.redis.hgetall(`dots:${numericId}`);
      if (rawData && Object.keys(rawData).length > 0) {
        // Парсим данные как в Redis менеджере
        Object.entries(rawData).forEach(([key, value]) => {
          try {
            dotData[key] = JSON.parse(value);
          } catch {
            if (!isNaN(value) && value !== "") {
              dotData[key] = Number(value);
            } else {
              dotData[key] = value;
            }
          }
        });
      }
    } catch (error) {
      console.error(`Error getting dot data for ${numericId}:`, error.message);
    }

    // Формируем объект статистики
    const stats = {
      deviceId: deviceId,
      numericId: numericId,
      user: userMessages[0] || null,
      position: positionMessages[0] || null,
      deviceMetrics: deviceMetricsMessages[0] || null,
      environmentMetrics: environmentMetricsMessages[0] || null,
      userData: dotData,
      gpsHistory: positionHistory,
      deviceMetricsHistory: deviceMetricsHistory,
      envMetricsHistory: envMetricsHistory,
      lastMessages: lastMessages,
      // Добавляем информацию о gateway если есть
      server: userMessages[0]?.server || positionMessages[0]?.server || null,
    };

    return stats;
  } catch (error) {
    console.error("Error getting device stats:", error.message);
    throw error;
  }
};

// Format device statistics for Telegram
const formatDeviceStats = async (stats, redis) => {
  if (!stats) return "❌ Устройство не найдено или нет данных";

  const {
    deviceId,
    user,
    position,
    deviceMetrics,
    environmentMetrics,
    server,
    userData,
    gpsHistory,
    deviceMetricsHistory,
    envMetricsHistory,
    lastMessages,
  } = stats;

  // Collect all gateway IDs
  const gatewayIds = new Set();
  [user, position, deviceMetrics, environmentMetrics].forEach((item) => {
    if (item?.gatewayId) gatewayIds.add(item.gatewayId);
  });
  lastMessages?.forEach((msg) => {
    if (msg.gatewayId) gatewayIds.add(msg.gatewayId);
  });

  const gatewayInfoMap = await getGatewayInfoBatch(
    redis,
    Array.from(gatewayIds)
  );

  let message = `📊 <b>Статистика устройства ${escapeHtml(deviceId)}</b>\n\n`;

  // NodeInfo section - support both camelCase and snake_case
  const longName =
    user?.data?.longName ||
    user?.data?.long_name ||
    userData?.longName ||
    userData?.long_name ||
    "Unknown";
  const shortName =
    user?.data?.shortName ||
    user?.data?.short_name ||
    userData?.shortName ||
    userData?.short_name ||
    "N/A";
  const hwModel =
    user?.data?.hwModel ||
    user?.data?.hw_model ||
    userData?.hwModel ||
    userData?.hw_model ||
    255;
  const role = user?.data?.role || userData?.role || 0;

  message += `👤 <b>Имя:</b> ${escapeHtml(longName)} (${escapeHtml(
    shortName
  )})\n`;
  const userFrom = user?.from || userData?.from || stats.numericId;
  message += `🆔 <b>ID:</b> ${escapeHtml(userFrom)}\n`;
  message += `🔧 <b>Модель:</b> ${escapeHtml(getHwModelName(hwModel))}\n`;
  message += `⚡ <b>Роль:</b> ${escapeHtml(getRoleName(role))}\n`;

  // Add NodeInfo RX information
  const nodeInfoRxData = user || userData;
  if (nodeInfoRxData) {
    const nodeRxRssi =
      user?.rxRssi ||
      deviceMetrics?.rxRssi ||
      position?.rxRssi ||
      environmentMetrics?.rxRssi;
    const nodeRxSnr =
      user?.rxSnr ||
      deviceMetrics?.rxSnr ||
      position?.rxSnr ||
      environmentMetrics?.rxSnr;
    const nodeHop =
      user?.hopLimit ||
      user?.hop ||
      deviceMetrics?.hopLimit ||
      deviceMetrics?.hop ||
      position?.hopLimit ||
      position?.hop ||
      environmentMetrics?.hopLimit ||
      environmentMetrics?.hop;
    const nodeGatewayId =
      user?.gatewayId ||
      deviceMetrics?.gatewayId ||
      position?.gatewayId ||
      environmentMetrics?.gatewayId;
    const nodeTimestamp =
      user?.serverTime ||
      user?.timestamp ||
      deviceMetrics?.serverTime ||
      deviceMetrics?.timestamp ||
      position?.serverTime ||
      position?.timestamp ||
      environmentMetrics?.serverTime ||
      environmentMetrics?.timestamp;

    if (
      nodeRxRssi &&
      nodeRxSnr &&
      nodeRxRssi !== "N/A" &&
      nodeRxSnr !== "N/A" &&
      nodeGatewayId
    ) {
      const gatewayInfo = gatewayInfoMap[nodeGatewayId];
      if (gatewayInfo) {
        message += `🛰️ <b>NodeInfo RX:</b> ${escapeHtml(
          gatewayInfo.longName
        )} (${escapeHtml(gatewayInfo.idHex)}) `;
        const formattedNodeHop = formatHopCount(nodeHop);
        if (formattedNodeHop) {
          message += `${formattedNodeHop} `;
        }
        message += `RSSI/SNR: ${nodeRxRssi}/${nodeRxSnr}`;
        if (nodeTimestamp) {
          message += ` ${formatTimeAgo(nodeTimestamp)}`;
        }
        message += `\n`;
      }
    }
  }

  message += "\n";

  // Last messages section
  if (lastMessages?.length > 0) {
    message += `💬 <b>Последние сообщения:</b>\n`;
    lastMessages.slice(0, 3).forEach((msg) => {
      const gateway = gatewayInfoMap[msg.gatewayId];
      const timeAgo = formatTimeAgo(
        msg.serverTime || msg.timestamp || msg.rxTime
      );

      // Try different ways to get message text
      let messageText = "N/A";
      const rawData = msg.rawData || msg.data;

      if (typeof rawData === "string") {
        messageText = rawData;
      } else if (rawData?.text) {
        messageText = rawData.text;
      } else if (rawData?.payload) {
        // Если payload в base64, пытаемся декодировать
        try {
          const payloadBuffer = Buffer.from(rawData.payload, "base64");
          messageText = payloadBuffer.toString("utf8");
        } catch (error) {
          messageText = rawData.payload;
        }
      } else if (msg.text) {
        messageText = msg.text;
      } else if (msg.payload) {
        messageText = msg.payload;
      }

      message += `📝 ${escapeHtml(messageText)} ${timeAgo}\n`;
    });

    // Add Message RX information
    const lastMsg = lastMessages[lastMessages.length - 1];
    if (
      lastMsg &&
      lastMsg.gatewayId &&
      lastMsg.rxRssi &&
      lastMsg.rxSnr &&
      lastMsg.rxRssi !== "N/A" &&
      lastMsg.rxSnr !== "N/A"
    ) {
      const gatewayInfo = gatewayInfoMap[lastMsg.gatewayId];
      if (gatewayInfo) {
        message += `🛰️ <b>Message RX:</b> ${escapeHtml(
          gatewayInfo.longName
        )} (${escapeHtml(gatewayInfo.idHex)}) `;
        const formattedLastMsgHop = formatHopCount(lastMsg.hopLimit);
        if (formattedLastMsgHop) {
          message += `${formattedLastMsgHop} `;
        }
        message += `RSSI/SNR: ${lastMsg.rxRssi}/${lastMsg.rxSnr}`;
        if (lastMsg.serverTime || lastMsg.timestamp || lastMsg.rxTime) {
          message += ` ${formatTimeAgo(
            lastMsg.serverTime || lastMsg.timestamp || lastMsg.rxTime
          )}`;
        }
        message += `\n`;
      }
    }
    message += "\n";
  }

  // GPS section
  if (position?.data || gpsHistory.length > 0) {
    // message += `📍 <b>GPS данные:</b>\n`;
    const gpsData = position?.data || gpsHistory[0];
    if (gpsData) {
      // Support different field name formats
      const latitudeI = gpsData.latitudeI || gpsData.latitude_i;
      const longitudeI = gpsData.longitudeI || gpsData.longitude_i;
      const altitude = gpsData.altitude;

      if (latitudeI !== undefined && longitudeI !== undefined) {
        const lat = (latitudeI / 1e7).toFixed(6);
        const lon = (longitudeI / 1e7).toFixed(6);
        message += `🌍 <b>Координаты:</b> <a href="https://yandex.ru/maps/?ll=${lon},${lat}&z=15&pt=${lon},${lat},pm2rdm">${lat}, ${lon}</a>\n`;
        if (altitude !== undefined && altitude !== 0)
          message += `🏔️ <b>Высота:</b> ${altitude} м\n`;
      }
    }

    // Add GPS RX information
    const posRxRssi = position?.rxRssi;
    const posRxSnr = position?.rxSnr;
    const posHop = position?.hopLimit || position?.hop;
    const gatewayId = position?.gatewayId;
    const posTimestamp = position?.serverTime || position?.timestamp;

    if (
      posRxRssi &&
      posRxSnr &&
      posRxRssi !== "N/A" &&
      posRxSnr !== "N/A" &&
      gatewayId
    ) {
      const gatewayInfo = gatewayInfoMap[gatewayId];

      if (gatewayInfo) {
        message += `🛰️ <b>GPS RX:</b> ${escapeHtml(
          gatewayInfo.longName
        )} (${escapeHtml(gatewayInfo.idHex)}) `;
        const formattedPosHop = formatHopCount(posHop);
        if (formattedPosHop) {
          message += `${formattedPosHop} `;
        }
        message += `RSSI/SNR: ${posRxRssi}/${posRxSnr}`;
        if (posTimestamp) {
          message += ` ${formatTimeAgo(posTimestamp)}`;
        }
        message += `\n`;
      }
    }
    message += `\n`;
  }

  // Device metrics section
  if (deviceMetrics?.data || deviceMetricsHistory.length > 0) {
    const metrics = deviceMetrics?.data || deviceMetricsHistory[0];

    if (metrics) {
      // Handle nested structure: variant.value or direct metrics
      const actualMetrics = metrics.variant?.value || metrics;
      // message += `🔋 <b>Метрики устройства:</b>\n`;
      // Support both camelCase and snake_case field names
      const batteryLevel =
        actualMetrics.batteryLevel || actualMetrics.battery_level;
      const voltage = actualMetrics.voltage;
      const channelUtilization =
        actualMetrics.channelUtilization || actualMetrics.channel_utilization;
      const airUtilTx = actualMetrics.airUtilTx || actualMetrics.air_util_tx;
      const uptimeSeconds =
        actualMetrics.uptimeSeconds || actualMetrics.uptime_seconds;

      if (
        batteryLevel !== undefined &&
        batteryLevel !== null &&
        typeof batteryLevel === "number"
      )
        message += `🔋 <b>Батарея:</b> ${batteryLevel}%\n`;
      if (
        voltage !== undefined &&
        voltage !== null &&
        typeof voltage === "number"
      )
        message += `⚡ <b>Напряжение:</b> ${voltage}V\n`;
      if (
        channelUtilization !== undefined &&
        channelUtilization !== null &&
        typeof channelUtilization === "number"
      )
        message += `📶 <b>Канал:</b> ${channelUtilization.toFixed(1)}%\n`;
      if (
        airUtilTx !== undefined &&
        airUtilTx !== null &&
        typeof airUtilTx === "number"
      )
        message += `📡 <b>Air TX:</b> ${airUtilTx.toFixed(1)}%\n`;
      if (
        uptimeSeconds !== undefined &&
        uptimeSeconds !== null &&
        typeof uptimeSeconds === "number"
      ) {
        const uptimeHours = Math.floor(uptimeSeconds / 3600);
        if (uptimeHours > 0) {
          message += `⏰ <b>Время работы:</b> ${formatUptime(uptimeHours)}\n`;
        }
      }
    }

    // Add Telemetry RX information
    const devRxRssi = deviceMetrics?.rxRssi;
    const devRxSnr = deviceMetrics?.rxSnr;
    const devHop = deviceMetrics?.hopLimit || deviceMetrics?.hop;
    const devGatewayId = deviceMetrics?.gatewayId;
    const devTimestamp = deviceMetrics?.serverTime || deviceMetrics?.timestamp;

    if (
      devRxRssi &&
      devRxSnr &&
      devRxRssi !== "N/A" &&
      devRxSnr !== "N/A" &&
      devGatewayId
    ) {
      const gatewayInfo = gatewayInfoMap[devGatewayId];
      if (gatewayInfo) {
        message += `🛰️ <b>Telemetry RX:</b> ${escapeHtml(
          gatewayInfo.longName
        )} (${escapeHtml(gatewayInfo.idHex)}) `;
        const formattedDevHop = formatHopCount(devHop);
        if (formattedDevHop) {
          message += `${formattedDevHop} `;
        }
        message += `RSSI/SNR: ${devRxRssi}/${devRxSnr}`;
        if (devTimestamp) {
          message += ` ${formatTimeAgo(devTimestamp)}`;
        }
      }
    }
    message += `\n`;
  }

  // Environment metrics section
  if (environmentMetrics?.data || envMetricsHistory.length > 0) {
    const env = environmentMetrics?.data || envMetricsHistory[0];
    if (env) {
      // Handle nested structure: variant.value or direct metrics
      const actualEnv = env.variant?.value || env;

      // Support both camelCase and snake_case field names
      const temperature = actualEnv.temperature;
      const relativeHumidity =
        actualEnv.relativeHumidity || actualEnv.relative_humidity;
      const barometricPressure =
        actualEnv.barometricPressure || actualEnv.barometric_pressure;
      const gasResistance = actualEnv.gasResistance || actualEnv.gas_resistance;
      const voltage = actualEnv.voltage;
      const current = actualEnv.current;

      if (temperature !== undefined && temperature !== null)
        message += `🌡️ <b>Температура:</b> ${temperature.toFixed(1)}°C\n`;
      if (relativeHumidity !== undefined && relativeHumidity !== null)
        message += `💧 <b>Влажность:</b> ${relativeHumidity.toFixed(1)}%\n`;
      if (barometricPressure !== undefined && barometricPressure !== null)
        message += `🌬️ <b>Давление:</b> ${barometricPressure.toFixed(1)} hPa\n`;
      if (gasResistance !== undefined && gasResistance !== null)
        message += `🌫️ <b>Газы:</b> ${gasResistance.toFixed(0)} Ω\n`;
    }

    // Add Environment RX information
    const envRxRssi = environmentMetrics?.rxRssi;
    const envRxSnr = environmentMetrics?.rxSnr;
    const envHop = environmentMetrics?.hopLimit || environmentMetrics?.hop;
    const envGatewayId = environmentMetrics?.gatewayId;
    const envTimestamp =
      environmentMetrics?.serverTime || environmentMetrics?.timestamp;

    if (
      envRxRssi &&
      envRxSnr &&
      envRxRssi !== "N/A" &&
      envRxSnr !== "N/A" &&
      envGatewayId
    ) {
      const gatewayInfo = gatewayInfoMap[envGatewayId];
      if (gatewayInfo) {
        message += `🛰️ <b>Environment RX:</b> ${escapeHtml(
          gatewayInfo.longName
        )} (${escapeHtml(gatewayInfo.idHex)}) `;
        const formattedEnvHop = formatHopCount(envHop);
        if (formattedEnvHop) {
          message += `${formattedEnvHop} `;
        }
        message += `RSSI/SNR: ${envRxRssi}/${envRxSnr}`;
        if (envTimestamp) {
          message += ` ${formatTimeAgo(envTimestamp)}`;
        }
        message += `\n`;
      }
    }
    message += `\n`;
  }

  // Check if device is an MQTT gateway
  const isGateway = checkIfGateway(role, server, deviceId, gatewayInfoMap);

  if (isGateway) {
    message += `\n🔗 <b>MQTT Шлюз</b>\n`;
  }

  message += `🌐 <b>MQTT:</b> ${escapeHtml(server)}\n`;
  return message;
};

// Check if topic is allowed for Telegram notifications
const isAllowedTopic = (topic) => {
  if (!topic) return false;
  const allowedPrefixes = ["msh/msk/", "msh/kgd/", "msh/ufa/"];
  return allowedPrefixes.some((prefix) => topic.startsWith(prefix));
};

// Select Telegram channel by topic
const getChannelIdByTopic = (topic) => {
  if (!topic) return botSettings.MAIN_CHANNEL_ID;
  if (topic.startsWith("msh/kgd/")) return botSettings.KALININGRAD_CHANNEL_ID;
  if (topic.startsWith("msh/msk/")) return botSettings.MAIN_CHANNEL_ID;
  if (topic.startsWith("msh/ufa/")) return botSettings.UFA_CHANNEL_ID;
  return botSettings.MAIN_CHANNEL_ID;
};

// Send grouped message to Telegram
const sendGroupedMessage = async (redis, messageId) => {
  try {
    const group = messageGroups.get(messageId);
    if (!group) return;

    const event = group.event;
    const gateways = Array.from(group.gateways.entries());

    // Get gateway info for all gateways
    const gatewayIds = gateways.map(([id]) => id);
    const gatewayInfoMap = await getGatewayInfoBatch(redis, gatewayIds);

    // Build message - try different ways to get message text
    let messageText = "N/A";
    if (typeof event.data === "string") {
      messageText = event.data;
    } else if (event.data?.text) {
      messageText = event.data.text;
    } else if (event.text) {
      messageText = event.text;
    } else if (event.data?.payload) {
      // Try to decode payload as text
      try {
        const payloadBuffer = Buffer.from(event.data.payload, "base64");
        messageText = payloadBuffer.toString("utf8");
      } catch (error) {
        console.error("Error decoding message payload:", error.message);
      }
    }

    let message = `💬 <b>Msg:</b> ${escapeHtml(messageText)}`;

    // Get sender info using event.from (actual sender), not event.gatewayId (receiver gateway)
    const senderId = event.from
      ? `!${event.from.toString(16).padStart(8, "0")}`
      : null;
    let senderInfo = null;

    if (senderId) {
      senderInfo = await getGatewayInfoBatch(redis, [senderId]);
      senderInfo = senderInfo[senderId];
    }

    if (senderInfo) {
      const deviceIdForUrl = senderId ? senderId.substring(1) : "";
      message += `\n👤 <b>От:</b> ${escapeHtml(
        senderInfo.longName
      )} (${escapeHtml(
        senderId
      )}) <a href="https://t.me/MeshtasticTaubeteleComBot?start=${deviceIdForUrl}">📊</a>`;
    } else if (senderId) {
      const deviceIdForUrl = senderId ? senderId.substring(1) : "";
      message += `\n👤 <b>От:</b> Unknown (${escapeHtml(
        senderId
      )}) <a href="https://t.me/MeshtasticTaubeteleComBot?start=${deviceIdForUrl}">📊</a>`;
    }

    message += `\n📡 <b>Получено шлюзами (${gateways.length}):</b>\n`;
    gateways.forEach(([gatewayId, info]) => {
      const gateway = gatewayInfoMap[gatewayId];
      const gatewayIdForUrl = gatewayId ? gatewayId.substring(1) : "";
      message += `• ${escapeHtml(gateway?.longName || "Unknown")} (${escapeHtml(
        gatewayId
      )})`;

      // Check if RSSI or SNR is 0, then show MQTT instead of values
      if (info.rxRssi === 0 || info.rxSnr === 0) {
        message += ` MQTT`;
      } else {
        if (info.rxRssi !== undefined) message += ` ${info.rxRssi}dBm`;
        if (info.rxSnr !== undefined) message += `/${info.rxSnr}SNR`;
        const formattedHop = formatHopCount(info.hopLimit);
        if (formattedHop) message += `/${formattedHop}`;
      }

      message += ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${gatewayIdForUrl}">📊</a>\n`;
    });

    await sendTelegramMessage(message, group.channelId);
    console.log(`Telegram message sent successfully for group ${messageId}`);
  } catch (error) {
    console.error("Error sending grouped message:", error.message);
  } finally {
    messageGroups.delete(messageId);
  }
};

// Send message to Telegram with error handling
const sendTelegramMessage = async (message, channelId) => {
  if (!bot || !botSettings.ENABLE) return;

  try {
    await bot.telegram.sendMessage(
      channelId || botSettings.MAIN_CHANNEL_ID,
      message,
      {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }
    );
  } catch (error) {
    console.error("Error sending telegram message:", error.message);
    // Fallback: send without formatting
    try {
      await bot.telegram.sendMessage(
        channelId || botSettings.MAIN_CHANNEL_ID,
        message.replace(/<[^>]*>/g, ""),
        { disable_web_page_preview: true }
      );
    } catch (fallbackError) {
      console.error(
        "Error sending fallback telegram message:",
        fallbackError.message
      );
    }
  }
};

// Safe reply function
const safeReply = async (ctx, message) => {
  try {
    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error sending reply:", error.message);
    await ctx.reply(message.replace(/<[^>]*>/g, ""));
  }
};

// Initialize Telegram bot
export const initializeTelegramBot = (redis) => {
  if (!bot || !botSettings.ENABLE) return;

  const helpMessage =
    `🤖 <b>Доступные команды:</b>\n\n` +
    `📊 <code>/xxxx</code> - статистика устройства (где xxxx - hex ID без !)\n` +
    `❓ <code>/help</code> - показать эту справку\n\n` +
    `<i>Пример: /12aabb34</i>`;

  // Device stats command handler
  bot.hears(/^\/([0-9a-fA-F]{8})$/, async (ctx) => {
    try {
      const deviceId = `!${ctx.match[1].toLowerCase()}`;
      const stats = await getDeviceStats(redis, deviceId);
      const message = await formatDeviceStats(stats, redis);
      await safeReply(ctx, message);
    } catch (error) {
      console.error("Error handling device stats command:", error.message);
      await safeReply(ctx, "❌ Ошибка при получении статистики устройства");
    }
  });

  // Start command handler
  bot.command("start", async (ctx) => {
    const startParam = ctx.message.text.split(" ")[1];

    if (startParam && /^[0-9a-fA-F]{8}$/.test(startParam)) {
      const deviceId = `!${startParam.toLowerCase()}`;
      try {
        const stats = await getDeviceStats(redis, deviceId);
        const message = await formatDeviceStats(stats, redis);
        await safeReply(ctx, message);
      } catch (error) {
        console.error("Error handling device stats via start:", error.message);
        await safeReply(ctx, "❌ Ошибка при получении статистики устройства");
      }
    } else {
      await safeReply(ctx, helpMessage);
    }
  });

  // Help command handler
  bot.command("help", async (ctx) => {
    await safeReply(ctx, helpMessage);
  });

  // Example command handler
  bot.command("12aabb34", async (ctx) => {
    const message =
      "<b>!12aabb34</b> это пример!\nВам нужно использовать id вашего <b>meshtastic</b> устройства";
    await safeReply(ctx, message);
  });

  // Error handling
  bot.catch((err, ctx) => {
    console.error(`Telegram bot error for ${ctx.updateType}:`, err);
  });

  // Launch bot
  bot
    .launch()
    .then(() => console.log("Telegram bot commands initialized and launched"))
    .catch((error) =>
      console.error("Error launching telegram bot:", error.message)
    );

  // Graceful shutdown
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
};

// Handle Telegram message from MQTT
export const handleTelegramMessage = async (
  redis,
  server,
  fullTopic,
  event
) => {
  if (
    !server.telegram ||
    !isAllowedTopic(fullTopic) ||
    event.type !== "broadcast"
  ) {
    return;
  }

  const messageKey = `${event.id}_${event.gatewayId}_${server.name}`;
  if (processedMessages.has(messageKey)) return;

  processedMessages.add(messageKey);

  const messageId = event.id;
  const gatewayId = event.gatewayId;

  if (!messageGroups.has(messageId)) {
    messageGroups.set(messageId, {
      event: event,
      gateways: new Map(),
      timeout: null,
      channelId: getChannelIdByTopic(fullTopic),
    });
  }

  const group = messageGroups.get(messageId);

  if (!group.gateways.has(gatewayId)) {
    group.gateways.set(gatewayId, {
      hopLimit: event.hopLimit,
      rxRssi: event.rxRssi,
      rxSnr: event.rxSnr,
      server: server.name,
    });

    console.log(
      `Added gateway ${gatewayId} to message group ${messageId}. Total gateways: ${group.gateways.size}`
    );
  }

  if (group.timeout) clearTimeout(group.timeout);

  group.timeout = setTimeout(() => {
    sendGroupedMessage(redis, messageId);
  }, MESSAGE_GROUP_TIMEOUT);
};

// Экспортируем функции для тестирования
export { getDeviceStats, getGatewayInfoBatch, toNumericId };
