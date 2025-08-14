import protobuf from "protobufjs";

// Define protobuf schemas
const serviceEnvelopeSchema = {
  nested: {
    ServiceEnvelope: {
      fields: {
        packet: {
          type: "MeshPacket",
          id: 1,
        },
        channelId: {
          type: "string",
          id: 2,
        },
        gatewayId: {
          type: "string",
          id: 3,
        },
      },
    },
    MeshPacket: {
      fields: {
        from: {
          type: "uint32",
          id: 1,
        },
        to: {
          type: "uint32",
          id: 2,
        },
        channel: {
          type: "uint32",
          id: 3,
        },
        decoded: {
          type: "Data",
          id: 4,
        },
        encrypted: {
          type: "bytes",
          id: 5,
        },
        id: {
          type: "uint32",
          id: 6,
        },
        rxTime: {
          type: "uint32",
          id: 7,
        },
        rxSnr: {
          type: "float",
          id: 8,
        },
        hopLimit: {
          type: "uint32",
          id: 9,
        },
        wantAck: {
          type: "bool",
          id: 10,
        },
        priority: {
          type: "uint32",
          id: 11,
        },
        rxRssi: {
          type: "int32",
          id: 12,
        },
        delayed: {
          type: "uint32",
          id: 13,
        },
      },
    },
    Data: {
      fields: {
        portnum: {
          type: "uint32",
          id: 1,
        },
        payload: {
          type: "bytes",
          id: 2,
        },
        wantResponse: {
          type: "bool",
          id: 3,
        },
        dest: {
          type: "uint32",
          id: 4,
        },
        source: {
          type: "uint32",
          id: 5,
        },
        requestId: {
          type: "uint32",
          id: 6,
        },
        replyId: {
          type: "uint32",
          id: 7,
        },
        emoji: {
          type: "uint32",
          id: 8,
        },
      },
    },
    Position: {
      fields: {
        latitude_i: {
          type: "sfixed32",
          id: 1,
        },
        longitude_i: {
          type: "sfixed32",
          id: 2,
        },
        altitude: {
          type: "int32",
          id: 3,
        },
        time: {
          type: "fixed32",
          id: 4,
        },
        location_source: {
          type: "uint32",
          id: 5,
        },
        altitude_source: {
          type: "uint32",
          id: 6,
        },
        timestamp: {
          type: "fixed32",
          id: 7,
        },
        timestamp_millis_adjust: {
          type: "int32",
          id: 8,
        },
        altitude_hae: {
          type: "sint32",
          id: 9,
        },
        altitude_geoidal_separation: {
          type: "sint32",
          id: 10,
        },
        PDOP: {
          type: "uint32",
          id: 11,
        },
        HDOP: {
          type: "uint32",
          id: 12,
        },
        VDOP: {
          type: "uint32",
          id: 13,
        },
        gps_accuracy: {
          type: "uint32",
          id: 14,
        },
        ground_speed: {
          type: "uint32",
          id: 15,
        },
        ground_track: {
          type: "uint32",
          id: 16,
        },
        fix_quality: {
          type: "uint32",
          id: 17,
        },
        fix_type: {
          type: "uint32",
          id: 18,
        },
        sats_in_view: {
          type: "uint32",
          id: 19,
        },
        sensor_id: {
          type: "uint32",
          id: 20,
        },
        next_update: {
          type: "uint32",
          id: 21,
        },
        seq_number: {
          type: "uint32",
          id: 22,
        },
        precision_bits: {
          type: "uint32",
          id: 23,
        },
      },
    },
    User: {
      fields: {
        id: {
          type: "string",
          id: 1,
        },
        long_name: {
          type: "string",
          id: 2,
        },
        short_name: {
          type: "string",
          id: 3,
        },
        macaddr: {
          type: "bytes",
          id: 4,
        },
        hw_model: {
          type: "uint32",
          id: 5,
        },
        is_licensed: {
          type: "bool",
          id: 6,
        },
        role: {
          type: "uint32",
          id: 7,
        },
        public_key: {
          type: "bytes",
          id: 8,
        },
        is_unmessagable: {
          type: "bool",
          id: 9,
        },
      },
    },
    DeviceMetrics: {
      fields: {
        battery_level: {
          type: "uint32",
          id: 1,
        },
        voltage: {
          type: "float",
          id: 2,
        },
        channel_utilization: {
          type: "float",
          id: 3,
        },
        air_util_tx: {
          type: "float",
          id: 4,
        },
        uptime_seconds: {
          type: "uint32",
          id: 5,
        },
      },
    },
    EnvironmentMetrics: {
      fields: {
        temperature: {
          type: "float",
          id: 1,
        },
        relative_humidity: {
          type: "float",
          id: 2,
        },
        barometric_pressure: {
          type: "float",
          id: 3,
        },
        gas_resistance: {
          type: "float",
          id: 4,
        },
        voltage: {
          type: "float",
          id: 5,
        },
        current: {
          type: "float",
          id: 6,
        },
        iaq: {
          type: "uint32",
          id: 7,
        },
        distance: {
          type: "float",
          id: 8,
        },
        lux: {
          type: "float",
          id: 9,
        },
        white_lux: {
          type: "float",
          id: 10,
        },
        ir_lux: {
          type: "float",
          id: 11,
        },
      },
    },
    Telemetry: {
      fields: {
        time: {
          type: "fixed32",
          id: 1,
        },
        device_metrics: {
          type: "DeviceMetrics",
          id: 2,
        },
        environment_metrics: {
          type: "EnvironmentMetrics",
          id: 3,
        },
      },
    },
    MapReport: {
      fields: {
        longName: {
          type: "string",
          id: 1,
        },
        shortName: {
          type: "string",
          id: 2,
        },
        role: {
          type: "uint32",
          id: 3,
        },
        hwModel: {
          type: "uint32",
          id: 4,
        },
        firmwareVersion: {
          type: "string",
          id: 5,
        },
        region: {
          type: "uint32",
          id: 6,
        },
        modemPreset: {
          type: "uint32",
          id: 7,
        },
        hasDefaultChannel: {
          type: "bool",
          id: 8,
        },
        latitudeI: {
          type: "sfixed32",
          id: 9,
        },
        longitudeI: {
          type: "sfixed32",
          id: 10,
        },
        altitude: {
          type: "int32",
          id: 11,
        },
        positionPrecision: {
          type: "uint32",
          id: 12,
        },
        numOnlineLocalNodes: {
          type: "uint32",
          id: 13,
        },
      },
    },
    NeighborInfo: {
      fields: {
        node_id: {
          type: "uint32",
          id: 1,
        },
        last_sent_by_id: {
          type: "uint32",
          id: 2,
        },
        node_broadcast_interval_secs: {
          type: "uint32",
          id: 3,
        },
        neighbors: {
          rule: "repeated",
          type: "Neighbor",
          id: 4,
        },
      },
    },
    Neighbor: {
      fields: {
        node_id: {
          type: "uint32",
          id: 1,
        },
        snr: {
          type: "float",
          id: 2,
        },
        last_rx_time: {
          type: "fixed32",
          id: 3,
        },
        node_broadcast_interval_secs: {
          type: "uint32",
          id: 4,
        },
      },
    },
    Waypoint: {
      fields: {
        id: {
          type: "uint32",
          id: 1,
        },
        latitude_i: {
          type: "sfixed32",
          id: 2,
        },
        longitude_i: {
          type: "sfixed32",
          id: 3,
        },
        expire: {
          type: "uint32",
          id: 4,
        },
        locked_to: {
          type: "uint32",
          id: 5,
        },
        name: {
          type: "string",
          id: 6,
        },
        description: {
          type: "string",
          id: 7,
        },
        icon: {
          type: "fixed32",
          id: 8,
        },
      },
    },
    RouteDiscovery: {
      fields: {
        route: {
          rule: "repeated",
          type: "fixed32",
          id: 1,
        },
        snr_towards: {
          rule: "repeated",
          type: "int32",
          id: 2,
        },
        route_back: {
          rule: "repeated",
          type: "fixed32",
          id: 3,
        },
        snr_back: {
          rule: "repeated",
          type: "int32",
          id: 4,
        },
      },
    },
  },
};

// Port number constants
const PortNum = {
  UNKNOWN_APP: 0, // Неизвестное приложение
  TEXT_MESSAGE_APP: 1, // Текстовые сообщения (тип: string)
  REMOTE_HARDWARE_APP: 2, // Удаленное управление железом (тип: bytes)
  POSITION_APP: 3, // GPS координаты (тип: Position)
  NODEINFO_APP: 4, // Информация об узле (тип: User)
  ROUTING_APP: 5, // Маршрутизация (тип: Routing)
  ADMIN_APP: 6, // Административные команды (тип: AdminMessage)
  TEXT_MESSAGE_COMPRESSED_APP: 7, // Сжатые текстовые сообщения (тип: bytes)
  WAYPOINT_APP: 8, // Путевые точки (тип: Waypoint)
  AUDIO_APP: 9, // Аудио данные (тип: bytes)
  DETECTION_SENSOR_APP: 10, // Датчики обнаружения (тип: bytes)
  REPLY_APP: 32, // Ответы на сообщения (тип: bytes)
  IP_TUNNEL_APP: 33, // IP туннель (тип: bytes)
  PAXCOUNTER_APP: 34, // Счетчик людей/устройств (тип: Paxcount)
  SERIAL_APP: 35, // Последовательный порт (тип: bytes)
  STORE_FORWARD_APP: 36, // Хранение и пересылка сообщений (тип: StoreAndForward)
  RANGE_TEST_APP: 37, // Тест дальности связи (тип: bytes)
  TELEMETRY_APP: 67, // Телеметрия устройства (тип: Telemetry)
  ZPS_APP: 68, // Zero Power Sleep (тип: bytes)
  SIMULATOR_APP: 69, // Симулятор для тестирования (тип: bytes)
  TRACEROUTE_APP: 70, // Трассировка маршрута (тип: RouteDiscovery)
  NEIGHBORINFO_APP: 71, // Информация о соседях (тип: NeighborInfo)
  ATAK_PLUGIN: 72, // ATAK плагин (тип: TAKPacket)
  MAP_REPORT_APP: 73, // Отчет для карт (тип: MapReport)
  PRIVATE_APP: 256, // Частные приложения (тип: bytes)
  ATAK_FORWARDER: 257, // ATAK форвардер (тип: bytes)
  MAX: 511, // Максимальный номер порта
};

// Unified message decoder configuration
const MESSAGE_DECODERS = {
  [PortNum.POSITION_APP]: {
    type: "position",
    decoder: "Position",
    processor: (data) => {
      const { payload, ...clean } = data;
      return clean;
    },
  },
  [PortNum.NODEINFO_APP]: {
    type: "user",
    decoder: "User",
    processor: (data) => {
      const { payload, ...clean } = data;
      // Конвертируем Buffer поля в строки
      if (clean.macaddr && Buffer.isBuffer(clean.macaddr)) {
        clean.macaddr = Array.from(clean.macaddr)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(":");
      }
      if (clean.public_key && Buffer.isBuffer(clean.public_key)) {
        clean.public_key = Array.from(clean.public_key)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
      return clean;
    },
  },
  [PortNum.TELEMETRY_APP]: {
    type: "telemetry",
    decoder: "Telemetry",
    processor: (data) => {
      if (data.device_metrics) {
        return {
          type: "deviceMetrics",
          variant: { value: data.device_metrics },
        };
      }
      if (data.environment_metrics) {
        return {
          type: "environmentMetrics",
          variant: { value: data.environment_metrics },
        };
      }
      const { payload, ...clean } = data;
      return clean;
    },
  },
  [PortNum.TEXT_MESSAGE_APP]: {
    type: "message",
    decoder: null,
    processor: (data, payload) => ({
      text: new TextDecoder().decode(payload),
    }),
  },
  [PortNum.MAP_REPORT_APP]: {
    type: "mapReport",
    decoder: "MapReport",
    processor: (data, payload) => ({
      portnum: "MAP_REPORT_APP",
      payload: Buffer.from(payload).toString("base64"),
      decoded: data,
    }),
  },
  [PortNum.NEIGHBORINFO_APP]: {
    type: "neighborInfo",
    decoder: "NeighborInfo",
    processor: (data) => ({
      nodeId: data.node_id,
      lastSentById: data.last_sent_by_id,
      nodeBroadcastIntervalSecs: data.node_broadcast_interval_secs,
      neighbors: data.neighbors
        ? data.neighbors.map((neighbor) => ({
            nodeId: neighbor.node_id,
            snr: neighbor.snr,
            lastRxTime: neighbor.last_rx_time,
            nodeBroadcastIntervalSecs: neighbor.node_broadcast_interval_secs,
          }))
        : [],
    }),
  },
  [PortNum.TRACEROUTE_APP]: {
    type: "traceroute",
    decoder: "RouteDiscovery",
    processor: (data) => {
      const { payload, ...clean } = data;
      return clean;
    },
  },
  [PortNum.WAYPOINT_APP]: {
    type: "waypoint",
    decoder: "Waypoint",
    processor: (data) => {
      const { payload, ...clean } = data;
      return clean;
    },
  },
  // Обработка legacy/неизвестных портов
  65: {
    type: "storeForwardLegacy",
    decoder: null,
    processor: (data, payload) => ({
      note: "Legacy STORE_FORWARD_APP port (старый номер порта)",
      payloadSize: payload ? payload.length : 0,
      rawPayload: payload ? Array.from(payload).slice(0, 20) : [], // Первые 20 байт для анализа
    }),
  },
};

class ProtobufDecoder {
  constructor() {
    this.root = protobuf.Root.fromJSON(serviceEnvelopeSchema);
    this.ServiceEnvelope = this.root.lookupType("ServiceEnvelope");
    this.MeshPacket = this.root.lookupType("MeshPacket");
    this.Data = this.root.lookupType("Data");

    // Create decoder instances for all message types
    this.decoders = {};
    Object.values(MESSAGE_DECODERS).forEach(({ decoder }) => {
      if (decoder && !this.decoders[decoder]) {
        this.decoders[decoder] = this.root.lookupType(decoder);
      }
    });
  }

  decodeServiceEnvelope(buffer) {
    try {
      return this.ServiceEnvelope.decode(buffer);
    } catch (error) {
      throw new Error(`Failed to decode ServiceEnvelope: ${error.message}`);
    }
  }

  decodePayload(portnum, payload) {
    try {
      const config = MESSAGE_DECODERS[portnum];
      if (!config) {
        return {
          type: "unknown",
          data: {
            portnum,
            payload: Array.from(payload),
          },
        };
      }

      let decodedData;
      if (config.decoder) {
        decodedData = this.decoders[config.decoder].decode(payload);
      } else {
        decodedData = payload;
      }

      const processedData = config.processor(decodedData, payload);

      return {
        type: config.type,
        data: processedData,
      };
    } catch (error) {
      return {
        type: "error",
        data: {
          error: error.message,
          portnum,
          payload: Array.from(payload),
        },
      };
    }
  }

  processPacket(buffer, additionalInfo = {}) {
    try {
      const serviceEnvelope = this.decodeServiceEnvelope(buffer);
      const packet = serviceEnvelope.packet;

      if (!packet || !packet.decoded) {
        return null;
      }

      const decoded = this.decodePayload(
        packet.decoded.portnum,
        packet.decoded.payload
      );

      return {
        from: packet.from,
        to: packet.to,
        channel: packet.channel,
        id: packet.id,
        rxTime: packet.rxTime,
        rxSnr: packet.rxSnr,
        hopLimit: packet.hopLimit,
        wantAck: packet.wantAck,
        rxRssi: packet.rxRssi,
        channelId: serviceEnvelope.channelId,
        gatewayId: serviceEnvelope.gatewayId,
        ...decoded,
        ...additionalInfo,
      };
    } catch (error) {
      console.error("Error processing packet:", error.message);
      return null;
    }
  }
}

export { ProtobufDecoder, PortNum };
