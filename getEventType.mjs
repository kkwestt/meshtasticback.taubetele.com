const BANNED_IDS = new Set([4184512284, 220300, 7, 4])
const MIN_VALID_ID = 10000

function lowerCaseFirstLetter(string) {
  return string.charAt(0).toLowerCase() + string.slice(1)
}

/**
 * Filters and determines event types with improved validation
 * @param {string} eventName - Name of the event
 * @param {string} eventType - Type of the event
 * @param {Object} event - Event data
 * @returns {string|null} - Event type or null if filtered out
 */
export function getEventType(eventName, eventType, event) {
  // Filter JSON events
  if (eventType === 'json') {
    return null
  }

  // Validate event object
  if (!event || typeof event !== 'object') {
    return null
  }

  const { from } = event

  // Filter banned IDs
  if (BANNED_IDS.has(from)) {
    return null
  }

  // Filter invalid IDs (should be 6-9 digits)
  if (from < MIN_VALID_ID) {
    console.warn(`Invalid ID detected: ${from}`)
    return null
  }

  // Filter routing events (ping responses)
  if (eventType === 'routing') {
    return null
  }

  // Filter store and forward packets
  if (eventName === 'onStoreForwardPacket') {
    return null
  }

  // Determine event type
  let type = lowerCaseFirstLetter(eventType)

  // Handle specific event variants
  const variantCase = event?.data?.variant?.case
  if (variantCase === 'deviceMetrics') {
    type = 'deviceMetrics'
  } else if (variantCase === 'environmentMetrics') {
    type = 'environmentMetrics'
  }

  // Handle specific event names
  switch (eventName) {
    case 'onRangeTestPacket':
      type = 'rangeTest'
      break
    case 'onMessagePacket':
      type = 'message'
      break
    default:
      // Keep the determined type
      break
  }

  return type
}
