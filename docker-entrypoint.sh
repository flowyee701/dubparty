#!/bin/sh
# Тома на Fly.io, Render и в docker compose монтируются с владельцем root, а сервер работает
# от непривилегированного пользователя. Поэтому: выдаём права на каталог данных и сбрасываем
# привилегии перед запуском.
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "$STORAGE_DIR"
  chown -R node:node "$DATA_DIR" "$STORAGE_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
