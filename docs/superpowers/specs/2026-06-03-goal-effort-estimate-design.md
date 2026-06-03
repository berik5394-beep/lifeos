# ИИ-оценка усилия недельных целей — Design (data-слой перед срезом МЕСЯЦ)

**Дата:** 2026-06-03
**Статус:** одобрено Berik (охват: только недельные цели)
**Контекст:** движок пересечения времени. День ✅ + Неделя ✅ в проде. Следующий горизонт — МЕСЯЦ. Month-load сравнивает Σ обязательств месяца с ёмкостью месяца. Обязательства = задачи (у них уже `Task.estimatedMinutes`) + недельные цели месяца. У `WeeklyGoal` числовой оценки нет (только `goalText`). Эта фича закрывает data-пробел.

## 1. Цель (одной строкой)

Добавить `WeeklyGoal.estimatedMinutes` — ИИ-оценку усилия В МИНУТАХ ЗА НЕДЕЛЮ (haiku, фоном, идемпотентно), зеркало паттерна `estimate-task-minutes.ts`. Питает будущий `month-load.ts`.

## 2. Охват

**В охвате:** недельные цели (`WeeklyGoal`).
**НЕ в охвате (YAGNI / следующие срезы):**
- Годовые цели (`YearlyGoal`) — отдельный дизайн вместе со срезом ГОД (там распутаем деньги-vs-время и риск двойного счёта).
- Сам `month-load.ts` нудж — следующий срез (тот же флаг).
- Привычки как источник спроса.
- Бэкофилл старых недельных целей — month-load и так использует fallback `?? DEFAULT`.

## 3. Архитектура (Approach A — зеркало задач)

Изолированный новый модуль `services/estimate-goal-minutes.ts`. НЕ трогаем прод-стабильные `estimate-task-minutes.ts` / `day-load.ts` / `week-load.ts` / `savings-*`.

### 3.1 Схема + миграция
`WeeklyGoal.estimatedMinutes Int?` (nullable, без дефолта).

Миграция руками (additive + idempotent, конвенция проекта):
```sql
ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "estimatedMinutes" INTEGER;
```
Папка `prisma/migrations/<timestamp>_weekly_goal_estimated_minutes/migration.sql`. Прод-путь = `prisma db push` (Dockerfile). Context7 (prisma.io) подтвердил: nullable-колонка через `db push` неразрушительна (`db push` падает только на REQUIRED-поле без дефолта на непустой таблице). Локально `prisma generate` для типов; НИКОГДА `db push`/`migrate dev` против прод-.env.

### 3.2 Эстиматор `services/estimate-goal-minutes.ts`
```
DEFAULT_GOAL_MINUTES = 120   // 2 ч/нед
MIN_GOAL_MINUTES     = 15
MAX_GOAL_MINUTES     = 1200  // 20 ч/нед
```

- `parseGoalMinutes(text: string): number` — чистая. Первое число из ответа. `0` → `0` (цель не про время, напр. деньги → нулевой спрос). Иначе кламп `[15, 1200]`. Нет числа / не finite → `DEFAULT_GOAL_MINUTES`.
- `estimateWeeklyGoalMinutes(goalText: string): Promise<number>` — haiku, best-effort. `CLAUDE_API_KEY` нет → DEFAULT. `createAnthropic(apiKey)` + `MODELS.haiku`. Prompt: «Оцени, сколько МИНУТ усилия в НЕДЕЛЮ среднему человеку нужно на эту недельную цель. Если цель не про затраты времени (например, накопить денег) — верни 0. Верни ТОЛЬКО целое число минут, без слов.» Любой сбой → DEFAULT.
- `estimateWeeklyGoalMinutesInBackground(goalId, goalText, userId): Promise<void>` — fire-and-forget. Гейт `isV2MonthLoadEnabled(userId)`. Идемпотентная запись: `prisma.weeklyGoal.updateMany({ where: { id: goalId, estimatedMinutes: null }, data: { estimatedMinutes } })`. Любой сбой проглатывается.

### 3.3 Флаг `FEATURE_V2_MONTH_LOAD` (`isV2MonthLoadEnabled`)
Срез МЕСЯЦ доставляется в 2 шага под ОДНИМ флагом: (1) data-слой = эта фича; (2) нудж month-load = следующий срез. Форма как у `isV2DayLoadEnabled` (через `isEnabledForUser`: `all` / `none`/`unset` / `user-X`). Off → оценка не запускается, поле остаётся `null`, поведение байт-в-байт. Можно включить флаг заранее, чтобы «прогреть» оценки до появления month-load.

### 3.4 Хуки (оба fire-and-forget, под флагом)
- **REST:** `routes/goals.ts` POST `/goals/weekly` — после `prisma.weeklyGoal.create(...)`: `void estimateWeeklyGoalMinutesInBackground(goal.id, goal.goalText, userId)`. (Путь для мобайла позже.)
- **Планировщик:** `services/planner-service.ts persistPlan` — **реальный текущий путь** (декомпозиция год→недели через голос/чат). После bulk-создания недельных целей пройтись по созданным строкам и `void estimateWeeklyGoalMinutesInBackground(...)` на каждую. Использовать id+goalText реально созданных строк.

## 4. Поток данных
```
создание недельной цели (route | planner)
  └─(флаг on)→ estimateWeeklyGoalMinutesInBackground (fire-and-forget)
        └→ estimateWeeklyGoalMinutes(goalText) [haiku] → parseGoalMinutes → минуты
        └→ updateMany({id, estimatedMinutes:null}) → WeeklyGoal.estimatedMinutes
  ответ пользователю НЕ ждёт оценку
[следующий срез] month-load: demand += Σ WeeklyGoal.estimatedMinutes ?? DEFAULT по месяцу
```

## 5. Обработка ошибок
Любой сбой эстиматора → DEFAULT_GOAL_MINUTES; голос/REST-ответ никогда не падает (как у задач). Burst haiku из планировщика — фоном, не блокирует ответ. `updateMany` с `.catch` проглатывается.

## 6. Тестирование (zero vi.mock; структурные через readFileSync+grep)
- `parseGoalMinutes` юнит: целое в диапазоне; `0`→`0`; ниже MIN→кламп; выше MAX→кламп; мусор/нет числа→DEFAULT; дробное/отрицательное→DEFAULT.
- Структурные `estimate-goal-minutes.ts`: гейт `isV2MonthLoadEnabled`; `createAnthropic` + `MODELS.haiku`; идемпотентный `updateMany({ ... estimatedMinutes: null ... })`.
- Структурный флаг: `isV2MonthLoadEnabled` off-по-умолчанию + `all`.
- Структурные хуки: `routes/goals.ts` содержит `estimateWeeklyGoalMinutesInBackground`; `planner-service.ts` содержит `estimateWeeklyGoalMinutesInBackground`.
- Изоляция: `estimate-task-minutes.ts` / `day-load.ts` / `week-load.ts` / `savings-*` не изменены (diff-grep).
- Полная сюита зелёная (база 2139) + `npx tsc --noEmit` 0.

## 7. Инварианты / безопасность
- Флаг off = байт-в-байт (оценка не зовётся, поле null).
- Best-effort: эстиматор НИКОГДА не валит создание цели.
- Идемпотентность: пишем только если `estimatedMinutes IS NULL` (не перезатираем правки/предыдущие оценки).
- Деньги/день/неделя не тронуты.
- Прод-миграция additive nullable — без потери данных.

## 8. Дисциплина выката
Коммит на шаг (TDD: test→red→impl→green→tsc→commit). Независимое ревью на диффе. Push/deploy/флаг — ТОЛЬКО по явному «пуш и деплой». Прод-миграцию руками, без `migrate dev`/`db push` локально против прод-.env.
