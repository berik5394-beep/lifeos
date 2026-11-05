# Habit-day: одна дата отметки привычки + отметки с сервера в приложении

**Дата:** 2026-11-05 · **Зачем:** предсборочный фикс №1 перед TestFlight (Berik тестирует мобилку с друзьями). Бот не трогаем (правило Berik) — чиним серверный мозг/REST ради приложения.

## Проблема (проверено по коду)

`HabitLog.date` (`@db.Date`) пишется/читается в трёх конвенциях:
- **A — календарная дата юзера** (`YYYY-MM-DDT00:00:00Z`): так пишет приложение (`routes/habits.ts:154`), так же устроены задачи/события (правило 2026-06-06: @db.Date = UTC-полночь календарной даты, `localDateOnlyUTC`).
- **B — `localDayStartUTC(tz)`** (реальный инстант локальной полуночи; для UTC+ зон = ВЧЕРА в @db.Date): так пишут инструменты `complete_habit` / `complete_multiple_habits`, которыми теперь пользуется голос/чат ПРИЛОЖЕНИЯ; так читают open-loops, assistant-service, proactive-notifications, v2-proactivity-engine.
- **C — полночь сервера** (`setHours(0)` на UTC-сервере): streak-service, pet-streak, pet-роуты, proactive-insights, /voice/assistant, export.

Плюс: **приложение не загружает отметки с сервера** — `GET /habits` без логов, галочки только из локального стора → голосовые/чатовые отметки не видны, после переустановки история пропадает.

## Решение

Конвенция A везде. Хелпер `localDateOnlyUTC(tz, at)` (уже есть в `lib/tz.ts`) — единственный «день привычки».

**Сервер**
1. Писатели: `tools/complete-habit.ts`, `tools/complete-multiple-habits.ts` → `localDateOnlyUTC(tz)`.
2. Читатели «сегодня/вчера» → `localDateOnlyUTC(user tz)`:
   `services/open-loops.ts`, `services/assistant-service.ts`, `services/proactive-notifications.ts`, `services/v2-proactivity-engine.ts`, `services/streak-service.ts` (`calculateStreak`), `services/pet-streak-service.ts`, `routes/pet.ts`, `services/proactive-insights.ts` (`generateInsights`), `routes/voice.ts` (`/voice/assistant`), `routes/notifications.ts`, `routes/briefing.ts`, `routes/export.ts`, `routes/achievements.ts` — где речь о конкретном дне.
   Диапазоны «за 30 дней» (life-truth, procedural, reflector, stats/месяц) терпимы к ±1 дню — не трогаем.
3. Новый `GET /habits/logs?from=YYYY-MM-DD&to=YYYY-MM-DD` (≤ 62 дня) → `[{ id, habitId, date: 'YYYY-MM-DD', completed }]`.
4. Старые строки, записанные ботом в конвенции B, НЕ мигрируем (тестовые данные, правило Berik).

**Мобилка**
5. `habit-store.fetchLogs(from, to)` → раскладывает логи по `logs[date]` (замещая диапазон); дашборд (неделя) и экран привычек (месяц) зовут его в своём `handleRefresh` и при загрузке.

## Тесты
- it (реальная БД, пояс `Pacific/Kiritimati` UTC+14 — там конвенция B всегда даёт «вчера», тест не зависит от часов): `complete_habit` через реестр → `GET /habits/logs` возвращает отметку на ЛОКАЛЬНОЕ сегодня; REST-отметка на локальное сегодня → open-loops не считает привычку открытой, `calculateStreak` ≥ 1.
- Обновить it-тесты, закрепившие конвенцию B (open-loops.it).
- Структурный гард: в `src/` нет `localDayStartUTC` рядом с `habitLog` (кроме таймстемпов).
- jest: `fetchLogs` раскладывает по датам и замещает диапазон.
