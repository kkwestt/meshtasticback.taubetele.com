import mqtt from 'mqtt'
import { Protobuf, HttpConnection, MeshDevice } from '@meshtastic/js'

const MIN_LOG_LEVEL = 10
const RECONNECT_DELAY = 5000
const MAX_RECONNECT_ATTEMPTS = 5

const listenToProtobufEvents = (server, connection, callback) => {
  const events = Object.keys(connection.events)

  events.forEach(eventName => {
    connection.events[eventName].subscribe((event) => {
    try {
    const { mqttChannel, mqttUser, ...rest } = event
    const eventType = event.data?.constructor?.name || 'unknown'
    // Передаем полный топик как mqttChannel
    callback(server, mqttChannel, mqttUser, eventName, eventType, rest)
    } catch (error) {
    // Filter out common mesh network errors
    if (!shouldLogError(error.message)) {
    return
    }
    console.error(`Error in protobuf event ${eventName}:`, error.message)
    }
    })
  })
}

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

const connectToProtobufServer = (server, callback) => {
  const connection = new HttpConnection()
  connection.log.settings.minLevel = MIN_LOG_LEVEL

  try {
    connection.connect({
    address: server.address,
    fetchInterval: 3000
    })
    listenToProtobufEvents(server, connection, callback)
    console.log(`Connected to protobuf server: ${server.name}`)
  } catch (error) {
    if (shouldLogError(error.message)) {
    console.error(`Failed to connect to protobuf server ${server.name}:`, error.message)
    }
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

const handleProtobufServiceEnvelopePacket = (server, fullTopic, user, device, arrayBuffer) => {
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

    const additionalInfo = {
    mqttChannel: fullTopic, // Передаем полный топик
    mqttUser: user,
    rxSnr,
    hopLimit,
    wantAck,
    rxRssi,
    gatewayId
    }

    try {
    device.handleDecodedPacket(meshPacket.payloadVariant.value, meshPacket, additionalInfo)
    } catch (handleError) {
    // Suppress common mesh network errors
    if (shouldLogError(handleError.message)) {
    console.error(`Error handling decoded packet ${id || from || 'unknown'}:`, handleError.message)
    }
    }
    }
  } catch (error) {
    // Suppress common protobuf parsing errors
    if (shouldLogError(error.message)) {
    console.error('Error handling protobuf service envelope packet:', error.message)
    }
  }
}

const connectToMqtt = (server, callback) => {
  const device = new MeshDevice()
  device.log.settings.minLevel = MIN_LOG_LEVEL

  // Override console methods to filter Meshtastic library errors
  const originalConsoleError = console.error
  const originalConsoleWarn = console.warn
  const originalConsoleLog = console.log

  console.error = (...args) => {
    const message = args.join(' ')
    if (shouldLogError(message)) {
    originalConsoleError.apply(console, args)
    }
  }

  console.warn = (...args) => {
    const message = args.join(' ')
    if (shouldLogError(message)) {
    originalConsoleWarn.apply(console, args)
    }
  }

  // Restore original console methods after a delay to avoid affecting other parts
  setTimeout(() => {
    console.error = originalConsoleError
    console.warn = originalConsoleWarn
  }, 1000)

  listenToProtobufEvents(server, device, callback)

  const clientId = `mqtt_${Math.random().toString(16).substr(2, 8)}`
  let reconnectAttempts = 0

  const createConnection = () => {
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
    // Передаем полный топик вместо channel
    callback(server, topic, user, 'json', 'json', jsonData)
    } catch (parseError) {
    console.error('Failed to parse JSON message:', parseError.message)
    }
    return
    }

    // Handle protobuf messages
    if (payload && payload.length > 0) {
    // Передаем полный топик вместо channel
    handleProtobufServiceEnvelopePacket(server, topic, user, device, new Uint8Array(payload))
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

  const connections = serversConfig.map(server => {
    try {
    switch (server.type) {
    case 'mqtt':
    return connectToMqtt(server, callback)
    case 'protobuf':
    return connectToProtobufServer(server, callback)
    default:
    console.warn('Unsupported server config:', server)
    return null
    }
    } catch (error) {
    if (shouldLogError(error.message)) {
    console.error(`Failed to connect to ${server.name}:`, error.message)
    }
    return null
    }
  }).filter(Boolean)

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