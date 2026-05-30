# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets
RUN npm run build

# ── Production stage ─────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
# A.6: шрифт с кириллицей для реального PDF-экспорта (pdfkit-Helvetica
# не умеет русский). Путь рантайма — process.cwd()/assets.
COPY --from=builder /app/assets ./assets

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
# Phase 2.3: pgvector extension ДО db push (db push расширения не ставит,
# а колонка vector(512) без расширения не создастся). Идемпотентно.
CMD ["sh", "-c", "npx prisma db execute --schema=prisma/schema.prisma --file prisma/extensions.sql && npx prisma migrate deploy --schema=prisma/schema.prisma && node dist/index.js"]
