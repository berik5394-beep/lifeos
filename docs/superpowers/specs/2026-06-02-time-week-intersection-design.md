# Движок пересечения — Срез 2: «Неделя перегружена» (время-в-неделю)

**Дата:** 2026-06-02
**Статус:** дизайн одобрен Berik (ждёт ревью спеки)
**Тип:** второй горизонт общего движка (после дня). Server-only. Тонкий клон дня на то же ядро.

## 1. Этот срез

Движок `computeCapacityFit` (ёмкость vs Σспрос → защити важные → overflow «перенести») доказан на деньгах и времени-в-день. **Срез 2 = тот же паттерн на горизонте НЕДЕЛИ:** когда суммарное оценённое время задач недели превышает свободное время недели → бот предупреждает «неделя перегружена», предлагает перенести/разнести.

## 2. Два числа (адаптер `services/week-load.ts`)

- **Ёмкость (свободные минуты недели)** = сумма по оставшимся дням недели (локально, **пн–вс**, по `User.timezone`) дневной свободной ёмкости: окно `09:00–20:00` − события календаря этого дня. Сегодня — от «сейчас» (исключает прошедшее); будущие дни недели — полное окно. Переиспользуем `availableMinutesToday(dayEvents, hhmm)` (для будущих дней `hhmm='00:00'` → полное окно). Итерация по дням — в `gatherWeekLoad` (DB).
- **Спрос** = Σ `estimatedMinutes ?? 30` невыполненных задач с `date` в `[weekStart..weekEnd]`. ИИ-оценка времени задачи уже ставится фоном (срез 1). `importance` = `Task.importance ?? mapPriority(priority)` (переиспользуем из day-load).

Границы недели: `weekStart` = локальный понедельник 00:00 текущей недели (из `localDayStartUTC` + `localDayOfWeek`), `weekEnd` = +6 дней. Оставшиеся дни = `[today..weekEnd]` (сегодня от «сейчас»).

## 3. Подача (реактив, день в приоритете)

В пути `create_task` (после дневного хука): **если перегружен ДЕНЬ → дневная строка; иначе если перегружена НЕДЕЛЯ → недельная.** Так не задвоится. Реализация: `const day = await maybeDayLoadLine(...); const week = day ? null : await maybeWeekLoadLine(...); const extra = day ?? week;`.

`maybeWeekLoadLine(userId, now)` — зеркало `maybeSavingsCoachLine`/`maybeDayLoadLine`: best-effort try/catch→null, гейт только `overloaded`, ≤1/день дедуп против СВОИХ (Insight `scopeKey:'time:week_load', source:'week_load', createdAt≥dayStart`), `deliveredAt:now`.

**Строка** `describeWeekLoad(fit)` (null на fits/tight): *«На этой неделе задач примерно на ~Xч, а свободного времени ~Yч — не всё влезет. Перенести «{overflow[0]}»{ (и ещё N)} или разнести по дням? И хватит ли времени на «{fit[0]}»?»*

## 4. Данные / миграции / флаг

- **Без миграции** (`Task.date`/`estimatedMinutes`/`importance` уже есть).
- **Без новых настроек** (окно 09:00–20:00 как у дня).
- Флаг `FEATURE_V2_WEEK_LOAD` (`isV2WeekLoadEnabled`, форма `all`/user-X). Off = байт-в-байт (week-хук возвращает null → `extra` = только день).

## 5. Переиспользование

`computeCapacityFit` (ядро), `availableMinutesToday`/`timeDiff` (`_slots.ts`), `mapPriority`/`DEFAULT_TASK_MINUTES` (из day-load — вынести в общий модуль или импортировать), `localDayStartUTC`/`localDayOfWeek`/`localTimeStr` (`tz.ts`), Insight-дедуп. **День/деньги НЕ трогаем.**

## 6. Тестирование

- **Pure unit `describeWeekLoad`:** overloaded → строка с «разнести по дням» + overflow + вопрос; fits/tight → null.
- **Pure unit недельной ёмкости:** хелпер суммы по дням (если выделим `sumDaysCapacity`) — будущие дни полное окно, сегодня от now, события вычитаются. (Или структурно, если сумма в gatherWeekLoad.)
- **Structural:** `maybeWeekLoadLine` зовёт gather+fit+describe + дедуп `time:week_load`/`week_load`; `gatherWeekLoad` фильтрует задачи `[weekStart..weekEnd]` + суммирует дневную ёмкость; create_task — день-в-приоритете (`day ? null : week`).
- Базовая сюита (2129) зелёная, tsc 0, zero vi.mock.

## 7. Non-goals (осознанно)

- **Недельные цели `WeeklyGoal`** в спросе — текст без оценки времени. Подключение (ИИ-оценка времени на цель) = week-срез v2 / data-долг.
- **Воскресный/понедельничный брифинг** «неделя впереди» (проактивно через scheduler) — fast-follow; v1 = реактив.
- Персональное окно, месяц/год — отдельные срезы.

## 8. Файлы

- Create `services/week-load.ts` (+test) — `gatherWeekLoad`/`describeWeekLoad`/`maybeWeekLoadLine` (+ опц. pure `sumWeekCapacity`).
- Modify `services/day-load.ts` — экспортировать `mapPriority`/`DEFAULT_TASK_MINUTES` для переиспользования (или вынести в `capacity-fit.ts`/новый общий модуль).
- Modify `lib/feature-flags.ts` — `isV2WeekLoadEnabled`.
- Modify `tools/create-task.ts` — week-хук после дня (день в приоритете).
- structural/unit тесты.
