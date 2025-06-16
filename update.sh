#!/bin/sh
echo "Auto-update script for Meshtastic Monitor"

while true; do
    echo "Checking for updates..."

    # Переходим в директорию приложения
    cd /app

    # Получаем обновления
    git fetch origin

    # Проверяем есть ли изменения
    if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
        echo "Updates found! Pulling changes..."
        git pull origin main

        # Проверяем изменился ли package.json
        if git diff HEAD@{1} --name-only | grep -q "package.json"; then
            echo "package.json changed, updating dependencies..."
            npm install
        fi

        echo "Restarting container..."
        # Отправляем сигнал для перезапуска
        kill -TERM 1
    else
        echo "No updates available"
    fi

    # Ждем 5 минут
    sleep 300
done
