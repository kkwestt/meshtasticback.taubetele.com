import { Telegraf } from "telegraf";
import { botSettings } from "./config.mjs";

const MESSAGE_GROUP_TIMEOUT = 7000;

let bot = null;
if (botSettings.ENABLE && botSettings.BOT_TOKEN) {
  bot = new Telegraf(botSettings.BOT_TOKEN);
  console.log("Telegram bot initialized");
}

const messageGroups = new Map();
const processedMessages = new Set();

// Cleanup processed messages every 10 minutes
setInterval(() => processedMessages.clear(), 10 * 60 * 1000);

// Hardware models map
const HW_MODELS = {
  1: "TLORA V2",
  2: "TLORA V1",
  3: "TLORA V2.1 1.6",
  4: "TBEAM",
  5: "HELTEC V2.0",
  6: "T-BEAM 0.7",
  7: "T-ECHO",
  8: "TLORA V1.1.3",
  9: "RAK4631",
  10: "HELTEC V2.1",
  11: "HELTEC V1",
  12: "LILYGO TBEAM S3 CORE",
  13: "RAK11200",
  14: "NANO_G1",
  15: "TLORA V2.1.1.8",
  16: "TLORA T3 S3",
  17: "NANO G1 EXPLORER",
  18: "NANO G2 ULTRA",
  19: "HELTEC V3",
  20: "HELTEC WSL V3",
  21: "BETAFPV 2400 TX",
  22: "BETAFPV 900 NANO TX",
  23: "RPI PICO",
  24: "HELTEC WIRELESS TRACKER",
  25: "HELTEC WIRELESS PAPER",
  26: "T DECK",
  27: "T WATCH S3",
  28: "PICOMPUTER S3",
  29: "HELTEC HT62",
  30: "EBYTE ESP32 S3",
  31: "ESP32 S3 PICO",
  32: "CHATTER 2",
  33: "HELTEC WIRELESS PAPER V1.0",
  34: "HELTEC WIRELESS TRACKER V1.0",
  35: "UNPHONE",
  36: "TD LORAC",
  37: "CDEBYTE EORA S3",
  38: "TWC MESH V4",
  39: "NRF52 UNKNOWN",
  40: "PORTDUINO",
  41: "ANDROID SIM",
  42: "DIY V1",
  43: "NRF52840 PCA10059",
  44: "DR DEV",
  45: "M5STACK",
  46: "M5STACK CORE2",
  47: "M5STACK M5STICKC",
  48: "M5STACK M5STICKC_PLUS",
  49: "M5STACK M5STACK_CORE_INK",
  50: "M5STACK M5PAPER",
  51: "M5STACK M5STATION",
  52: "M5STACK M5ATOM",
  53: "M5STACK M5NANO",
  54: "PRIVATE HW",
  255: "UNSET",
};

const ROLES = {
  0: "CLIENT",
  1: "CLIENT MUTE",
  2: "ROUTER",
  3: "ROUTER CLIENT",
  4: "REPEATER",
  5: "TRACKER",
  6: "SENSOR",
  7: "TAK",
  8: "CLIENT HIDDEN",
  9: "LOST AND FOUND",
  10: "TAK TRACKER",
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
  if (!timestamp) return "";
  const diffMs = Date.now() - new Date(timestamp);
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return "[только что]";
  if (diffMinutes < 60) return `[${diffMinutes} мин назад]`;
  if (diffHours < 24) return `[${diffHours} ч назад]`;
  return `[${diffDays} дн назад]`;
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

// Batch gateway info retrieval
const getGatewayInfoBatch = async (redis, gatewayIds) => {
  if (!gatewayIds?.length) return {};

  try {
    const gatewayInfoMap = {};
    const promises = [];
    const gatewayIdsList = [];

    for (const gatewayId of gatewayIds) {
      if (!gatewayId) continue;
      const numericId = toNumericId(gatewayId);
      gatewayIdsList.push(gatewayId);
      promises.push(
        redis.hgetall(`device:${numericId}`),
        redis.hgetall(`user:${numericId}`)
      );
    }

    const results = await Promise.all(promises);
    let resultIndex = 0;

    for (const gatewayId of gatewayIdsList) {
      const deviceData = results[resultIndex] || {};
      const userData = results[resultIndex + 1] || {};
      resultIndex += 2;

      let longName = "";
      if (deviceData?.user) {
        const gatewayUser = safeJsonParse(deviceData.user);
        longName = gatewayUser?.data?.longName || "";
      }
      if (!longName && userData?.longName) {
        longName = userData.longName;
      }

      gatewayInfoMap[gatewayId] = {
        longName: longName || "Unknown",
        idHex: gatewayId,
      };
    }

    return gatewayInfoMap;
  } catch (error) {
    console.error("Error getting gateway info batch:", error.message);
    return {};
  }
};

// Get device statistics
const getDeviceStats = async (redis, deviceId) => {
  try {
    const numericId = toNumericId(deviceId);

    const [
      deviceData,
      userData,
      gpsData,
      deviceMetricsData,
      envMetricsData,
      messagesData,
    ] = await Promise.all([
      redis.hgetall(`device:${numericId}`).catch(() => ({})),
      redis.hgetall(`user:${numericId}`).catch(() => ({})),
      redis.lrange(`gps:${numericId}`, -1, -1).catch(() => []),
      redis.lrange(`deviceMetrics:${numericId}`, -1, -1).catch(() => []),
      redis.lrange(`environmentMetrics:${numericId}`, -1, -1).catch(() => []),
      redis.lrange(`message:${numericId}`, -1, -1).catch(() => []),
    ]);

    if (!deviceData && !userData) return null;

    const parseData = (data) =>
      data.map((item) => safeJsonParse(item)).filter(Boolean);

    return {
      deviceId,
      numericId,
      user: safeJsonParse(deviceData.user),
      position: safeJsonParse(deviceData.position),
      deviceMetrics: safeJsonParse(deviceData.deviceMetrics),
      environmentMetrics: safeJsonParse(deviceData.environmentMetrics),
      lastSeen: deviceData.timestamp ? new Date(deviceData.timestamp) : null,
      server: deviceData.server || "Unknown",
      userData,
      gpsHistory: parseData(gpsData),
      deviceMetricsHistory: parseData(deviceMetricsData),
      envMetricsHistory: parseData(envMetricsData),
      lastMessages: parseData(messagesData),
    };
  } catch (error) {
    console.error("Error getting device stats:", error.message);
    return null;
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
    lastSeen,
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

  // NodeInfo section
  const longName = user?.data?.longName || userData?.longName || "Unknown";
  const shortName = user?.data?.shortName || userData?.shortName || "N/A";
  const hwModel = user?.data?.hwModel || userData?.hwModel || 255;
  const role = user?.data?.role || userData?.role || 0;

  message += `👤 <b>Имя:</b> ${escapeHtml(longName)} (${escapeHtml(
    shortName
  )})\n`;
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
        if (nodeHop && nodeHop !== "N/A" && nodeHop !== null) {
          message += `Hop: ${nodeHop} `;
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
      const timeAgo = formatTimeAgo(msg.serverTime);
      message += `📝 "${escapeHtml(msg.data?.text || "N/A")}" ${timeAgo}\n`;
      if (gateway)
        message += `   📡 ${escapeHtml(gateway.longName)} (${escapeHtml(
          msg.gatewayId
        )})\n`;
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
        if (
          lastMsg.hopLimit &&
          lastMsg.hopLimit !== "N/A" &&
          lastMsg.hopLimit !== null
        ) {
          message += `Hop: ${lastMsg.hopLimit} `;
        }
        message += `RSSI/SNR: ${lastMsg.rxRssi}/${lastMsg.rxSnr}`;
        if (lastMsg.serverTime) {
          message += ` ${formatTimeAgo(lastMsg.serverTime)}`;
        }
        message += `\n`;
      }
    }
    message += "\n";
  }

  // GPS section
  if (position?.data || gpsHistory.length > 0) {
    message += `📍 <b>GPS данные:</b>\n`;
    const gpsData = position?.data || gpsHistory[0];
    if (
      gpsData &&
      gpsData.latitudeI !== undefined &&
      gpsData.longitudeI !== undefined
    ) {
      const lat = (gpsData.latitudeI / 1e7).toFixed(6);
      const lon = (gpsData.longitudeI / 1e7).toFixed(6);
      message += `🌍 <b>Координаты:</b><a href="https://yandex.ru/maps/?ll=${lon},${lat}&z=15&pt=${lon},${lat},pm2rdm">${lat}, ${lon}</a>\n`;
      if (gpsData.altitude !== undefined && gpsData.altitude !== 0)
        message += `🏔️ <b>Высота:</b> ${gpsData.altitude} м\n`;
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
        if (posHop && posHop !== "N/A" && posHop !== null) {
          message += `Hop: ${posHop} `;
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
    message += `🔋 <b>Метрики устройства:</b>\n`;
    const metrics = deviceMetrics?.data || deviceMetricsHistory[0];
    if (metrics) {
      if (metrics.batteryLevel !== undefined)
        message += `🔋 <b>Батарея:</b> ${metrics.batteryLevel}%\n`;
      if (metrics.voltage !== undefined)
        message += `⚡ <b>Напряжение:</b> ${metrics.voltage}V\n`;
      if (metrics.channelUtilization !== undefined)
        message += `📶 <b>Канал:</b> ${metrics.channelUtilization}%\n`;
      if (metrics.airUtilTx !== undefined)
        message += `📡 <b>Air TX:</b> ${metrics.airUtilTx}%\n`;
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
        if (devHop && devHop !== "N/A" && devHop !== null) {
          message += `Hop: ${devHop} `;
        }
        message += `RSSI/SNR: ${devRxRssi}/${devRxSnr}`;
        if (devTimestamp) {
          message += ` ${formatTimeAgo(devTimestamp)}`;
        }
        message += `\n`;
      }
    }
    message += `\n`;
  }

  // Environment metrics section
  if (environmentMetrics?.data || envMetricsHistory.length > 0) {
    message += `🌡️ <b>Метрики окружающей среды:</b>\n`;
    const env = environmentMetrics?.data || envMetricsHistory[0];
    if (env) {
      if (env.temperature !== undefined)
        message += `🌡️ <b>Температура:</b> ${env.temperature}°C\n`;
      if (env.relativeHumidity !== undefined)
        message += `💧 <b>Влажность:</b> ${env.relativeHumidity}%\n`;
      if (env.barometricPressure !== undefined)
        message += `🌬️ <b>Давление:</b> ${env.barometricPressure} hPa\n`;
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
        if (envHop && envHop !== "N/A" && envHop !== null) {
          message += `Hop: ${envHop} `;
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

  message += `\n🌐 <b>Сервер:</b> ${escapeHtml(server)}\n`;
  if (lastSeen)
    message += `⏰ <b>Последняя активность:</b> ${formatTimeAgo(lastSeen)}\n`;

  return message;
};

// Check if topic is allowed for Telegram notifications
const isAllowedTopic = (topic) => {
  if (!topic) return false;
  const allowedPrefixes = ["msh/msk/", "msh/RU/", "msh/EU_868/", "msh/EU_433/"];
  return allowedPrefixes.some((prefix) => topic.startsWith(prefix));
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

    // Build message
    let message = `💬 <b>Сообщение:</b> "${escapeHtml(
      event.data?.text || "N/A"
    )}"`;

    const fromGateway = gatewayInfoMap[event.gatewayId];
    if (fromGateway) {
      message += `\n👤 <b>От:</b> ${escapeHtml(
        fromGateway.longName
      )} (${escapeHtml(event.gatewayId)})`;
    }

    if (gateways.length > 1) {
      message += `\n📡 <b>Получено шлюзами (${gateways.length}):</b>\n`;
      gateways.forEach(([gatewayId, info]) => {
        const gateway = gatewayInfoMap[gatewayId];
        message += `• ${escapeHtml(
          gateway?.longName || "Unknown"
        )} (${escapeHtml(gatewayId)})`;
        if (info.rxRssi !== undefined) message += ` - ${info.rxRssi}dBm`;
        if (info.rxSnr !== undefined) message += `/${info.rxSnr}SNR`;
        if (info.hopLimit !== undefined) message += `/${info.hopLimit}hop`;
        message += `\n`;
      });
    }

    await sendTelegramMessage(message);
    console.log(`Telegram message sent successfully for group ${messageId}`);
  } catch (error) {
    console.error("Error sending grouped message:", error.message);
  } finally {
    messageGroups.delete(messageId);
  }
};

// Send message to Telegram with error handling
const sendTelegramMessage = async (message) => {
  if (!bot || !botSettings.ENABLE) return;

  try {
    await bot.telegram.sendMessage(botSettings.CHANNEL_ID, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.error("Error sending telegram message:", error.message);
    // Fallback: send without formatting
    try {
      await bot.telegram.sendMessage(
        botSettings.CHANNEL_ID,
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
