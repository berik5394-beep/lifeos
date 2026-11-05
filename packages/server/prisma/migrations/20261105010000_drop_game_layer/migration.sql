-- Робот-эпик, Часть 1 (2026-11-05, решение Berik «удалить полностью»): старый
-- игровой слой — питомец, Арена/бои/челленджи, ачивки — удалён из кода; его
-- место займёт робот с комнатой. Данные в этих таблицах тестовые (Berik:
-- реальных аккаунтов нет). Связи с User были без каскада → таблицы ОБЯЗАНЫ уйти
-- в одном деплое с кодом, иначе удаление аккаунта упрётся в FK строк-сирот.
-- Порядок: сначала зависимые (Battle/Challenge → ArenaProfile, PetItem → Pet).
-- IF EXISTS + CASCADE (снимает FK) — идемпотентно и на проде, и на чистой БД.
DROP TABLE IF EXISTS "Challenge" CASCADE;
DROP TABLE IF EXISTS "Battle" CASCADE;
DROP TABLE IF EXISTS "ArenaProfile" CASCADE;
DROP TABLE IF EXISTS "PetItem" CASCADE;
DROP TABLE IF EXISTS "Pet" CASCADE;
DROP TABLE IF EXISTS "Achievement" CASCADE;
