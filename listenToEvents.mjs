import mqtt from "mqtt";
import {
  decodeServiceEnvelope,
  processDecodedPacket,
} from "./protobufDecoder.mjs";

const MIN_LOG_LEVEL = 10;
const RECONNECT_DELAY = 5000;
const MAX_RECONNECT_ATTEMPTS = 5;

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
    "index out of range",
    "invalid wire type",
  ];

  return !suppressedErrors.some((error) => errorMessage.includes(error));
};

const isValidPacket = (arrayBuffer) => {
  if (!arrayBuffer || arrayBuffer.length === 0) return false;
  if (arrayBuffer.length < 4) return false;

  try {
    // Basic validation - check if it starts with valid protobuf markers
    const view = new DataView(arrayBuffer.buffer || arrayBuffer);
    const firstByte = view.getUint8(0);

    // Protobuf messages typically start with field numbers 1-15 (0x08-0x78)
    return firstByte >= 0x08 && firstByte <= 0x78;
  } catch {
    return false;
  }
};

const handleProtobufServiceEnvelopePacket = async (
  server,
  fullTopic,
  user,
  arrayBuffer,
  callback
) => {
  try {
    // Validate packet before processing
    if (!isValidPacket(arrayBuffer)) {
      return;
    }

    const serviceEnvelope = await decodeServiceEnvelope(arrayBuffer);

    if (!serviceEnvelope?.packet) {
      return;
    }

    const meshPacket = serviceEnvelope.packet;
    const { channelId, gatewayId } = serviceEnvelope;

    // Debug logging for specific gateway
    if (gatewayId === "!088aa170") {
      console.log(
        "Raw message from gateway:",
        server.address,
        fullTopic,
        user,
        { channelId, gatewayId }
      );
    }

    const additionalInfo = {
      mqttChannel: fullTopic,
      // mqttUser убран
      gatewayId,
      channelId,
    };

    // Обрабатываем декодированный пакет
    const event = processDecodedPacket(meshPacket, additionalInfo);

    if (event) {
      // Определяем тип события для совместимости с существующим кодом
      let eventName = "onMessagePacket";
      let eventType = event.messageType;

      switch (event.messageType) {
        case "text":
          eventName = "onMessagePacket";
          eventType = "message";
          break;
        case "position":
          eventName = "onPositionPacket";
          eventType = "position";
          break;
        case "user":
          eventName = "onUserPacket";
          eventType = "user";
          break;
        case "telemetry":
          eventName = "onTelemetryPacket";
          eventType = "telemetry";
          break;
        case "neighborInfo":
          eventName = "onNeighborInfoPacket";
          eventType = "neighborInfo";
          break;
        default:
          eventName = "onMessagePacket";
          eventType = event.messageType;
      }

      // Вызываем callback с обработанным событием
      callback(server, fullTopic, user, eventName, eventType, event);
    }
  } catch (error) {
    // Suppress common protobuf parsing errors
    if (shouldLogError(error.message)) {
      console.error(
        "Error handling protobuf service envelope packet:",
        error.message
      );
    }
  }
};

const connectToMqtt = (server, callback) => {
  const clientId = `mqtt_${Math.random().toString(16).substr(2, 8)}`;
  let reconnectAttempts = 0;

  const createConnection = () => {
    const client = mqtt.connect(server.address, {
      clientId,
      reconnectPeriod: RECONNECT_DELAY,
      connectTimeout: 30000,
      keepalive: 60,
    });

    const topics = [
      "msh/+/2/map/",
      "msh/+/2/e/+/+",
      "msh/+/+/2/map/",
      "msh/+/+/2/e/+/+",
      "msh/+/+/+/2/map/",
      "msh/+/+/+/2/e/+/+",
      "msh/+/+/+/+/2/map/",
      "msh/+/+/+/+/2/e/+/+",
    ];

    client.on("connect", () => {
      console.log(`Connected to MQTT server: ${server.name}`);
      reconnectAttempts = 0;

      client.subscribe(topics, (err) => {
        if (!err) {
          console.log(`Subscribed to topics on ${server.name}`);
        } else {
          console.error(`Subscription error on ${server.name}:`, err.message);
        }
      });
    });

    client.on("message", async (topic, payload, packet) => {
      try {
        const topicParts = topic.split("/");
        if (topicParts.length < 3) return;

        const [, , type, channel, user] = topicParts;

        // Skip status messages
        if (type === "stat") return;

        // Handle JSON messages
        if (type === "json") {
          try {
            const jsonData = JSON.parse(payload.toString());
            console.log("JSON message:", topic, jsonData);
            callback(server, topic, user, "json", "json", jsonData);
          } catch (parseError) {
            console.error("Failed to parse JSON message:", parseError.message);
          }
          return;
        }

        // Handle protobuf messages
        if (payload && payload.length > 0) {
          await handleProtobufServiceEnvelopePacket(
            server,
            topic,
            user,
            new Uint8Array(payload),
            callback
          );
        }
      } catch (error) {
        // Only log significant errors
        if (shouldLogError(error.message)) {
          console.error(
            `Error processing message from ${server.name}:`,
            error.message
          );
        }
      }
    });

    client.on("error", (error) => {
      console.error(`MQTT error on ${server.name}:`, error.message);

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(
          `Attempting to reconnect to ${server.name} (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
        );
      } else {
        console.error(`Max reconnection attempts reached for ${server.name}`);
        client.end();
      }
    });

    client.on("close", () => {
      console.log(`Connection closed to ${server.name}`);
    });

    client.on("offline", () => {
      console.log(`Client offline for ${server.name}`);
    });

    return client;
  };

  return createConnection();
};

export const listenToEvents = async (serversConfig, callback) => {
  console.log(`Establishing ${serversConfig.length} server connections`);

  const connections = serversConfig
    .map((server) => {
      try {
        if (server.type === "mqtt") {
          return connectToMqtt(server, callback);
        } else {
          console.warn("Unsupported server config:", server);
          return null;
        }
      } catch (error) {
        if (shouldLogError(error.message)) {
          console.error(`Failed to connect to ${server.name}:`, error.message);
        }
        return null;
      }
    })
    .filter(Boolean);

  // Graceful shutdown handling
  const gracefulShutdown = () => {
    console.log("Shutting down connections...");
    connections.forEach((client) => {
      if (client && typeof client.end === "function") {
        client.end();
      }
    });
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  return connections;
};
