import { createClient } from 'redis'
import express from 'express'
import compression from 'compression'
import cors from 'cors'
import { isEqual, reduce } from 'lodash-es'

import { redisConfig, servers } from './config.mjs'
import { listenToEvents } from './listenToEvents.mjs'
import { getEventType } from './getEventType.mjs'
import { handleTelegramMessage, initializeTelegramBot } from './telegram.mjs'

const MAX_METADATA_ITEMS_COUNT = 200
const CACHE_REFRESH_INTERVAL = 5000
const DEVICE_EXPIRY_TIME = 24 * 60 * 60 * 1000 // 24 hours

const connectToRedis = async () => {
  try {
    const client = await createClient(redisConfig)
    .on('error', (err) => console.error('Redis Client Error:', err))
    .on('connect', () => console.log('Connected to Redis'))
    .on('reconnecting', () => console.log('Reconnecting to Redis...'))
    .connect()
    return client
  } catch (error) {
    console.error('Failed to connect to Redis:', error.message)
    process.exit(1)
  }
}

const round = (num, decimalPlaces = 0) => {
  if (typeof num !== 'number' || isNaN(num)) return 0
  const factor = Math.pow(10, decimalPlaces)
  return Math.round(num * factor) / factor
}

function startServer (redis) {
  const app = express()

  app.use(compression())
  app.use(cors({
    origin: (origin, callback) => callback(null, origin || '*'),
    allowedHeaders: ['Content-Type']
  }))

  let cachedKeys = []
  let cachedValues = []
  let isQuerying = false

  const queryMetadata = async (from, type) => {
    try {
    const data = await redis.lRange(`${type}:${from}`, 0, MAX_METADATA_ITEMS_COUNT)
    return data.map(item => {
    try {
    return JSON.parse(item)
    } catch {
    return null
    }
    }).filter(Boolean)
    } catch (error) {
    console.error(`Error querying metadata for ${type}:${from}:`, error.message)
    return []
    }
  }

  const queryData = async () => {
    if (isQuerying) return
    isQuerying = true

    try {
    const keys = await redis.keys('device:*')
    const values = await Promise.all(
    keys.map(async key => {
    try {
    return await redis.hGetAll(key)
    } catch (error) {
    console.error(`Error getting data for key ${key}:`, error.message)
    return null
    }
    })
    )

    cachedKeys = keys || []
    cachedValues = values.filter(Boolean) || []
    } catch (error) {
    console.error('Error querying data:', error.message)
    cachedKeys = []
    cachedValues = []
    } finally {
    isQuerying = false
    }
  }

  // Initial data load
  queryData()
  setInterval(queryData, CACHE_REFRESH_INTERVAL)

  // API endpoints with better error handling
  app.get('/gps:from', async (req, res) => {
    try {
    const from = req.params.from.substring(1)
    const data = await queryMetadata(from, 'gps')
    res.json({ from, data })
    } catch (error) {
    console.error('GPS endpoint error:', error.message)
    res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.get('/deviceMetrics:from', async (req, res) => {
    try {
    const from = req.params.from.substring(1)
    const data = await queryMetadata(from, 'deviceMetrics')
    res.json({ from, data })
    } catch (error) {
    console.error('Device metrics endpoint error:', error.message)
    res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.get('/environmentMetrics:from', async (req, res) => {
    try {
    const from = req.params.from.substring(1)
    const data = await queryMetadata(from, 'environmentMetrics')
    res.json({ from, data })
    } catch (error) {
    console.error('Environment metrics endpoint error:', error.message)
    res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.get('/api', async (req, res) => {
    try {
    if (!cachedKeys || cachedKeys.length === 0) {
    await queryData()
    }

    if (!cachedKeys || !cachedValues) {
    return res.json({})
    }

    const result = cachedKeys.reduce((result, key, index) => {
    if (!cachedValues[index]) return result

    const { server, timestamp, ...rest } = cachedValues[index]
    const isExpired = Date.now() - new Date(timestamp).getTime() >= DEVICE_EXPIRY_TIME

    if (isExpired) return result

    const data = { server, timestamp }
    Object.entries(rest).forEach(([key, value]) => {
    try {
    data[key] = JSON.parse(value)
    } catch {
    data[key] = value
    }
    })

    const from = key.substr(7) // Remove "device:" prefix
    result[from] = data
    return result
    }, {})

    res.json(result)
    } catch (error) {
    console.error('API endpoint error:', error.message)
    res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.get('/', async (req, res) => {
    try {
    if (!cachedKeys || cachedKeys.length === 0) {
    await queryData()
    }

    if (!cachedKeys || !cachedValues) {
    return res.json({})
    }

    const result = cachedKeys.reduce((result, key, index) => {
    if (!cachedValues[index]) return result

    const { server, timestamp, ...rest } = cachedValues[index]
    const data = { server, timestamp }

    Object.entries(rest).forEach(([key, value]) => {
    try {
    data[key] = JSON.parse(value)
    } catch {
    data[key] = value
    }
    })

    const from = key.substr(7)
    result[from] = data
    return result
    }, {})

    res.json(result)
    } catch (error) {
    console.error('Root endpoint error:', error.message)
    res.status(500).json({ error: 'Internal server error' })
    }
  })

  const PORT = process.env.PORT || 80
  app.listen(PORT, () => {
    // console.log(`Server running on port ${PORT}`)
  })
}

async function connectToMeshtastic () {
  const redis = await connectToRedis()

  // Инициализируем Telegram бот с обработчиками команд
  initializeTelegramBot(redis)

  function upsertItem (key, serverTime, newItem) {
    redis.lRange(key, -1, -1).then((res) => {
    const [lastItemStr] = res
    const isNewItem = !lastItemStr
    let isUpdated = false

    if (!isNewItem) {
    try {
    const { time, ...lastPosItem } = JSON.parse(lastItemStr)
    const diff = reduce(newItem, (result, aValue, key) => {
    const bValue = lastPosItem[key]
    if (typeof aValue === 'number' && typeof bValue === 'number') {
    return aValue.toFixed(5) === bValue.toFixed(5) ? result : result.concat(key)
    }
    return isEqual(aValue, bValue) ? result : result.concat(key)
    }, [])
    isUpdated = diff.length > 0
    } catch (error) {
    console.error('Error parsing last item:', error.message)
    isUpdated = true
    }
    }

    if (isNewItem || isUpdated) {
    redis.rPush(key, JSON.stringify({ time: serverTime, ...newItem }))
    .then((length) => {
    if (length > MAX_METADATA_ITEMS_COUNT) {
    const diff = length - MAX_METADATA_ITEMS_COUNT
    return redis.lTrim(key, diff, length)
    }
    })
    .catch(error => console.error('Error upserting item:', error.message))
    }
    }).catch(error => console.error('Error getting last item:', error.message))
  }

  listenToEvents(servers, (server, fullTopic, user, eventName, eventType, event) => {
    try {
    const type = getEventType(eventName, eventType, event)
    if (!type) return

    const { from } = event
    if (!from) return

    const key = `device:${from}`
    const serverTime = Date.now()

    // Handle messages - вызываем функцию из telegram.mjs
    if (type === 'message' || eventName === 'onMessagePacket') {
    if (event.type === 'direct' || event.from === 552052256) return

    // Обрабатываем Telegram уведомления
    handleTelegramMessage(redis, server, fullTopic, event)
    }

    // Store event data
    redis.hSet(key, {
    server: server.name,
    timestamp: new Date(serverTime).toISOString(),
    [type]: JSON.stringify({ serverTime, ...event })
    }).catch(error => console.error('Error storing event:', error.message))

    // Handle user data
    if (type === 'user') {
    const { shortName, longName } = event?.data || {}
    redis.hSet(`user:${event.data.id}`, { from, shortName, longName })
    .catch(error => console.error('Error storing user data:', error.message))
    }

    // Handle position data
    if (type === 'position') {
    const gpsKey = `gps:${from}`
    const { latitudeI, longitudeI, altitude, seqNumber } = event?.data || {}
    if (latitudeI === 0 || longitudeI === 0) return
    const newPosItem = { latitudeI, longitudeI, altitude, seqNumber }
    upsertItem(gpsKey, serverTime, newPosItem)
    }

    // Handle device metrics
    else if (type === 'deviceMetrics') {
    const telemetryKey = `deviceMetrics:${from}`
    let { batteryLevel, voltage, channelUtilization, airUtilTx } = event?.data?.variant?.value || {}

    batteryLevel = batteryLevel > 100 ? 100 : round(batteryLevel, 0)
    voltage = round(voltage, 2)
    channelUtilization = round(channelUtilization, 1)
    airUtilTx = round(airUtilTx, 1)

    const newMetricsItem = { batteryLevel, voltage, channelUtilization, airUtilTx }
    upsertItem(telemetryKey, serverTime, newMetricsItem)
    }

    // Handle environment metrics
    else if (type === 'environmentMetrics') {
    const telemetryKey = `environmentMetrics:${from}`
    let { temperature, relativeHumidity, barometricPressure, gasResistance, voltage, current } = event?.data?.variant?.value || {}

    temperature = round(temperature, 1)
    relativeHumidity = round(relativeHumidity, 0)
    barometricPressure = round(barometricPressure, 0)
    gasResistance = round(gasResistance, 0)
    voltage = round(voltage, 2)
    current = round(current, 2)

    const newEnvItem = { temperature, relativeHumidity, barometricPressure, gasResistance, voltage, current }
    upsertItem(telemetryKey, serverTime, newEnvItem)
    }

    // Handle other message types
    else if (type === 'message' || type === 'deviceMetadata') {
    const telemetryKey = `message:${from}`
    upsertItem(telemetryKey, serverTime, event)
    }
    } catch (error) {
    console.error('Error processing event:', error.message)
    console.error('Stack:', error.stack)
    }
  })

  startServer(redis)
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  process.exit(0)
})

connectToMeshtastic().catch(error => {
  console.error('Failed to start application:', error.message)
  process.exit(1)
})