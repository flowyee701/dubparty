# syntax=docker/dockerfile:1

# ── Сборка ────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# В образе используется системный ffmpeg — бинарник из npm не скачиваем.
ENV FFMPEG_BIN=/usr/bin/ffmpeg
# Компилятор нужен только на этапе сборки: если для платформы нет готового бинарника
# better-sqlite3 (так бывает на arm64), модуль собирается из исходников.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.15.9
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm build

# Только продакшен-зависимости сервера, без dev-инструментов.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @dubparty/server deploy --prod /out/server \
 # В образе работает системный ffprobe; бинарники из npm под все платформы (300+ МБ) не нужны.
 && rm -rf /out/server/node_modules/.pnpm/ffprobe-static@*/node_modules/ffprobe-static/bin

# ── Рантайм ───────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DUBPARTY_ROOT=/app \
    DATA_DIR=/data/db \
    STORAGE_DIR=/data/storage \
    CLIENT_DIST=/app/client \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

WORKDIR /app
COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/assets ./assets
COPY --from=build /app/apps/client/dist ./client
COPY --from=build /app/apps/server/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Файлы приложения остаются за root и доступны только на чтение; серверу нужен лишь каталог данных.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data/db /data/storage \
 && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Точка входа стартует от root только чтобы выдать права на том, затем переходит на пользователя node.
ENTRYPOINT ["/usr/bin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
