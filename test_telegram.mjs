#!/usr/bin/env node

// Тестовый скрипт для проверки функций Telegram бота
import {
  toNumericId,
  getDeviceStats,
  getGatewayInfoBatch,
} from "./telegram.mjs";

console.log("🧪 Тестирование функций Telegram бота...\n");

// Тест функции toNumericId
console.log("1. Тест функции toNumericId:");
console.log('   toNumericId("!12aabb34") =', toNumericId("!12aabb34"));
console.log('   toNumericId("!00d7ab4c") =', toNumericId("!00d7ab4c"));
console.log('   toNumericId("22782998") =', toNumericId("22782998"));
console.log("");

// Тест функции getDeviceStats (мок)
console.log("2. Тест функции getDeviceStats:");
console.log("   Функция определена:", typeof getDeviceStats === "function");
console.log("   Параметры:", getDeviceStats.length, "аргументов");
console.log("");

// Тест функции getGatewayInfoBatch (мок)
console.log("3. Тест функции getGatewayInfoBatch:");
console.log(
  "   Функция определена:",
  typeof getGatewayInfoBatch === "function"
);
console.log("   Параметры:", getGatewayInfoBatch.length, "аргументов");
console.log("");

console.log("✅ Все функции определены корректно!");
console.log("");
console.log(
  "📝 Примечание: Для полного тестирования нужен работающий Redis сервер"
);
console.log("   и экземпляр RedisManager с данными устройств.");
