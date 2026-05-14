# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Production stage ─────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Regenerate Prisma client for production
RUN npx prisma generate

EXPOSE 3000

# Синхронизация схемы перед стартом сервера.
# `db push` идемпотентен: на свежей БД создаст все таблицы, на существующей
# добавит недостающие. Без `--accept-data-loss` ничего не удалит и не сломает
# существующие данные — если возникнет конфликт типов, контейнер упадёт
# с понятной ошибкой (это лучше тихого runtime-краша).
# `--skip-generate` потому что клиент уже сгенерирован на build-стадии.
# Для proper релизов с историей миграций позже переедем на `migrate deploy`.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
