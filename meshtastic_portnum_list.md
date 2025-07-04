# Список всех известных Portnum в Meshtastic

## Основные приложения (Apps)

### 1. TEXT_MESSAGE_APP (1)
- **Описание**: Текстовые сообщения
- **Использование**: Обычные текстовые сообщения между устройствами
- **Формат данных**: UTF-8 строка

### 3. POSITION_APP (3)
- **Описание**: GPS позиция
- **Использование**: Передача координат GPS
- **Формат данных**: Position protobuf

### 4. NODEINFO_APP (4)
- **Описание**: Информация об узле
- **Использование**: Имя устройства, модель, MAC адрес
- **Формат данных**: User protobuf

### 8. WAYPOINT_APP (8)
- **Описание**: Путевые точки
- **Использование**: Маркеры на карте, точки интереса
- **Формат данных**: Waypoint protobuf

### 67. TELEMETRY_APP (67)
- **Описание**: Телеметрия устройства
- **Использование**: Батарея, напряжение, температура, влажность
- **Формат данных**: Telemetry protobuf

### 71. NEIGHBORINFO_APP (71)
- **Описание**: Информация о соседних узлах
- **Использование**: Список соседних устройств и их SNR
- **Формат данных**: NeighborInfo protobuf

### 73. MAP_REPORT_APP (73)
- **Описание**: Отчет карты
- **Использование**: Информация об устройстве для карт
- **Формат данных**: MapReport protobuf

## Системные приложения

### 0. UNKNOWN_APP (0)
- **Описание**: Неизвестное приложение
- **Использование**: Ошибка или неопределенный тип

### 2. REMOTE_HARDWARE_APP (2)
- **Описание**: Удаленное управление железом
- **Использование**: GPIO, I2C команды

### 5. REPLY_APP (5)
- **Описание**: Ответ на сообщение
- **Использование**: Автоматические ответы

### 6. IP_TUNNEL_APP (6)
- **Описание**: IP туннель
- **Использование**: Передача IP пакетов

### 7. SERIAL_APP (7)
- **Описание**: Последовательный порт
- **Использование**: Передача данных через serial

### 9. AUDIO_APP (9)
- **Описание**: Аудио данные
- **Использование**: Передача звука (экспериментально)

### 10. DETECTION_SENSOR_APP (10)
- **Описание**: Датчик обнаружения
- **Использование**: PIR, движение, присутствие

## Специальные приложения

### 32. PRIVATE_APP (32)
- **Описание**: Частное приложение
- **Использование**: Пользовательские данные

### 33. ATAK_FORWARDER (33)
- **Описание**: ATAK форвардер
- **Использование**: Интеграция с ATAK (Android Team Awareness Kit)

### 64. RANGE_TEST_APP (64)
- **Описание**: Тест дальности
- **Использование**: Проверка качества связи

### 65. STORE_FORWARD_APP (65)
- **Описание**: Хранение и пересылка
- **Использование**: Буферизация сообщений

### 66. ZPS_APP (66)
- **Описание**: Zero Power Sleep
- **Использование**: Управление энергопотреблением

### 68. SIMULATOR_APP (68)
- **Описание**: Симулятор
- **Использование**: Тестирование и отладка

### 69. TRACEROUTE_APP (69)
- **Описание**: Трассировка маршрута
- **Использование**: Определение пути пакетов

### 70. PAXCOUNTER_APP (70)
- **Описание**: Счетчик людей
- **Использование**: Подсчет устройств поблизости

### 72. POWERSTRESS_APP (72)
- **Описание**: Стресс-тест питания
- **Использование**: Тестирование энергопотребления

## Зарезервированные диапазоны

### 256-511: Зарезервировано для будущих системных приложений
### 512-1023: Зарезервировано для пользовательских приложений

## Примечания

1. **Наиболее часто используемые**: 1 (TEXT_MESSAGE), 3 (POSITION), 4 (NODEINFO), 67 (TELEMETRY)
2. **Экспериментальные**: 9 (AUDIO), 68 (SIMULATOR)
3. **Специализированные**: 33 (ATAK), 65 (STORE_FORWARD), 71 (NEIGHBORINFO)

## Обработка в коде

```javascript
getEventTypeByPortnum(portnum) {
  switch (portnum) {
    case 1:
    case "TEXT_MESSAGE_APP":
      return "message";
    case 3:
    case "POSITION_APP":
      return "position";
    case 4:
    case "NODEINFO_APP":
      return "user";
    case 67:
    case "TELEMETRY_APP":
      return "telemetry";
    case 71:
    case "NEIGHBORINFO_APP":
      return "neighborInfo";
    case 8:
    case "WAYPOINT_APP":
      return "waypoint";
    case 73:
    case "MAP_REPORT_APP":
      return "mapReport";
    default:
      return null;
  }
}
```

Этот список основан на официальной документации Meshtastic и может обновляться с новыми версиями прошивки.
