import mqtt from "mqtt";

// Функция для фильтрации ошибок
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
        'NOT_AUTHORIZED',
        'invalid wire type',
        'index out of range'
    ];
    return !suppressedErrors.some(error => errorMessage.includes(error));
};

export class MQTTManager {
    constructor() {
        this.connections = new Map();
        this.messageHandler = null;
        this.RECONNECT_DELAY = 5000;
    }

    setMessageHandler(handler) {
        this.messageHandler = handler;
    }

    async connectToAllServers(servers) {
        console.log(`🚀 Подключение к ${servers.length} серверам...\n`);

        // Подключаемся к каждому серверу
        const connectionPromises = servers.map(server => this.connectToServer(server));

        // Ждем подключения ко всем серверам
        await Promise.allSettled(connectionPromises);

        const connectedCount = Array.from(this.connections.values())
            .filter(conn => conn.isConnected).length;

        console.log(`\n🌐 Подключено к ${connectedCount}/${servers.length} серверам`);
        console.log("🎧 Прослушивание сети Meshtastic со всех серверов...\n");
        console.log("=" .repeat(50));
    }

    async connectToServer(server) {
        return new Promise((resolve) => {
            console.log(`🔌 [${server.name}] Подключение...`);

            const clientId = `mqtt_${server.name.replace(/\./g, '_')}_${Math.random().toString(16).substr(2, 8)}`;

            const client = mqtt.connect(server.address, {
                clientId,
                reconnectPeriod: this.RECONNECT_DELAY,
                connectTimeout: 30000,
                keepalive: 60
            });

            // Топики для подписки
            const topics = [
                'msh/+/2/map/',
                'msh/+/2/e/+/+',
                'msh/+/+/2/map/',
                'msh/+/+/2/e/+/+',
                'msh/+/+/+/2/map/',
                'msh/+/+/+/2/e/+/+',
                'msh/+/+/+/+/2/map/',
                'msh/+/+/+/+/2/e/+/+'
            ];

            const connectionInfo = {
                server,
                client,
                isConnected: false,
                reconnectAttempts: 0,
                topics
            };

            this.connections.set(server.name, connectionInfo);

            client.on('connect', () => {
                console.log(`✅ [${server.name}] Подключен`);
                connectionInfo.isConnected = true;
                connectionInfo.reconnectAttempts = 0;

                client.subscribe(topics, (err) => {
                    if (!err) {
                        console.log(`📡 [${server.name}] Подписан на топики`);
                        resolve(connectionInfo);
                    } else {
                        console.error(`❌ [${server.name}] Ошибка подписки:`, err.message);
                        resolve(connectionInfo);
                    }
                });
            });

            client.on('message', (topic, payload) => {
                if (this.messageHandler) {
                    this.messageHandler(server, topic, payload);
                }
            });

            client.on('error', (error) => {
                if (shouldLogError(error.message)) {
                    console.error(`❌ [${server.name}] MQTT ошибка:`, error.message);
                }
                connectionInfo.isConnected = false;
            });

            client.on('close', () => {
                connectionInfo.isConnected = false;
            });

            client.on('offline', () => {
                connectionInfo.isConnected = false;
            });

            // Таймаут для подключения
            setTimeout(() => {
                if (!connectionInfo.isConnected) {
                    resolve(connectionInfo);
                }
            }, 35000);
        });
    }

    disconnect() {
        console.log("\n👋 Отключение от всех серверов...");
        this.connections.forEach((connectionInfo, serverName) => {
            if (connectionInfo.client) {
                connectionInfo.client.end();
                console.log(`✅ [${serverName}] Отключен`);
            }
        });
    }

    getConnectedCount() {
        return Array.from(this.connections.values())
            .filter(conn => conn.isConnected).length;
    }

    isServerConnected(serverName) {
        const connection = this.connections.get(serverName);
        return connection ? connection.isConnected : false;
    }
}

export default MQTTManager;