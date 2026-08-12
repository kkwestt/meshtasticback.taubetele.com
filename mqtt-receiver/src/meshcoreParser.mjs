/**
 * Парсер для декодирования raw данных из MeshCore пакетов
 * Формат отличается от protobuf Meshtastic
 */

/**
 * Декодирует raw пакет MeshCore из hex строки
 * @param {string} rawHex - Hex строка пакета
 * @returns {Object|null} - Декодированные данные пакета или null при ошибке
 */
export function decodeMeshcoreRaw(rawHex) {
  try {
    // Преобразование hex строки в байты
    const byteData = Buffer.from(rawHex, 'hex');
    
    if (byteData.length < 2) {
      console.log(`⚠️ [MeshCore] Пакет слишком короткий: ${byteData.length} байт`);
      return null;
    }
    
    // 1. Извлечение заголовка
    const header = byteData[0];
    
    // Извлечение типа маршрута (биты 0-1)
    const routeTypeValue = header & 0x03;
    const routeTypes = {
      0x00: "TRANSPORT_FLOOD",
      0x01: "FLOOD",
      0x02: "DIRECT",
      0x03: "TRANSPORT_DIRECT"
    };
    const routeType = routeTypes[routeTypeValue] || "UNKNOWN";
    
    // Извлечение типа полезной нагрузки (биты 2-5)
    const payloadTypeValue = (header >> 2) & 0x0F;
    const payloadTypes = {
      0x00: "REQ",
      0x01: "RESPONSE",
      0x02: "TXT_MSG",
      0x03: "ACK",
      0x04: "ADVERT",
      0x05: "GRP_TXT",
      0x06: "GRP_DATA",
      0x07: "ANON_REQ",
      0x08: "PATH",
      0x09: "TRACE",
      0x0A: "MULTIPART",
      0x0F: "RAW_CUSTOM"
    };
    const payloadType = payloadTypes[payloadTypeValue] || `Type${payloadTypeValue}`;
    
    // Извлечение версии протокола (биты 6-7)
    const payloadVersionValue = (header >> 6) & 0x03;
    
    // 2. Проверка наличия транспортных байт
    const hasTransport = routeTypeValue === 0x00 || routeTypeValue === 0x03;
    let offset = 1;
    
    let transport = null;
    if (hasTransport) {
      if (byteData.length < offset + 4) {
        console.log(`⚠️ [MeshCore] Пакет слишком короткий для транспортных байт`);
        return null;
      }
      transport = byteData.slice(offset, offset + 4).toString('hex');
      offset += 4;
    }
    
    // 3. Извлечение длины пути
    if (byteData.length <= offset) {
      console.log(`⚠️ [MeshCore] Пакет слишком короткий для path_len`);
      return null;
    }
    const pathLen = byteData[offset];
    offset += 1;
    
    // 4. Извлечение пути
    if (byteData.length < offset + pathLen) {
      console.log(`⚠️ [MeshCore] Пакет слишком короткий для пути (нужно ${offset + pathLen}, есть ${byteData.length})`);
      return null;
    }
    const path = byteData.slice(offset, offset + pathLen);
    offset += pathLen;
    
    // 5. Извлечение полезной нагрузки
    const payload = byteData.slice(offset);
    
    const result = {
      header: {
        raw: `0x${header.toString(16).padStart(2, '0').toUpperCase()}`,
        routeType,
        routeTypeValue,
        payloadType,
        payloadTypeValue,
        payloadVersion: `VER_${payloadVersionValue + 1}`,
        payloadVersionValue
      },
      transport,
      path: {
        length: pathLen,
        hex: path.toString('hex').toUpperCase()
      },
      payload: {
        length: payload.length,
        hex: payload.toString('hex').toUpperCase(),
        bytes: payload
      },
      totalLength: byteData.length
    };
    
    return result;
  } catch (error) {
    console.log(`⚠️ [MeshCore] Ошибка декодирования raw пакета: ${error.message}`);
    return null;
  }
}

/**
 * Декодирует полезную нагрузку ADVERT пакета
 * @param {Buffer} payloadBytes - Байты полезной нагрузки
 * @returns {Object|null} - Декодированные данные ADVERT или null при ошибке
 */
export function decodeAdvertPayload(payloadBytes) {
  try {
    if (payloadBytes.length < 101) {
      console.log(`⚠️ [MeshCore] ADVERT payload слишком короткий: ${payloadBytes.length} байт`);
      return null;
    }
    
    // Извлечение основных полей
    const pubKey = payloadBytes.slice(0, 32);
    const timestamp = payloadBytes.readUInt32LE(32);
    const signature = payloadBytes.slice(36, 100);
    
    // Извлечение app data
    const appData = payloadBytes.slice(100);
    if (appData.length === 0) {
      console.log(`⚠️ [MeshCore] ADVERT не содержит app data`);
      return null;
    }
    
    // Извлечение флагов
    const flagsByte = appData[0];
    const flags = {
      type: flagsByte & 0x0F,
      hasLocation: Boolean(flagsByte & 0x10),
      hasFeat1: Boolean(flagsByte & 0x20),
      hasFeat2: Boolean(flagsByte & 0x40),
      hasName: Boolean(flagsByte & 0x80)
    };
    
    // Определение типа устройства
    const deviceTypes = {
      0x01: "Companion",
      0x02: "Repeater",
      0x03: "RoomServer",
      0x04: "Sensor"
    };
    const deviceType = deviceTypes[flags.type] || `Type${flags.type}`;
    
    const result = {
      publicKey: pubKey.toString('hex').toUpperCase(),
      advertTime: timestamp,
      signature: signature.toString('hex').toUpperCase(),
      mode: deviceType,
      flags
    };
    
    // Парсинг опциональных полей
    let i = 1; // Начинаем после flags байта
    
    // Координаты
    if (flags.hasLocation) {
      if (appData.length < i + 8) {
        console.log(`⚠️ [MeshCore] ADVERT с флагом location слишком короткий`);
        return result; // Возвращаем что есть
      }
      const lat = appData.readInt32LE(i);
      const lon = appData.readInt32LE(i + 4);
      result.lat = round(lat / 1000000.0, 6);
      result.lon = round(lon / 1000000.0, 6);
      i += 8;
    }
    
    // Feat1
    if (flags.hasFeat1) {
      if (appData.length < i + 2) {
        console.log(`⚠️ [MeshCore] ADVERT с флагом feat1 слишком короткий`);
        return result;
      }
      result.feat1 = appData.readUInt16LE(i);
      i += 2;
    }
    
    // Feat2
    if (flags.hasFeat2) {
      if (appData.length < i + 2) {
        console.log(`⚠️ [MeshCore] ADVERT с флагом feat2 слишком короткий`);
        return result;
      }
      result.feat2 = appData.readUInt16LE(i);
      i += 2;
    }
    
    // Имя
    if (flags.hasName) {
      if (appData.length >= i) {
        const nameBytes = appData.slice(i);
        try {
          // Удаляем нулевые байты в конце
          let nameEnd = nameBytes.length;
          for (let j = nameBytes.length - 1; j >= 0; j--) {
            if (nameBytes[j] === 0) {
              nameEnd = j;
            } else {
              break;
            }
          }
          const name = nameBytes.slice(0, nameEnd).toString('utf-8');
          if (name.length > 0) {
            result.name = name;
          }
        } catch (e) {
          console.log(`⚠️ [MeshCore] Ошибка декодирования имени: ${e.message}`);
        }
      }
    }
    
    return result;
  } catch (error) {
    console.log(`⚠️ [MeshCore] Ошибка декодирования ADVERT payload: ${error.message}`);
    return null;
  }
}

/**
 * Декодирует полный ADVERT пакет MeshCore
 * @param {string} rawHex - Hex строка пакета
 * @returns {Object|null} - Декодированные данные ADVERT или null при ошибке
 */
export function decodeAdvertPacket(rawHex) {
  try {
    const decoded = decodeMeshcoreRaw(rawHex);
    
    if (!decoded) {
      return null;
    }
    
    if (decoded.header.payloadType !== "ADVERT") {
      console.log(`⚠️ [MeshCore] Это не ADVERT пакет, тип: ${decoded.header.payloadType}`);
      return null;
    }
    
    // Декодирование полезной нагрузки ADVERT
    const advertData = decodeAdvertPayload(decoded.payload.bytes);
    
    if (!advertData) {
      return null;
    }
    
    decoded.advertData = advertData;
    return decoded;
  } catch (error) {
    console.log(`⚠️ [MeshCore] Ошибка декодирования ADVERT пакета: ${error.message}`);
    return null;
  }
}

/**
 * Функция округления
 */
function round(num, decimalPlaces = 0) {
  if (typeof num !== "number" || isNaN(num)) return num;
  const factor = Math.pow(10, decimalPlaces);
  return Math.round(num * factor) / factor;
}

