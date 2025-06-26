// Определение типа события на основе данных пакета
export const getEventType = (eventName, eventType, event) => {
  try {
    // Если у нас есть messageType из нового декодера, используем его
    if (event.messageType) {
      switch (event.messageType) {
        case 'text':
          return 'message'
        case 'position':
          return 'position'
        case 'user':
          return 'user'
        case 'telemetry':
          return 'deviceMetrics'
        case 'neighborInfo':
          return 'neighborInfo'
        default:
          return event.messageType
      }
    }

    // Fallback для совместимости со старым кодом
    if (eventType) {
      switch (eventType.toLowerCase()) {
        case 'message':
        case 'text':
          return 'message'
        case 'position':
          return 'position'
        case 'user':
        case 'nodeinfo':
          return 'user'
        case 'telemetry':
        case 'devicemetrics':
          return 'deviceMetrics'
        case 'environmentmetrics':
          return 'environmentMetrics'
        case 'neighborinfo':
          return 'neighborInfo'
        default:
          return eventType.toLowerCase()
      }
    }

    // Определяем тип по portnum если доступен
    if (event.portnum) {
      switch (event.portnum) {
        case 1:
          return 'message'
        case 3:
          return 'position'
        case 4:
          return 'user'
        case 67:
          return 'deviceMetrics'
        case 71:
          return 'neighborInfo'
        default:
          return `portnum_${event.portnum}`
      }
    }

    // Определяем тип по структуре данных
    if (event.data) {
      const data = event.data
      
      // Проверяем наличие полей для определения типа
      if (data.payload && typeof data.payload === 'object') {
        if (data.payload.text || data.payload.message) {
          return 'message'
        }
        if (data.payload.latitudeI !== undefined || data.payload.longitudeI !== undefined) {
          return 'position'
        }
        if (data.payload.longName || data.payload.shortName) {
          return 'user'
        }
        if (data.payload.batteryLevel !== undefined || data.payload.voltage !== undefined) {
          return 'deviceMetrics'
        }
        if (data.payload.temperature !== undefined || data.payload.relativeHumidity !== undefined) {
          return 'environmentMetrics'
        }
      }

      // Прямые поля в data
      if (data.latitudeI !== undefined || data.longitudeI !== undefined) {
        return 'position'
      }
      if (data.longName || data.shortName) {
        return 'user'
      }
      if (data.batteryLevel !== undefined || data.voltage !== undefined) {
        return 'deviceMetrics'
      }
      if (data.temperature !== undefined || data.relativeHumidity !== undefined) {
        return 'environmentMetrics'
      }
    }

    // Определяем по имени события
    if (eventName) {
      switch (eventName.toLowerCase()) {
        case 'onmessagepacket':
          return 'message'
        case 'onpositionpacket':
          return 'position'
        case 'onuserpacket':
          return 'user'
        case 'ontelemetrypacket':
          return 'deviceMetrics'
        case 'onneighborinfopacket':
          return 'neighborInfo'
        default:
          break
      }
    }

    // Если ничего не подошло, возвращаем null
    return null
  } catch (error) {
    console.error('Error determining event type:', error.message)
    return null
  }
}