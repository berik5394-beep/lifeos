-- Единые категории трат (аудит проводки 2026-11-08): сервер писал 'home', а
-- приложение показывает и принимает 'housing' («Жильё») — траты «за квартиру»,
-- записанные роботом, не попадали ни в таблицу, ни под лимит «Жилья».
UPDATE "Expense" SET "category" = 'housing' WHERE "category" = 'home';

-- Лимиты: переносим, если на тот же месяц нет уже лимита «Жильё» (уникальный ключ).
UPDATE "BudgetLimit" b SET "category" = 'housing'
WHERE b."category" = 'home'
  AND NOT EXISTS (
    SELECT 1 FROM "BudgetLimit" h
    WHERE h."userId" = b."userId" AND h."category" = 'housing' AND h."month" = b."month" AND h."year" = b."year"
  );
