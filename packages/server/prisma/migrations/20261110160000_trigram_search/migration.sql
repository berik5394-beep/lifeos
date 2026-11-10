-- Поиск «по кусочкам букв» (триграммы) — по всей системе (Berik 2026-11-10: «друг с памятью»).
-- Голос коверкает слова («Сирик» вместо «Серик»): по корням и по смыслу такое
-- не находится, а по общим кусочкам по 3 буквы — находится.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Память: быстрый поиск записей, похожих на слова вопроса (оператор <%, ~1 мс на 10k записей).
CREATE INDEX IF NOT EXISTS "Memory_content_trgm_idx" ON "Memory" USING gin (content gin_trgm_ops) WHERE type <> 'message';
