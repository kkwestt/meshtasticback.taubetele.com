import mqtt from 'mqtt'
import { Protobuf } from '@jsr/meshtastic__core'
import { TransportHTTP } from '@jsr/meshtastic__transport-http'

const MIN_LOG_LEVEL = 10
const RECONNECT_DELAY = 5000
const MAX_RECONNECT_ATTEMPTS = 5

const shouldLogError = (errorMessage) => {
  const suppressedErrors = [
    'undefined',
    'illegal tag',
    'Error received for packet',
    'NO_RESPONSE',
    'TIMEOUT',
    'NO_INTERFACE',
    'MAX_RETRANSMIT',
    'NO_CHANNEL',
    'TOO_LARGE',
    'NO_ACK',
    'NOT_AUTHORIZED'
  ]

  return !suppressedErrors.some(error => errorMessage.includes(error))
}

const connectToProtobufServer = async (server, callback) => {
  console.log(`Attempting to connect to protobuf server: ${server.name} at ${server.address}`)
  
  try {
    // Извлекаем адрес без протокола
    const address = server.address.replace(/^https?:\/\//, '')
    console.log(`Creating TransportHTTP for address: ${address}`)
    
    // Создаем HTTP транспорт с таймаутом
    const transport = await Promise.race([
      TransportHTTP.create(address),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Transport creation timeout')), 10000)
      )
    ])
    
    console.log(`TransportHTTP created successfully for ${server.name}`)
    
    // Импортируем MeshDevice только когда нужно
    const { MeshDevice } = await import('@jsr/meshtastic__core')
    const device = new MeshDevice(transport)
    device.log.settings.minLevel = MIN_LOG_LEVEL
    
    console.log(`MeshDevice created for ${server.name}`)

    // Настраиваем события для protobuf устройства
    const events = Object.keys(device.events)
    console.log(`Available events for ${server.name}:`, events)

    events.forEach(eventName => {
      device.events[eventName].subscribe((event) => {
        try {
          const { mqttChannel, mqttUser, ...rest } = event
          const eventType = event.data?.constructor?.name || 'unknown'
          callback(server, mqttChannel, mqttUser, eventName, eventType, rest)
        } catch (error) {
          if (!shouldLogError(error.message)) {
            return
          }
          console.error(`Error in protobuf event ${eventName}:`, error.message)
        }
      })
    })

    console.log(`Connected to protobuf server: ${server.name}`)
    
    return device
  } catch (error) {
    console.error(`Failed to connect to protobuf server ${server.name}:`, error.message)
    return null
  }
}

const isValidPacket = (arrayBuffer) => {
  if (!arrayBuffer || arrayBuffer.length === 0) return false
  if (arrayBuffer.length < 4) return false

  try {
    // Basic validation - check if it starts with valid protobuf markers
    const view = new DataView(arrayBuffer.buffer || arrayBuffer)
    const firstByte = view.getUint8(0)

    // Protobuf messages typically start with field numbers 1-15 (0x08-0x78)
    return firstByte >= 0x08 && firstByte <= 0x78
  } catch {
    return false
  }
}

const handleProtobufServiceEnvelopePacket = (server, fullTopic, user, arrayBuffer, callback) => {
  try {
    // Validate packet before processing
    if (!isValidPacket(arrayBuffer)) {
      return
    }

    const serviceEnvelope = Protobuf.Mqtt.ServiceEnvelope.fromBinary(arrayBuffer)

    if (!serviceEnvelope?.packet) {
      return
    }

    const meshPacket = serviceEnvelope.packet
    const { channelId, gatewayId } = serviceEnvelope
    const { rxSnr, hopLimit, wantAck, rxRssi, from, id } = meshPacket

    if (meshPacket.payloadVariant?.case === 'decoded') {
      // Debug logging for specific gateway
      if (gatewayId === '!088aa170') {
        console.log('Raw message from gateway:', server.address, fullTopic, user, { channelId, gatewayId })
      }

      const decodedPayload = meshPacket.payloadVariant.value
      const eventType = decodedPayload?.constructor?.name || 'unknown'

      const eventData = {
        mqttChannel: fullTopic,
        mqttUser: user,
        rxSnr,
        hopLimit,
        wantAck,
        rxRssi,
        gatewayId,
        data: decodedPayload,
        packet: meshPacket
      }

      // Вызываем callback напрямую для MQTT сообщений
      callback(server, fullTopic, user, 'decoded', eventType, eventData)
    }
  } catch (error) {
    // Suppress common protobuf parsing errors
    if (shouldLogError(error.message)) {
      console.error('Error handling protobuf service envelope packet:', error.message)
    }
  }
}

const connectToMqtt = (server, callback) => {
  console.log(`Attempting to connect to MQTT server: ${server.name} at ${server.address}`)

  const clientId = `mqtt_${Math.random().toString(16).substr(2, 8)}`
  let reconnectAttempts = 0

  const createConnection = () => {
    console.log(`Creating MQTT connection for ${server.name} with clientId: ${clientId}`)
    
    const client = mqtt.connect(server.address, {
      clientId,
      reconnectPeriod: RECONNECT_DELAY,
      connectTimeout: 30000,
      keepalive: 60
    })

    const topics = [
      'msh/+/2/map/',
      'msh/+/2/e/+/+',
      'msh/+/+/2/map/',
      'msh/+/+/2/e/+/+',
      'msh/+/+/+/2/map/',
      'msh/+/+/+/2/e/+/+',
      'msh/+/+/+/+/2/map/',
      'msh/+/+/+/+/2/e/+/+'
    ]

    client.on('connect', () => {
      console.log(`Connected to MQTT server: ${server.name}`)
      reconnectAttempts = 0

      client.subscribe(topics, (err) => {
        if (!err) {
          console.log(`Subscribed to topics on ${server.name}`)
        } else {
          console.error(`Subscription error on ${server.name}:`, err.message)
        }
      })
    })

    client.on('message', (topic, payload, packet) => {
      try {
        const topicParts = topic.split('/')
        if (topicParts.length < 3) return

        const [, , type, channel, user] = topicParts

        // Skip status messages
        if (type === 'stat') return

        // Handle JSON messages
        if (type === 'json') {
          try {
            const jsonData = JSON.parse(payload.toString())
            console.log('JSON message:', topic, jsonData)
            callback(server, topic, user, 'json', 'json', jsonData)
          } catch (parseError) {
            console.error('Failed to parse JSON message:', parseError.message)
          }
          return
        }

        // Handle protobuf messages
        if (payload && payload.length > 0) {
          handleProtobufServiceEnvelopePacket(server, topic, user, new Uint8Array(payload), callback)
        }
      } catch (error) {
        // Only log significant errors
        if (shouldLogError(error.message)) {
          console.error(`Error processing message from ${server.name}:`, error.message)
        }
      }
    })

    client.on('error', (error) => {
      console.error(`MQTT error on ${server.name}:`, error.message)

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++
        console.log(`Attempting to reconnect to ${server.name} (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)
      } else {
        console.error(`Max reconnection attempts reached for ${server.name}`)
        client.end()
      }
    })

    client.on('close', () => {
      console.log(`Connection closed to ${server.name}`)
    })

    client.on('offline', () => {
      console.log(`Client offline for ${server.name}`)
    })

    return client
  }

  return createConnection()
}

export const listenToEvents = async (serversConfig, callback) => {
  console.log(`Establishing ${serversConfig.length} server connections`)
  console.log('Server configs:', serversConfig.map(s => ({ name: s.name, type: s.type, address: s.address })))

  const connections = []
  
  for (let i = 0; i < serversConfig.length; i++) {
    const server = serversConfig[i]
    console.log(`Processing server ${i + 1}/${serversConfig.length}: ${server.name} (${server.type})`)
    
    try {
      let connection = null
      switch (server.type) {
        case 'mqtt':
          console.log(`Creating MQTT connection for ${server.name}`)
          connection = connectToMqtt(server, callback)
          console.log(`MQTT connection created for ${server.name}`)
          break
        case 'protobuf':
          console.log(`Creating protobuf connection for ${server.name}`)
          connection = await connectToProtobufServer(server, callback)
          console.log(`Protobuf connection result for ${server.name}:`, connection ? 'success' : 'failed')
          break
        default:
          console.warn('Unsupported server config:', server)
          continue
      }
      
      if (connection) {
        connections.push(connection)
        console.log(`Added connection for ${server.name}. Total connections: ${connections.length}`)
      } else {
        console.log(`No connection created for ${server.name}`)
      }
    } catch (error) {
      console.error(`Failed to connect to ${server.name}:`, error.message)
      console.error('Error stack:', error.stack)
    }
  }

  console.log(`Finished establishing connections. Total: ${connections.length}`)

  // Graceful shutdown handling
  const gracefulShutdown = () => {
    console.log('Shutting down connections...')
    connections.forEach(client => {
      if (client && typeof client.end === 'function') {
        client.end()
      }
    })
  }

  process.on('SIGINT', gracefulShutdown)
  process.on('SIGTERM', gracefulShutdown)

  return connections
}
