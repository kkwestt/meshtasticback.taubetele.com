import { Telegraf } from "telegraf";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { botSettings } from "../config.mjs";

const MESSAGE_GROUP_TIMEOUT = 15 * 1000;

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

// Функция создания прокси-агента в зависимости от типа
function createProxyAgent(proxy) {
  const { type, host, port, user, pass } = proxy;
  
  // Формируем URL с учетом аутентификации
  const auth = user && pass ? `${user}:${pass}@` : "";
  
  switch (type?.toLowerCase()) {
    case "socks4":
    case "socks5":
      const socksUrl = `${type}://${auth}${host}:${port}`;
      return new SocksProxyAgent(socksUrl);
    
    case "http":
      const httpUrl = `http://${auth}${host}:${port}`;
      return new HttpProxyAgent(httpUrl);
    
    case "https":
      const httpsUrl = `https://${auth}${host}:${port}`;
      return new HttpsProxyAgent(httpsUrl);
    
    default:
      // По умолчанию используем socks5
      const defaultUrl = `socks5://${auth}${host}:${port}`;
      return new SocksProxyAgent(defaultUrl);
  }
}

// Функция проверки подключения к Telegram
async function testTelegramConnection(botInstance, timeout = 10000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    await botInstance.telegram.getMe({ signal: controller.signal });
    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    return false;
  }
}

// Функция инициализации бота с fallback
async function initializeTelegramBot() {
  if (!botSettings.ENABLE || !botSettings.BOT_TOKEN) {
    return null;
  }

  const timeout = botSettings.PROXY?.CONNECTION_TIMEOUT || 10000;
  
  // Приоритет 1: Попытка прямого подключения
  console.log("🔄 [Telegram] Попытка прямого подключения...");
  try {
    const directBot = new Telegraf(botSettings.BOT_TOKEN);
    const isDirectConnected = await testTelegramConnection(directBot, timeout);
    
    if (isDirectConnected) {
      console.log("✅ [Telegram] Прямое подключение успешно");
      return directBot;
    } else {
      console.log("❌ [Telegram] Прямое подключение не удалось");
    }
  } catch (error) {
    console.log("❌ [Telegram] Ошибка прямого подключения:", error.message);
  }

  // Приоритет 2: Попытка подключения через прокси (если включено)
  if (botSettings.PROXY?.ENABLED && botSettings.PROXY?.PROXIES?.length > 0) {
    for (let i = 0; i < botSettings.PROXY.PROXIES.length; i++) {
      const proxy = botSettings.PROXY.PROXIES[i];
      const proxyType = proxy.type || "socks5";
      console.log(`🔄 [Telegram] Попытка подключения через ${proxyType} прокси ${i + 1}/${botSettings.PROXY.PROXIES.length}: ${proxy.host}:${proxy.port}`);
      
      try {
        const agent = createProxyAgent(proxy);
        
        const proxyBot = new Telegraf(botSettings.BOT_TOKEN, {
          telegram: { agent },
        });
        
        const isProxyConnected = await testTelegramConnection(proxyBot, timeout);
        
        if (isProxyConnected) {
          console.log(`✅ [Telegram] Подключение через ${proxyType} прокси ${proxy.host}:${proxy.port} успешно`);
          return proxyBot;
        } else {
          console.log(`❌ [Telegram] ${proxyType} прокси ${proxy.host}:${proxy.port} не работает`);
        }
      } catch (error) {
        console.log(`❌ [Telegram] Ошибка подключения через ${proxyType} прокси ${proxy.host}:${proxy.port}:`, error.message);
      }
    }
  }

  console.error("❌ [Telegram] Не удалось установить подключение ни напрямую, ни через прокси");
  return null;
}

// Инициализация бота
let bot = null;
(async () => {
  bot = await initializeTelegramBot();
  if (bot) {
    console.log("🤖 [Telegram] Бот инициализирован успешно");
  }
})();

const messageGroups = new Map();
const processedMessages = new Set();

// Cleanup processed messages every 10 minutes
let messageCleanupInterval = setInterval(
  () => processedMessages.clear(),
  10 * 60 * 1000
);

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

const REGIONS = {
  0: "UNSET",
  1: "US",
  2: "EU_433",
  3: "EU_868",
  4: "CN",
  5: "JP",
  6: "ANZ",
  7: "KR",
  8: "TW",
  9: "RU",
  10: "IN",
  11: "NZ_865",
  12: "TH",
  13: "LORA_24",
  14: "UA_433",
  15: "UA_868",
  16: "MY_433",
  17: "MY_919",
  18: "SG_923",
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

    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffSeconds < 30) return "[только что]";
    if (diffSeconds < 60) return `[${diffSeconds} сек назад]`;
    if (diffMinutes < 60) return `[${diffMinutes} мин назад]`;
    if (diffHours < 24) return `[${diffHours} ч назад]`;
    if (diffDays < 30) return `[${diffDays} дн назад]`;

    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `[${diffMonths} мес назад]`;

    const diffYears = Math.floor(diffDays / 365);
    return `[${diffYears} г назад]`;
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
const getRegionName = (region) => REGIONS[region] || `Unknown (${region})`;

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
        // Ищем данные gateway по его числовому ID
        const userData = await redis.getPortnumMessages(
          "NODEINFO_APP",
          numericId,
          1
        );

        if (userData && userData[0]) {
          const longName =
            userData[0].rawData?.longName || userData[0].rawData?.long_name;
          const shortName =
            userData[0].rawData?.shortName || userData[0].rawData?.short_name;

          gatewayInfoMap[gatewayId] = {
            idHex: gatewayId,
            numericId: numericId,
            longName: longName || gatewayId,
            shortName: shortName || "N/A",
          };
        } else {
          // Если нет данных о gateway, используем hex ID как название

          gatewayInfoMap[gatewayId] = {
            idHex: gatewayId,
            numericId: numericId,
            longName: gatewayId,
            shortName: gatewayId,
          };
        }
      } catch (error) {
        console.error(
          `Error getting gateway info for ${gatewayId}:`,
          error.message
        );
        // Создаем базовую информацию в случае ошибки
        gatewayInfoMap[gatewayId] = {
          idHex: gatewayId,
          numericId: toNumericId(gatewayId),
          longName: gatewayId,
          shortName: gatewayId,
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
      mapReportMessages,
      tracerouteMessages,
    ] = await Promise.all([
      redis.getPortnumMessages("NODEINFO_APP", numericId, 1),
      redis.getPortnumMessages("POSITION_APP", numericId, 1),
      redis.getPortnumMessages("TELEMETRY_APP", numericId, 1),
      redis.getPortnumMessages("TELEMETRY_APP", numericId, 1), // Environment metrics тоже в TELEMETRY_APP
      redis.getPortnumMessages("MAP_REPORT_APP", numericId, 1),
      redis.getPortnumMessages("TRACEROUTE_APP", numericId, 1),
    ]);

    // Получаем последние сообщения для истории
    const [
      userHistory,
      positionHistory,
      deviceMetricsHistory,
      envMetricsHistory,
      mapReportHistory,
      tracerouteHistory,
    ] = await Promise.all([
      redis.getPortnumMessages("NODEINFO_APP", numericId, 10),
      redis.getPortnumMessages("POSITION_APP", numericId, 10),
      redis.getPortnumMessages("TELEMETRY_APP", numericId, 10),
      redis.getPortnumMessages("TELEMETRY_APP", numericId, 10),
      redis.getPortnumMessages("MAP_REPORT_APP", numericId, 10),
      redis.getPortnumMessages("TRACEROUTE_APP", numericId, 10),
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
      mapReport: mapReportMessages[0] || null,
      traceroute: tracerouteMessages[0] || null,
      userData: dotData,
      gpsHistory: positionHistory,
      deviceMetricsHistory: deviceMetricsHistory,
      envMetricsHistory: envMetricsHistory,
      mapReportHistory: mapReportHistory,
      tracerouteHistory: tracerouteHistory,
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
    mapReport,
    traceroute,
    server,
    userData,
    gpsHistory,
    deviceMetricsHistory,
    envMetricsHistory,
    mapReportHistory,
    tracerouteHistory,
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
  const region = user?.data?.region || userData?.region;

  message += `👤 <b>Имя:</b> ${escapeHtml(longName)} (${escapeHtml(
    shortName
  )})\n`;
  const userFrom = user?.from || userData?.from || stats.numericId;
  message += `🆔 <b>ID:</b> ${escapeHtml(userFrom)}\n`;
  message += `🔧 <b>Модель:</b> ${escapeHtml(getHwModelName(hwModel))}\n`;
  message += `⚡ <b>Роль:</b> ${escapeHtml(getRoleName(role))}\n`;
  if (region !== undefined) {
    message += `🌍 <b>Регион:</b> ${escapeHtml(getRegionName(region))}\n`;
  }

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
    // Показываем только одно последнее сообщение
    const lastMsg = lastMessages[lastMessages.length - 1];
    const timeAgo = formatTimeAgo(
      lastMsg.serverTime || lastMsg.timestamp || lastMsg.rxTime
    );

    // Try different ways to get message text
    let messageText = "N/A";
    if (lastMsg.rawData?.text) {
      messageText = lastMsg.rawData.text;
    } else if (typeof lastMsg.data === "string") {
      messageText = lastMsg.data;
    } else if (lastMsg.data?.text) {
      messageText = lastMsg.data.text;
    } else if (lastMsg.text) {
      messageText = lastMsg.text;
    } else if (lastMsg.payload) {
      messageText = lastMsg.payload;
    }

    message += `📝 ${escapeHtml(messageText)} ${timeAgo}\n`;

    // Add Message RX information
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
  if (position?.rawData || gpsHistory.length > 0) {
    // message += `📍 <b>GPS данные:</b>\n`;
    const gpsData = position?.rawData || gpsHistory[0]?.rawData;
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
  if (deviceMetrics?.rawData || deviceMetricsHistory.length > 0) {
    const metrics = deviceMetrics?.rawData || deviceMetricsHistory[0]?.rawData;

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
        message += `🔋 <b>Батарея:</b> ${
          batteryLevel > 100 ? 100 : batteryLevel
        }%\n`;
      if (
        voltage !== undefined &&
        voltage !== null &&
        typeof voltage === "number"
      )
        message += `⚡ <b>Напряжение:</b> ${voltage.toFixed(1)}V\n`;
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

  // Environment metrics section - только если есть данные о температуре/влажности
  if (environmentMetrics?.rawData || envMetricsHistory.length > 0) {
    const env = environmentMetrics?.rawData || envMetricsHistory[0]?.rawData;
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

      // Показываем Environment RX только если есть реальные данные о температуре/влажности
      let hasEnvData = false;
      if (temperature !== undefined && temperature !== null) {
        message += `🌡️ <b>Температура:</b> ${temperature.toFixed(1)}°C\n`;
        hasEnvData = true;
      }
      if (relativeHumidity !== undefined && relativeHumidity !== null) {
        message += `💧 <b>Влажность:</b> ${relativeHumidity.toFixed(1)}%\n`;
        hasEnvData = true;
      }
      if (barometricPressure !== undefined && barometricPressure !== null) {
        message += `🌬️ <b>Давление:</b> ${barometricPressure.toFixed(1)} hPa\n`;
        hasEnvData = true;
      }
      if (gasResistance !== undefined && gasResistance !== null) {
        message += `🌫️ <b>Газы:</b> ${gasResistance.toFixed(0)} Ω\n`;
        hasEnvData = true;
      }

      // Add Environment RX information только если есть реальные данные
      if (hasEnvData) {
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
      }
    }
    message += `\n`;
  }

  // Map Report section
  if (mapReport?.rawData || mapReportHistory.length > 0) {
    const mapData = mapReport?.rawData || mapReportHistory[0]?.rawData;
    if (mapData) {
      message += `🗺️ <b>Map Report:</b>\n`;

      // Support both camelCase and snake_case field names
      // Map Report данные могут быть в decoded или напрямую
      const decodedData = mapData.decoded || mapData;
      const longName = decodedData.longName || decodedData.long_name;
      const shortName = decodedData.shortName || decodedData.short_name;
      const role = decodedData.role;
      const hwModel = decodedData.hwModel || decodedData.hw_model;
      const firmwareVersion =
        decodedData.firmwareVersion || decodedData.firmware_version;
      const region = decodedData.region;
      const modemPreset = decodedData.modemPreset || decodedData.modem_preset;
      const hasDefaultChannel =
        decodedData.hasDefaultChannel || decodedData.has_default_channel;
      const latitudeI = decodedData.latitudeI || decodedData.latitude_i;
      const longitudeI = decodedData.longitudeI || decodedData.longitude_i;
      const altitude = decodedData.altitude;
      const positionPrecision =
        decodedData.positionPrecision || decodedData.position_precision;
      const numOnlineLocalNodes =
        decodedData.numOnlineLocalNodes || decodedData.num_online_local_nodes;

      if (longName) message += `📝 <b>Имя:</b> ${escapeHtml(longName)}\n`;
      if (shortName)
        message += `🏷️ <b>Короткое имя:</b> ${escapeHtml(shortName)}\n`;
      if (role !== undefined)
        message += `⚡ <b>Роль:</b> ${escapeHtml(getRoleName(role))}\n`;
      if (hwModel !== undefined)
        message += `🔧 <b>Модель:</b> ${escapeHtml(getHwModelName(hwModel))}\n`;
      if (firmwareVersion)
        message += `💾 <b>Прошивка:</b> ${escapeHtml(firmwareVersion)}\n`;
      if (region !== undefined)
        message += `🌍 <b>Регион:</b> ${escapeHtml(getRegionName(region))}\n`;
      if (modemPreset !== undefined)
        message += `📡 <b>Модем:</b> ${modemPreset}\n`;
      if (hasDefaultChannel !== undefined)
        message += `🔐 <b>Канал по умолчанию:</b> ${
          hasDefaultChannel ? "Да" : "Нет"
        }\n`;

      if (latitudeI !== undefined && longitudeI !== undefined) {
        const lat = (latitudeI / 1e7).toFixed(6);
        const lon = (longitudeI / 1e7).toFixed(6);
        message += `📍 <b>Позиция:</b> <a href="https://yandex.ru/maps/?ll=${lon},${lat}&z=15&pt=${lon},${lat},pm2rdm">${lat}, ${lon}</a>\n`;
        if (altitude !== undefined && altitude !== 0) {
          message += `🏔️ <b>Высота:</b> ${altitude} м\n`;
        }
        if (positionPrecision !== undefined) {
          message += `🎯 <b>Точность:</b> ${positionPrecision} бит\n`;
        }
      }

      if (numOnlineLocalNodes !== undefined) {
        message += `👥 <b>Узлов рядом:</b> ${numOnlineLocalNodes}\n`;
      }

      // Add Map Report RX information
      const mapRxRssi = mapReport?.rxRssi;
      const mapRxSnr = mapReport?.rxSnr;
      const mapHop = mapReport?.hopLimit || mapReport?.hop;
      const mapGatewayId = mapReport?.gatewayId;
      const mapTimestamp = mapReport?.serverTime || mapReport?.timestamp;

      if (
        mapRxRssi &&
        mapRxSnr &&
        mapRxRssi !== "N/A" &&
        mapRxSnr !== "N/A" &&
        mapGatewayId
      ) {
        const gatewayInfo = gatewayInfoMap[mapGatewayId];
        if (gatewayInfo) {
          message += `🛰️ <b>Map Report RX:</b> ${escapeHtml(
            gatewayInfo.longName
          )} (${escapeHtml(gatewayInfo.idHex)}) `;
          const formattedMapHop = formatHopCount(mapHop);
          if (formattedMapHop) {
            message += `${formattedMapHop} `;
          }
          message += `RSSI/SNR: ${mapRxRssi}/${mapRxSnr}`;
          if (mapTimestamp) {
            message += ` ${formatTimeAgo(mapTimestamp)}`;
          }
          message += `\n`;
        }
      }
    }
    message += `\n`;
  }

  // Traceroute section - показываем всегда, когда есть данные
  if (traceroute?.rawData || tracerouteHistory.length > 0) {
    const traceData = traceroute?.rawData || tracerouteHistory[0]?.rawData;
    if (traceData) {
      message += `🛤️ <b>Traceroute:</b>\n`;

      // Добавляем от кого и кому
      const fromDevice = traceroute?.from || tracerouteHistory[0]?.from;
      const toDevice = traceroute?.to || tracerouteHistory[0]?.to;
      let fromHex, toHex;

      // Функция для получения отображаемого имени устройства
      const getDeviceDisplayName = async (deviceId) => {
        try {
          const deviceHex = `!${deviceId.toString(16).padStart(8, "0")}`;
          const deviceInfo = await getGatewayInfoBatch(redis, [deviceHex]);
          const info = deviceInfo[deviceHex];
          return info?.longName || deviceHex;
        } catch (error) {
          return `!${deviceId.toString(16).padStart(8, "0")}`;
        }
      };

      if (fromDevice && toDevice) {
        fromHex = `!${fromDevice.toString(16).padStart(8, "0")}`;
        toHex = `!${toDevice.toString(16).padStart(8, "0")}`;

        // Получаем отображаемые имена
        const fromDisplayName = await getDeviceDisplayName(fromDevice);
        const toDisplayName = await getDeviceDisplayName(toDevice);

        message += `📤 <b>От:</b> ${escapeHtml(
          fromDisplayName
        )} → <b>К:</b> ${escapeHtml(toDisplayName)}\n`;

        // Ищем обратный маршрут - Traceroute от toDevice к fromDevice
        try {
          const reverseTraceroute = await redis.getPortnumMessages(
            "TRACEROUTE_APP",
            toDevice,
            1
          );
          if (reverseTraceroute.length > 0) {
            const reverseData = reverseTraceroute[0];
            if (
              reverseData.from === toDevice &&
              reverseData.to === fromDevice
            ) {
              // Нашли обратный Traceroute
              const reverseRawData = reverseData.rawData;
              if (
                reverseRawData?.route_back &&
                Array.isArray(reverseRawData.route_back) &&
                reverseRawData.route_back.length > 0
              ) {
                // Есть обратный маршрут - сохраняем для отображения
                traceData.route_back = reverseRawData.route_back;
                traceData.snr_back = reverseRawData.snr_back;
              }
            }
          }
        } catch (error) {
          // Игнорируем ошибки поиска обратного маршрута
        }
      }

      // Support both camelCase and snake_case field names
      const dest = traceData.dest;
      const back = traceData.back;
      const wantResponse = traceData.wantResponse || traceData.want_response;
      const route = traceData.route;
      const error = traceData.error;
      const payloadSize = traceData.payloadSize;

      // Дополнительные поля для реальных Traceroute данных
      const snrTowards = traceData.snr_towards;
      const routeBack = traceData.route_back;
      const snrBack = traceData.snr_back;

      let hasTraceData = false;

      // Показываем информацию об ошибке, если есть
      if (error) {
        if (error === "Empty payload") {
          message += `⚠️ <b>Ошибка:</b> Нет обратного пинга\n`;
        } else {
          message += `⚠️ <b>Ошибка:</b> ${escapeHtml(error)}\n`;
        }
      }

      if (dest !== undefined) {
        const destHex = `!${dest.toString(16).padStart(8, "0")}`;
        message += `🎯 <b>Назначение:</b> ${escapeHtml(destHex)}\n`;
        hasTraceData = true;
      }

      if (back !== undefined) {
        const backHex = `!${back.toString(16).padStart(8, "0")}`;
        message += `🔙 <b>Обратно:</b> ${escapeHtml(backHex)}\n`;
        hasTraceData = true;
      }

      if (wantResponse !== undefined) {
        message += `❓ <b>Ожидает ответ:</b> ${wantResponse ? "Да" : "Нет"}\n`;
        hasTraceData = true;
      }

      // Отображаем маршрут с SNR данными
      if (
        route &&
        Array.isArray(route) &&
        route.length > 0 &&
        snrTowards &&
        Array.isArray(snrTowards) &&
        snrTowards.length > 0
      ) {
        message += `🗺️ <b>Туда:</b> `;
        const routeParts = [];

        // Добавляем источник с иконкой и ссылкой
        const fromDeviceIdForUrl = fromDevice.toString(16).padStart(8, "0");
        const fromDisplayName = await getDeviceDisplayName(fromDevice);
        routeParts.push(
          ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${fromDeviceIdForUrl}">${escapeHtml(
            fromDisplayName
          )}</a>`
        );

        // Добавляем промежуточные узлы с SNR, иконками и ссылками
        for (let index = 0; index < route.length; index++) {
          const nodeId = route[index];
          const nodeHex = `!${nodeId.toString(16).padStart(8, "0")}`;
          const nodeDeviceIdForUrl = nodeId.toString(16).padStart(8, "0");
          const nodeDisplayName = await getDeviceDisplayName(nodeId);
          const snr = snrTowards[index];
          if (snr !== undefined) {
            routeParts.push(
              ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${nodeDeviceIdForUrl}">${escapeHtml(
                nodeDisplayName
              )}(${snr}dB)</a>`
            );
          } else {
            routeParts.push(
              ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${nodeDeviceIdForUrl}">${escapeHtml(
                nodeDisplayName
              )}</a>`
            );
          }
        }

        // Добавляем назначение с иконкой и ссылкой
        const toDeviceIdForUrl = toDevice.toString(16).padStart(8, "0");
        const toDisplayName = await getDeviceDisplayName(toDevice);
        routeParts.push(
          ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${toDeviceIdForUrl}">${escapeHtml(
            toDisplayName
          )}</a>`
        );

        message += routeParts.join(" → ") + "\n";
        hasTraceData = true;
      } else if (route && Array.isArray(route) && route.length > 0) {
        // Fallback если нет SNR данных
        message += `🗺️ <b>Туда:</b> `;
        const routeParts = [];

        // Добавляем источник с иконкой и ссылкой
        const fromDeviceIdForUrl = fromDevice.toString(16).padStart(8, "0");
        const fromDisplayName = await getDeviceDisplayName(fromDevice);
        routeParts.push(
          ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${fromDeviceIdForUrl}">${escapeHtml(
            fromDisplayName
          )}</a>`
        );

        // Добавляем промежуточные узлы с иконками и ссылками
        for (const nodeId of route) {
          const nodeHex = `!${nodeId.toString(16).padStart(8, "0")}`;
          const nodeDeviceIdForUrl = nodeId.toString(16).padStart(8, "0");
          const nodeDisplayName = await getDeviceDisplayName(nodeId);
          routeParts.push(
            ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${nodeDeviceIdForUrl}">${escapeHtml(
              nodeDisplayName
            )}</a>`
          );
        }

        // Добавляем назначение с иконкой и ссылкой
        const toDeviceIdForUrl = toDevice.toString(16).padStart(8, "0");
        const toDisplayName = await getDeviceDisplayName(toDevice);
        routeParts.push(
          ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${toDeviceIdForUrl}">${escapeHtml(
            toDisplayName
          )}</a>`
        );

        message += routeParts.join(" → ") + "\n";
        hasTraceData = true;
      }

      // Отображаем обратный маршрут с SNR данными
      if (routeBack && Array.isArray(routeBack) && routeBack.length > 0) {
        message += `🔙 <b>Обратно:</b> `;
        if (snrBack && Array.isArray(snrBack) && snrBack.length > 0) {
          // Есть SNR - показываем маршрут с SNR
          const routeParts = [];

          // Добавляем назначение (бывший источник) с иконкой и ссылкой
          const toDeviceIdForUrl = toDevice.toString(16).padStart(8, "0");
          const toDisplayName = await getDeviceDisplayName(toDevice);
          routeParts.push(
            ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${toDeviceIdForUrl}">${escapeHtml(
              toDisplayName
            )}</a>`
          );

          // Добавляем промежуточные узлы с SNR, иконками и ссылками
          for (let index = 0; index < routeBack.length; index++) {
            const nodeId = routeBack[index];
            const nodeHex = `!${nodeId.toString(16).padStart(8, "0")}`;
            const nodeDeviceIdForUrl = nodeId.toString(16).padStart(8, "0");
            const nodeDisplayName = await getDeviceDisplayName(nodeId);
            const snr = snrBack[index];
            if (snr !== undefined) {
              routeParts.push(
                ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${nodeDeviceIdForUrl}">${escapeHtml(
                  nodeDisplayName
                )}(${snr}dB)</a>`
              );
            } else {
              routeParts.push(
                ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${nodeDeviceIdForUrl}">${escapeHtml(
                  nodeDisplayName
                )}</a>`
              );
            }
          }

          // Добавляем источник (бывшее назначение) с иконкой и ссылкой
          const fromDeviceIdForUrl = fromDevice.toString(16).padStart(8, "0");
          const fromDisplayName = await getDeviceDisplayName(fromDevice);
          routeParts.push(
            ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${fromDeviceIdForUrl}">${escapeHtml(
              fromDisplayName
            )}</a>`
          );

          message += routeParts.join(" → ") + "\n";
        } else {
          // Нет SNR - показываем только маршрут
          const routeParts = [];

          // Добавляем назначение (бывший источник) с иконкой и ссылкой
          const toDeviceIdForUrl = toDevice.toString(16).padStart(8, "0");
          const toDisplayName = await getDeviceDisplayName(toDevice);
          routeParts.push(
            ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${toDeviceIdForUrl}">${escapeHtml(
              toDisplayName
            )}</a>`
          );

          // Добавляем промежуточные узлы с иконками и ссылками
          for (const nodeId of routeBack) {
            const nodeHex = `!${nodeId.toString(16).padStart(8, "0")}`;
            const nodeDeviceIdForUrl = nodeId.toString(16).padStart(8, "0");
            const nodeDisplayName = await getDeviceDisplayName(nodeId);
            routeParts.push(
              ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${nodeDeviceIdForUrl}">${escapeHtml(
                nodeDisplayName
              )}</a>`
            );
          }

          // Добавляем источник (бывшее назначение) с иконкой и ссылкой
          const fromDeviceIdForUrl = fromDevice.toString(16).padStart(8, "0");
          const fromDisplayName = await getDeviceDisplayName(fromDevice);
          routeParts.push(
            ` <a href="https://t.me/MeshtasticTaubeteleComBot?start=${fromDeviceIdForUrl}">${escapeHtml(
              fromDisplayName
            )}</a>`
          );

          message += routeParts.join(" → ") + "\n";
        }
        hasTraceData = true;
      } else if (snrBack && Array.isArray(snrBack) && snrBack.length > 0) {
        // Fallback если нет маршрута, но есть SNR - показываем только SNR
        message += `🔙 <b>SNR обратно:</b> ${snrBack
          .map((snr) => `${snr}dB`)
          .join(", ")}\n`;
        hasTraceData = true;
      }

      // Показываем Traceroute RX если есть данные или если есть ошибка
      if (hasTraceData || error) {
        // Add Traceroute RX information
        const traceRxRssi = traceroute?.rxRssi;
        const traceRxSnr = traceroute?.rxSnr;
        const traceHop = traceroute?.hopLimit || traceroute?.hop;
        const traceGatewayId = traceroute?.gatewayId;
        const traceTimestamp = traceroute?.serverTime || traceroute?.timestamp;

        // if (
        //   traceRxRssi &&
        //   traceRxSnr &&
        //   traceRxRssi !== "N/A" &&
        //   traceRxSnr !== "N/A" &&
        //   traceGatewayId
        // ) {
        //   const gatewayInfo = gatewayInfoMap[traceGatewayId];
        //   if (gatewayInfo) {
        //     message += `🛰️ <b>Traceroute RX:</b> ${escapeHtml(
        //       gatewayInfo.longName
        //     )} (${escapeHtml(gatewayInfo.idHex)}) `;
        //     const formattedTraceHop = formatHopCount(traceHop);
        //     if (formattedTraceHop) {
        //       message += `${formattedTraceHop} `;
        //     }
        //     message += `RSSI/SNR: ${traceRxRssi}/${traceRxSnr}`;
        //     if (traceTimestamp) {
        //       message += ` ${formatTimeAgo(traceTimestamp)}`;
        //     }
        //     message += `\n`;
        //   }
        // }
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
  if (!topic) return null; // Если нет топика, возвращаем null
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
    console.log(`🔍 Getting gateway info for: ${gatewayIds.join(", ")}`);
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

    let message = `${escapeHtml(messageText)}`;

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
      message += ` (<b></b> ${escapeHtml(senderInfo.longName)} (${escapeHtml(
        senderId
      )}) <a href="https://t.me/MeshtasticTaubeteleComBot?start=${deviceIdForUrl}">📊</a>)`;
    } else if (senderId) {
      const deviceIdForUrl = senderId ? senderId.substring(1) : "";
      message += ` (<b></b> Ноунейм) (${escapeHtml(
        senderId
      )}) <a href="https://t.me/MeshtasticTaubeteleComBot?start=${deviceIdForUrl}">📊</a>`;
    }

    message += `\n\n<blockquote expandable>Получено шлюзами <b>(${gateways.length}):</b>\n`;
    gateways.forEach(([gatewayId, info]) => {
      const gateway = gatewayInfoMap[gatewayId];
      message += `📡 ${escapeHtml(
        gateway?.longName || "Unknown"
      )} (${escapeHtml(gatewayId)})`;

      // Check if RSSI or SNR is 0, then show MQTT instead of values
      if (info.rxRssi === 0 || info.rxSnr === 0) {
        message += ` MQTT`;
      } else {
        if (info.rxRssi !== undefined) message += ` ${info.rxRssi}dBm`;
        if (info.rxSnr !== undefined) message += `/${info.rxSnr}SNR`;
        const formattedHop = formatHopCount(info.hopLimit);
        if (formattedHop) message += `/${formattedHop}`;
      }

      message += `\n`;
    });
    message += `</blockquote>`;

    await sendTelegramMessage(message, group.channelId);
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
    const targetChannelId = channelId || botSettings.MAIN_CHANNEL_ID;
    console.log(`📨 Sending message to Telegram channel ${targetChannelId}`);
    await bot.telegram.sendMessage(targetChannelId, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    console.log(`✅ Message sent to Telegram successfully`);
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

// Send personal message to a user by ID
const sendPersonalMessage = async (userId, message) => {
  if (!bot || !botSettings.ENABLE) return false;

  try {
    console.log(`📨 Sending personal message to user ID ${userId}`);
    await bot.telegram.sendMessage(userId, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    console.log(`✅ Personal message sent to user ID ${userId} successfully`);
    return true;
  } catch (error) {
    console.error(
      `Error sending personal message to user ID ${userId}:`,
      error.message
    );
    // Fallback: send without formatting
    try {
      await bot.telegram.sendMessage(userId, message.replace(/<[^>]*>/g, ""), {
        disable_web_page_preview: true,
      });
      console.log(
        `✅ Personal message sent to user ID ${userId} (fallback) successfully`
      );
      return true;
    } catch (fallbackError) {
      console.error(
        `Error sending fallback personal message to user ID ${userId}:`,
        fallbackError.message
      );
      return false;
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
// Only process messages sent to all devices (to === 4294967295)
export const handleTelegramMessage = async (
  redis,
  server,
  fullTopic,
  event
) => {
  if (
    !server.telegram ||
    !isAllowedTopic(fullTopic) ||
    event.type !== "broadcast" ||
    event.to !== 4294967295
  ) {
    return;
  }

  const messageKey = `${event.id}_${event.gatewayId}_${server.name}`;
  if (processedMessages.has(messageKey)) return;

  processedMessages.add(messageKey);

  const messageId = event.id;
  const gatewayId = event.gatewayId;

  if (!messageGroups.has(messageId)) {
    const channelId = getChannelIdByTopic(fullTopic);
    if (!channelId) {
      console.log(`❌ No valid channel found for topic: ${fullTopic}`);
      return;
    }
    messageGroups.set(messageId, {
      event: event,
      gateways: new Map(),
      timeout: null,
      channelId: channelId,
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
  }

  if (group.timeout) {
    clearTimeout(group.timeout);
  }

  group.timeout = setTimeout(() => {
    sendGroupedMessage(redis, messageId);
  }, MESSAGE_GROUP_TIMEOUT);
};

/**
 * Очищает интервалы и ресурсы Telegram модуля
 */
export function cleanupTelegramResources() {
  if (messageCleanupInterval) {
    clearInterval(messageCleanupInterval);
    console.log("✅ Интервал очистки сообщений Telegram остановлен");
  }

  // Очищаем Maps
  messageGroups.clear();
  processedMessages.clear();

  console.log("✅ Ресурсы Telegram модуля очищены");
}

// Экспортируем функции для тестирования
export {
  getDeviceStats,
  getGatewayInfoBatch,
  toNumericId,
  formatDeviceStats,
  sendPersonalMessage,
};
