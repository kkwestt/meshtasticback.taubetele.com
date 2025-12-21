/**
 * Асинхронная очередь для обработки MQTT сообщений
 * Позволяет обрабатывать сообщения параллельно без блокировки event loop
 */
export class MessageQueue {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 10; // Количество параллельных обработчиков
    this.queue = [];
    this.processing = new Set();
    this.handlers = new Map();
    this.stats = {
      processed: 0,
      failed: 0,
      queued: 0,
    };
  }

  /**
   * Добавляет обработчик для определенного типа сообщений
   */
  addHandler(messageType, handler) {
    this.handlers.set(messageType, handler);
  }

  /**
   * Добавляет сообщение в очередь
   */
  async enqueue(messageType, data) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        messageType,
        data,
        resolve,
        reject,
        timestamp: Date.now(),
      });
      this.stats.queued++;
      this._process();
    });
  }

  /**
   * Обрабатывает очередь сообщений
   */
  async _process() {
    // Если уже обрабатываем максимальное количество или очередь пуста
    if (this.processing.size >= this.concurrency || this.queue.length === 0) {
      return;
    }

    // Берем следующее сообщение из очереди
    const item = this.queue.shift();
    if (!item) return;

    this.processing.add(item);

    // Обрабатываем асинхронно
    this._handleItem(item)
      .then(() => {
        this.stats.processed++;
        item.resolve();
      })
      .catch((error) => {
        this.stats.failed++;
        console.error(
          `[MessageQueue] Error processing message ${item.messageType}:`,
          error.message
        );
        item.reject(error);
      })
      .finally(() => {
        this.processing.delete(item);
        // Продолжаем обработку очереди
        setImmediate(() => this._process());
      });
  }

  /**
   * Обрабатывает одно сообщение
   */
  async _handleItem(item) {
    const handler = this.handlers.get(item.messageType);
    if (!handler) {
      throw new Error(`No handler for message type: ${item.messageType}`);
    }

    return await handler(item.data);
  }

  /**
   * Получает статистику очереди
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      processing: this.processing.size,
    };
  }

  /**
   * Очищает очередь
   */
  clear() {
    this.queue = [];
  }

  /**
   * Ожидает завершения обработки всех сообщений
   */
  async drain() {
    while (this.queue.length > 0 || this.processing.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export default MessageQueue;
