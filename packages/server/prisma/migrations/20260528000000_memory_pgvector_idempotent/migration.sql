-- Memory + pgvector — schema-drift closure (2026-05-28).
--
-- Раньше: Memory table создавался через `prisma db push` + ad-hoc
-- `prisma/extensions.sql` (CREATE EXTENSION vector) ВНЕ `migrations/`.
-- Drift между dev/prod не контролируется; если extension не накатили
-- ДО push — runtime тихо роняет SQL «column embedding does not exist».
--
-- Этот migration ИДЕМПОТЕНТЕН: использует IF NOT EXISTS, в проде
-- (где всё уже создано) = no-op, в чистой dev/test базе = создаст.
-- Не блокирует `prisma migrate deploy` который Railway гоняет на
-- каждый деплой.
--
-- Note: pgvector extension должен быть allowed в Railway managed
-- Postgres (по умолчанию — да). На локальном Postgres без pgvector
-- этот migration упадёт на первой строке — это правильно
-- (видно проблему сразу).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "Memory" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "type"       TEXT NOT NULL,
    "content"    TEXT NOT NULL,
    "details"    TEXT,
    "source"     TEXT NOT NULL,
    "sourceId"   TEXT,
    "tags"       TEXT[],
    "importance" INTEGER NOT NULL DEFAULT 5,
    "expiresAt"  TIMESTAMP(3),
    "embedding"  vector(512),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- FK на User (cascade delete — если юзер удалён, его память тоже)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Memory_userId_fkey'
    ) THEN
        ALTER TABLE "Memory"
        ADD CONSTRAINT "Memory_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Indexes (matches schema.prisma @@index decls)
CREATE INDEX IF NOT EXISTS "Memory_userId_type_idx" ON "Memory"("userId", "type");
CREATE INDEX IF NOT EXISTS "Memory_userId_createdAt_idx" ON "Memory"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Memory_userId_importance_idx" ON "Memory"("userId", "importance");
