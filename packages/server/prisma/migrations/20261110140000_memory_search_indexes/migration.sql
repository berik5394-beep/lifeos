-- Поиск по памяти робота быстрее (Berik 2026-11-10: «нет индекса — при росте поиск замедлится»).
-- Замер на 30k записей у одного человека (10k «живых»): 110–185 мс, из них ~80 мс —
-- to_tsvector, который считался заново для КАЖДОЙ записи на КАЖДЫЙ запрос, и ~75 мс —
-- чтение служебных message-строк, которые потом отбрасывались. Векторный ANN-индекс
-- (HNSW) тут не помогает: поиск ранжирует общей формулой (слова+смысл+важность+свежесть).

-- 1. Слова записи считаются один раз — при записи (триггер), а не при каждом поиске.
--    (вычисляемую колонку нельзя: array_to_string не IMMUTABLE)
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

CREATE OR REPLACE FUNCTION memory_search_vector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" := to_tsvector('russian',
    coalesce(NEW.content, '') || ' ' || coalesce(NEW.details, '') || ' ' || coalesce(array_to_string(NEW.tags, ' '), ''));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS memory_search_vector_trg ON "Memory";
CREATE TRIGGER memory_search_vector_trg
  BEFORE INSERT OR UPDATE OF content, details, tags ON "Memory"
  FOR EACH ROW EXECUTE FUNCTION memory_search_vector();

UPDATE "Memory" SET "searchVector" = to_tsvector('russian',
  coalesce(content, '') || ' ' || coalesce(details, '') || ' ' || coalesce(array_to_string(tags, ' '), ''))
WHERE "searchVector" IS NULL;

CREATE INDEX IF NOT EXISTS "Memory_searchVector_idx" ON "Memory" USING gin ("searchVector");

-- 2. Только «живые» типы человека — без служебных message-строк (их большинство).
CREATE INDEX IF NOT EXISTS "Memory_userId_live_idx" ON "Memory" ("userId", "createdAt") WHERE type <> 'message';

-- 3. Склейка дублей и «замена устаревшего» ищут по словам content на каждой записи памяти.
CREATE INDEX IF NOT EXISTS "Memory_content_fts_idx" ON "Memory" USING gin (to_tsvector('russian', coalesce(content, '')));
