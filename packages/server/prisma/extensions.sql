-- Phase 2.3: pgvector. Идемпотентно, выполняется ПЕРЕД `prisma db push`
-- (db push сам расширения не ставит, а колонка vector(512) без него
-- не создастся). Railway managed Postgres поддерживает pgvector.
CREATE EXTENSION IF NOT EXISTS vector;
