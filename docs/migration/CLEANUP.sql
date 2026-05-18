-- ISSUE-8 one-time cleanup of pre-gate junk rows.
-- РУЧНОЙ запуск в Railway → Postgres → Query. Сначала ШАГ 1
-- (посмотреть), реши что мусор, потом ШАГ 2 (удалить точечно).

-- ШАГ 1 — посмотреть все задачи (что реально, что NLP-мусор/тест):
SELECT id, title, category, priority, date, completed, "createdAt"
FROM "Task" ORDER BY "createdAt" DESC;

-- посмотреть события календаря (тест-событие и т.п.):
SELECT id, title, date, "startTime", source, "createdAt"
FROM "CalendarEvent" ORDER BY "createdAt" DESC;

-- ШАГ 2 — удалить ТОЧЕЧНО по id (подставь реальные id из ШАГА 1).
-- НЕ запускай вслепую. Пример (замени id на свои):
-- DELETE FROM "Task" WHERE id IN ('<id1>','<id2>');
-- DELETE FROM "CalendarEvent" WHERE id IN ('<id>');

-- ИЛИ, если уверен, по точным мусорным заголовкам (проверь ШАГ 1!):
-- DELETE FROM "Task" WHERE title IN (
--   'Будильник на 7 утра','тест реестра','Тест реестра',
--   'Определиться с местом для поездки',
--   'Купить билет в Астану','Проложить маршрут к месту встречи'
-- );
-- DELETE FROM "CalendarEvent" WHERE title ILIKE 'тест-событие%';
