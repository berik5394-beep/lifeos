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

# Применение миграций перед стартом сервера.
# Phase A polish 2026-05-31 (#8 Path B): переехали с `db push` на `migrate
# deploy`. Старый `db push` не вёл audit history (_prisma_migrations) и
# не применял custom SQL внутри migration files (GIN indexes на
# entityRefs не доходили до прода — fixed Q5).
#
# `migrate deploy` применяет только новые migrations из /prisma/migrations
# в порядке timestamps, проверяет _prisma_migrations table, идемпотентен.
# Уже-применённые migrations пропускаются. Все 16 existing migrations
# baseline'нуты вручную через `migrate resolve --applied` на prod
# 2026-05-31 (см. docs/RELEASE.md). 2 missing GIN indexes были применены
# через `db execute --file` на той же сессии — теперь они в проде.
#
# pgvector extension ДО migrate deploy: Prisma extensions не ставит,
# колонка vector(512) без extension не создастся. Сам файл extensions.sql
# идемпотентен (CREATE EXTENSION IF NOT EXISTS).
CMD ["sh", "-c", "npx prisma db execute --schema=prisma/schema.prisma --file prisma/extensions.sql && npx prisma migrate deploy --schema=prisma/schema.prisma && node dist/index.js"]
