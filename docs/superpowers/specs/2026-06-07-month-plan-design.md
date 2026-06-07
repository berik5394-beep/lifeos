# Month-plan (MonthlyGoal) — Design Spec

**Дата:** 2026-06-07
**Аудит:** P2 #3 (последняя дыра «всё реально» — MISSING: «план на месяц» из чата негде сохранить)
**Вариант:** A — зеркало weekly (free-text месячные цели × N). Berik одобрил.
**Scope:** SERVER-only (`packages/server`).

## Goal
Дать боту инструмент завести **цель на месяц** из чата («моя цель на июнь — закрыть 3 сделки»),
которая РЕАЛЬНО пишется в БД и сразу видна мозгу (промпт + tool + проактивный детектор), с
кросс-доменом **месяц↔неделя**. Закрывает последний MISSING аудита.

## Архитектура (зеркало weekly-goal, shipped 2026-06-07)
Точная калька фичи `create_weekly_goal` (`WeeklyGoal`), отличия только в периоде (месяц вместо
недели) и в одном новом проактивном тайминге (конец месяца). SSOT-точка периода —
**`localMonthOnlyUTC(tz)`** (уже есть в `lib/tz.ts:157`: UTC-полночь 1-го числа КАЛЕНДАРНОГО
месяца юзера = `@db.Date`-конвенция, аналог `localWeekStartUTC` для weekly). **НЕ** использовать
`localMonthStartUTC` (это timestamp-инстант локальной полуночи для range-фильтров month-load).

## Tech stack
Fastify + Prisma6 + Postgres, ESM (`.js`-импорты), TS strict (no `any`), vitest (zero `vi.mock`,
real prisma в `.it.test.ts`, структурные тесты `readFileSync`+grep). Commit-per-step, trailer
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## 1. Модель `MonthlyGoal` (+ Prisma-миграция) 🆕 единственная по-настоящему новая часть
Дополняет семью `WeeklyGoal`/`YearlyGoal`. Зеркало `WeeklyGoal`:

```prisma
model MonthlyGoal {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  monthStart DateTime @db.Date   // UTC-полночь 1-го числа локального месяца (localMonthOnlyUTC)
  goalText   String
  completed  Boolean  @default(false)
  order      Int      @default(0)
  createdAt  DateTime @default(now())
  @@index([userId, monthStart])
}
```
+ обратная связь `monthlyGoals MonthlyGoal[]` в `model User`.

**Миграция (прод-безопасно, РУКАМИ — `.env`=ПРОД, НЕ `migrate dev`):**
1. Правка `schema.prisma` (модель + связь в User).
2. Ручная папка `prisma/migrations/<timestamp>_add_monthly_goal/migration.sql` с `CREATE TABLE
   "MonthlyGoal" (...)` + индекс + FK (зеркало DDL `WeeklyGoal`; стандартный путь, как
   SkillDefinition #119).
3. `npx prisma generate` локально (типы).
4. Применяется на деплое через Dockerfile `prisma migrate deploy` (как договорено #70-71).
   На прод-БД (ранее `db push`) — `migrate deploy` накатит недостающую таблицу; миграция чистая
   (новая таблица, без правки существующих → 0 риска для данных).

## 2. Писатель `create_monthly_goal` (клон `create_weekly_goal`)
`src/tools/create-monthly-goal.ts`:
- `category:'task'`, `needsConfirm:false` (обратимо, не деньги), `sideEffects:'write'`.
- `aliases: { goal/text/title/goal_text → goalText }`, `schema: { goalText: z.string().min(1).max(300) }`.
- handler: `tz = getUserTimezone(userId)`; `monthStart = localMonthOnlyUTC(tz)`; дедуп по
  `normalizeHabit(goalText)` среди `MonthlyGoal` за этот `monthStart` (повтор → вернуть существующую,
  `existed:true`); `order = max+1` per (userId, monthStart); create.
- Регистрация в `src/tools/index.ts` (ALL_TOOLS).

## 3. Читатели (SSOT на `localMonthOnlyUTC` — все смотрят в одну точку)
**(a)** `src/tools/get-monthly-plan.ts` — клон `get-weekly-plan.ts`: `monthStart =
localMonthOnlyUTC(await getUserTimezone(ctx.userId))`; `findMany where {userId, monthStart}` orderBy
order; вернуть `{monthStart: ISO.slice(0,10), done, total, goals:[{text,done}]}`. Регистрация в index.
**(b)** Врезка «🎯 Цели месяца» в системный промпт — `assistant-service.ts` рядом с weeklyPlan-врезкой
(тот же приём IIFE, `localMonthOnlyUTC(tz)`). SSOT-бонус: inline `monthStart = new Date(Date.UTC(ly,
lm-1,1))` (assistant-service ~:85, для бюджета) байт-идентичен `localMonthOnlyUTC(tz)` → опц.
заменить на хелпер (как weekly-рефактор), необязательно для фичи.

## 4. 🔗 Кросс-домен СРАЗУ: детектор `detectMonthlyGoalStall` (месяц↔неделя)
**Новый чистый хелпер** `daysUntilMonthEnd(tz, at?)` в `lib/tz.ts` (+ юнит в tz.test.ts):
из `localDateStr(tz)` взять `y,m,d`; `daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()`
(день 0 след. месяца = последний день текущего); вернуть `daysInMonth - d` (0 = сегодня последний день).

**`v2-proactivity-engine.ts`** (зеркало weekly_goal_stall):
- `NudgeSource | 'monthly_goal_stall'` (последним).
- `scoreSignificance` case: `Math.min(1, 0.55 + open*0.12)` (чуть выше weekly — месячная цель крупнее).
- `TEMPLATES.monthly_goal_stall = { gentle, supportive }` с `{{goalText}}`/`{{daysLeft}}`/`{{open}}`/`{{weeksDone}}`/`{{weeksTotal}}`.
- Чистая `monthlyStallCandidate(daysLeft, monthGoals, weekRollup)` → `null`, если `daysLeft > 5`
  ИЛИ нет незакрытых месячных целей; иначе `NudgeCandidate` с payload
  `{goalText, daysLeft, open, weeksDone, weeksTotal}`, где `goalText` = текст ПЕРВОЙ незакрытой
  месячной цели (по `order`), `open` = число незакрытых.
- Импурный `detectMonthlyGoalStall(userId)`: `tz=getUserTimezone`; `daysUntilMonthEnd(tz)`;
  если `>5` → ранний `[]`; читать `MonthlyGoal` за `localMonthOnlyUTC(tz)`; **роллап месяц↔неделя** —
  читать `WeeklyGoal` где `weekStart >= monthStart` И `weekStart < 1-е след. месяца`
  (`new Date(Date.UTC(y, m, 1))` из локальных `y`,`m` 1-based), посчитать `weeksTotal` +
  `weeksDone(completed)`; вызвать `monthlyStallCandidate`; best-effort try/catch (не бросать в tick).
  Зарегистрировать в `detectCandidates` (allSettled).
- Текст нуджа (gentle): «До конца месяца N дней, цель «{{goalText}}» ещё открыта. За месяц закрыл
  {{weeksDone}}/{{weeksTotal}} недельных целей — добьём?» (роллап = живой кросс-читатель WeeklyGoal,
  не заглушка).

## 5. Тесты
- **Pure** (tz.test.ts): `daysUntilMonthEnd` (середина/последний день/первый день; разные tz —
  Almaty vs UTC у границы месяца). `v2-proactivity-engine.test.ts`: `monthlyStallCandidate`
  (daysLeft>5→null; нет открытых→null; есть открытые + ≤5 дней→candidate; роллап в payload) +
  'monthly_goal_stall' в exhaustiveness-массиве.
- **it (real prisma)** `create-monthly-goal.it.test.ts`: пишет `MonthlyGoal` на `localMonthOnlyUTC`
  (проверить `monthStart.toISOString()`); КРОСС-ДОМЕН — `get_monthly_plan` сразу видит цель; дедуп
  (регистр); cross-user (цель A не видна в плане B).
- **Структурный** `monthly-goal-wiring.test.ts`: 'monthly_goal_stall' в union/TEMPLATES/score/
  detectCandidates; `detectMonthlyGoalStall` ранний выход по `daysUntilMonthEnd>5`; tool
  зарегистрирован.

## 6. Флаг и rollout
- **Нового флага НЕТ** (аддитивный tool + детектор внутри уже включённой проактивности) — как weekly.
- Активируется **на деплое вместе с миграцией** (migrate deploy создаёт таблицу до старта кода).
- Commit-per-step; push/deploy — ТОЛЬКО по слову Berik. Baseline: unit ~2467 + integration ~122 зелёные.

## 7. Out of scope (НЕ делаем сейчас — YAGNI)
- Структурная привязка месячной цели к бюджет-категории / вехе годовой цели (вариант B) — позже,
  если понадобится числовой прогресс.
- Месяц↔финансы числом (бюджет уже месячный, врезка финансов есть — не дублируем).
- Авто-роллап недельных целей → месячная (только показываем счётчик, не пересобираем).

## Риски
1. **Миграция на прод** — единственная новая операция. Чистая (новая таблица), но это первый
   деплой month-plan с DDL → проверить `migrate deploy` отработал (таблица создана) после деплоя.
2. **Тайминг конца месяца** — `daysUntilMonthEnd` в tz юзера (не сервера); юнит на границе месяца обязателен.
