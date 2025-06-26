import protobuf from 'protobufjs'

// Define protobuf schemas
const serviceEnvelopeSchema = {
  "nested": {
    "ServiceEnvelope": {
      "fields": {
        "packet": {
          "type": "MeshPacket",
          "id": 1
        },
        "channelId": {
          "type": "string",
          "id": 2
        },
        "gatewayId": {
          "type": "string",
          "id": 3
        }
      }
    },
    "MeshPacket": {
      "fields": {
        "from": {
          "type": "uint32",
          "id": 1
        },
        "to": {
          "type": "uint32",
          "id": 2
        },
        "channel": {
          "type": "uint32",
          "id": 3
        },
        "decoded": {
          "type": "Data",
          "id": 4
        },
        "encrypted": {
          "type": "bytes",
          "id": 5
        },
        "id": {
          "type": "uint32",
          "id": 6
        },
        "rxTime": {
          "type": "uint32",
          "id": 7
        },
        "rxSnr": {
          "type": "float",
          "id": 8
        },
        "hopLimit": {
          "type": "uint32",
          "id": 9
        },
        "wantAck": {
          "type": "bool",
          "id": 10
        },
        "priority": {
          "type": "uint32",
          "id": 11
        },
        "rxRssi": {
          "type": "int32",
          "id": 12
        },
        "delayed": {
          "type": "uint32",
          "id": 13
        }
      }
    },
    "Data": {
      "fields": {
        "portnum": {
          "type": "uint32",
          "id": 1
        },
        "payload": {
          "type": "bytes",
          "id": 2
        },
        "wantResponse": {
          "type": "bool",
          "id": 3
        },
        "dest": {
          "type": "uint32",
          "id": 4
        },
        "source": {
          "type": "uint32",
          "id": 5
        },
        "requestId": {
          "type": "uint32",
          "id": 6
        },
        "replyId": {
          "type": "uint32",
          "id": 7
        },
        "emoji": {
          "type": "uint32",
          "id": 8
        }
      }
    },
    "Position": {
      "fields": {
        "latitudeI": {
          "type": "sfixed32",
          "id": 1
        },
        "longitudeI": {
          "type": "sfixed32",
          "id": 2
        },
        "altitude": {
          "type": "int32",
          "id": 3
        },
        "time": {
          "type": "uint32",
          "id": 4
        },
        "locationSource": {
          "type": "uint32",
          "id": 5
        },
        "altitudeSource": {
          "type": "uint32",
          "id": 6
        },
        "timestamp": {
          "type": "uint32",
          "id": 7
        },
        "timestampMillisAdjust": {
          "type": "int32",
          "id": 8
        },
        "altitudeHae": {
          "type": "int32",
          "id": 9
        },
        "altitudeGeoidSeparation": {
          "type": "int32",
          "id": 10
        },
        "PDOP": {
          "type": "uint32",
          "id": 11
        },
        "HDOP": {
          "type": "uint32",
          "id": 12
        },
        "VDOP": {
          "type": "uint32",
          "id": 13
        },
        "gpsAccuracy": {
          "type": "uint32",
          "id": 14
        },
        "groundSpeed": {
          "type": "uint32",
          "id": 15
        },
        "groundTrack": {
          "type": "uint32",
          "id": 16
        },
        "fixQuality": {
          "type": "uint32",
          "id": 17
        },
        "fixType": {
          "type": "uint32",
          "id": 18
        },
        "satsInView": {
          "type": "uint32",
          "id": 19
        },
        "sensorId": {
          "type": "uint32",
          "id": 20
        },
        "nextUpdate": {
          "type": "uint32",
          "id": 21
        },
        "seqNumber": {
          "type": "uint32",
          "id": 22
        }
      }
    },
    "User": {
      "fields": {
        "id": {
          "type": "string",
          "id": 1
        },
        "longName": {
          "type": "string",
          "id": 2
        },
        "shortName": {
          "type": "string",
          "id": 3
        },
        "macaddr": {
          "type": "bytes",
          "id": 4
        },
        "hwModel": {
          "type": "uint32",
          "id": 5
        },
        "isLicensed": {
          "type": "bool",
          "id": 6
        },
        "role": {
          "type": "uint32",
          "id": 7
        }
      }
    },
    "DeviceMetrics": {
      "fields": {
        "batteryLevel": {
          "type": "uint32",
          "id": 1
        },
        "voltage": {
          "type": "float",
          "id": 2
        },
        "channelUtilization": {
          "type": "float",
          "id": 3
        },
        "airUtilTx": {
          "type": "float",
          "id": 4
        },
        "uptimeSeconds": {
          "type": "uint32",
          "id": 5
        }
      }
    },
    "EnvironmentMetrics": {
      "fields": {
        "temperature": {
          "type": "float",
          "id": 1
        },
        "relativeHumidity": {
          "type": "float",
          "id": 2
        },
        "barometricPressure": {
          "type": "float",
          "id": 3
        },
        "gasResistance": {
          "type": "float",
          "id": 4
        },
        "voltage": {
          "type": "float",
          "id": 5
        },
        "current": {
          "type": "float",
          "id": 6
        }
      }
    },
    "Telemetry": {
      "fields": {
        "time": {
          "type": "uint32",
          "id": 1
        },
        "deviceMetrics": {
          "type": "DeviceMetrics",
          "id": 2
        },
        "environmentMetrics": {
          "type": "EnvironmentMetrics",
          "id": 3
        }
      }
    }
  }
}

// Port number constants
const PortNum = {
  UNKNOWN_APP: 0,
  TEXT_MESSAGE_APP: 1,
  REMOTE_HARDWARE_APP: 2,
  POSITION_APP: 3,
  NODEINFO_APP: 4,
  ROUTING_APP: 5,
  ADMIN_APP: 6,
  TEXT_MESSAGE_COMPRESSED_APP: 7,
  WAYPOINT_APP: 8,
  AUDIO_APP: 9,
  DETECTION_SENSOR_APP: 10,
  REPLY_APP: 32,
  IP_TUNNEL_APP: 33,
  PAXCOUNTER_APP: 34,
  SERIAL_APP: 35,
  STORE_FORWARD_APP: 36,
  RANGE_TEST_APP: 37,
  TELEMETRY_APP: 67,
  ZPS_APP: 68,
  SIMULATOR_APP: 69,
  TRACEROUTE_APP: 70,
  NEIGHBORINFO_APP: 71,
  ATAK_PLUGIN: 72,
  MAP_REPORT_APP: 73,
  PRIVATE_APP: 256,
  ATAK_FORWARDER: 257,
  MAX: 511
}

class ProtobufDecoder {
  constructor() {
    this.root = protobuf.Root.fromJSON(serviceEnvelopeSchema)
    this.ServiceEnvelope = this.root.lookupType('ServiceEnvelope')
    this.MeshPacket = this.root.lookupType('MeshPacket')
    this.Data = this.root.lookupType('Data')
    this.Position = this.root.lookupType('Position')
    this.User = this.root.lookupType('User')
    this.DeviceMetrics = this.root.lookupType('DeviceMetrics')
    this.EnvironmentMetrics = this.root.lookupType('EnvironmentMetrics')
    this.Telemetry = this.root.lookupType('Telemetry')
  }

  decodeServiceEnvelope(buffer) {
    try {
      return this.ServiceEnvelope.decode(buffer)
    } catch (error) {
      throw new Error(`Failed to decode ServiceEnvelope: ${error.message}`)
    }
  }

  decodePayload(portnum, payload) {
    try {
      switch (portnum) {
        case PortNum.POSITION_APP:
          return {
            type: 'position',
            data: this.Position.decode(payload)
          }
        case PortNum.NODEINFO_APP:
          return {
            type: 'user',
            data: this.User.decode(payload)
          }
        case PortNum.TELEMETRY_APP:
          const telemetry = this.Telemetry.decode(payload)
          if (telemetry.deviceMetrics) {
            return {
              type: 'deviceMetrics',
              data: {
                variant: {
                  value: telemetry.deviceMetrics
                }
              }
            }
          } else if (telemetry.environmentMetrics) {
            return {
              type: 'environmentMetrics',
              data: {
                variant: {
                  value: telemetry.environmentMetrics
                }
              }
            }
          }
          return {
            type: 'telemetry',
            data: telemetry
          }
        case PortNum.TEXT_MESSAGE_APP:
          return {
            type: 'message',
            data: {
              text: new TextDecoder().decode(payload),
              portnum
            }
          }
        default:
          return {
            type: 'unknown',
            data: {
              portnum,
              payload: Array.from(payload)
            }
          }
      }
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error.message,
          portnum,
          payload: Array.from(payload)
        }
      }
    }
  }

  processPacket(buffer, additionalInfo = {}) {
    try {
      const serviceEnvelope = this.decodeServiceEnvelope(buffer)
      const packet = serviceEnvelope.packet

      if (!packet || !packet.decoded) {
        return null
      }

      const decoded = this.decodePayload(packet.decoded.portnum, packet.decoded.payload)
      // const { from } = aaa;

      // return { from }, 
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
        ...additionalInfo
      }
    } catch (error) {
      console.error('Error processing packet:', error.message)
      return null
    }
  }
}

export { ProtobufDecoder, PortNum }
