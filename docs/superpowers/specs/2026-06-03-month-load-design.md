# Нудж «месяц перегружен» (month-load) — Design (финал среза МЕСЯЦ)

**Дата:** 2026-06-03
**Статус:** одобрено Berik
**Контекст:** движок пересечения времени. День ✅ + Неделя ✅ + data-слой Месяца ✅ (WeeklyGoal.estimatedMinutes, в проде). Это ПОСЛЕДНИЙ кусок среза МЕСЯЦ — реактивный нудж «в этом месяце не всё влезет». Зеркало `week-load.ts` на ядре `computeCapacityFit`. Деньги/день/неделя не трогаем.

## 1. Цель (одной строкой)
После добавления задачи: если день и неделя влезают, но МЕСЯЦ перегружен (Σ задач+целей месяца > свободного времени оставшихся дней месяца) — одна мягкая строка-нудж.

## 2. Архитектура (Approach: зеркало week-load)
Изолированный `services/month-load.ts`. Новый additive tz-хелпер `localMonthStartUTC`. Реактив каскадом в `create_task`: `day → week → month` (приоритет ближнего горизонта, максимум одна строка).

### 2.1 tz-хелпер `localMonthStartUTC(tz, at): Date` (новое, additive в `lib/tz.ts`)
UTC-инстант 00:00 локального 1-го числа месяца, в который попадает `at`. Точная копия `localDayStartUTC`, но день=1 (использует приватный `tzOffsetMs` в том же файле). DST-устойчиво (re-нормализация смещения; KZ без DST → точно).

### 2.2 `gatherMonthLoad(userId, now): { capacity, items }`
- `monthStart = localMonthStartUTC(tz, now)`.
- `monthEndExcl = localMonthStartUTC(tz, new Date(monthStart + 32*DAY_MS))` — 1-е следующего месяца (32 дня гарантированно перешагивают любой месяц; re-нормализация даёт точную полночь).
- `todayStart = localDayStartUTC(tz, now)`.
- **Demand** (весь месяц — консервативно, как в week-load):
  - задачи `date ∈ [monthStart, monthEndExcl)`, `completed:false` → demand `estimatedMinutes ?? DEFAULT_TASK_MINUTES` (импорт из day-load), importance `importance ?? mapPriority(priority)` (импорт из day-load).
  - недельные цели `weekStart ∈ [monthStart, monthEndExcl)`, `completed:false`, `archivedAt:null` → demand `estimatedMinutes ?? DEFAULT_GOAL_MINUTES` (импорт из estimate-goal-minutes), importance `2` (фикс. средняя — у WeeklyGoal нет priority/importance).
- **Capacity** = `sumWeekCapacity(days, localTimeStr(tz, now))` по дням `[todayStart, monthEndExcl)` (today от «сейчас», будущие полное окно). События `date ∈ [todayStart, monthEndExcl)` раскладываются по локальному дню через `dayKey = localDayStartUTC(tz, d).getTime()` (тот же приём, что в week-load).

### 2.3 `describeMonthLoad(fit): string | null`
null если `status !== 'overloaded'` или нет overflow. Иначе (h = round(min/60), over = overflow[0].label, keep = fit[0].label):
> «В этом месяце задач и целей примерно на ~{h(totalDemand)}ч, а свободного времени ~{h(capacity)}ч — не всё влезет. Перенести «{over}»{ (и ещё N) } на следующий месяц или разгрузить?{ И хватит ли времени на «{keep}»? }»

### 2.4 `maybeMonthLoadLine(userId, now = new Date()): Promise<string | null>`
Гейт `isV2MonthLoadEnabled(userId)` (уже =all в проде). Best-effort try/catch → null (никогда не валит create_task). gather → computeCapacityFit → если не overloaded → null. Дедуп ≤1/день: `prisma.insight.count({ scopeKey:'time:month_load', source:'month_load', createdAt:{gte: localDayStartUTC} })` > 0 → null. Иначе describe → `prisma.insight.create({ scope:{key:'time:month_load',kind:'month_load_reactive'}, scopeKey:'time:month_load', source:'month_load', severity:5, message, deliveredAt:now }).catch(()=>{})` → return line.

### 2.5 Проводка — каскад в `tools/create-task.ts`
Текущее: `const weekLoad = dayLoad ? null : await maybeWeekLoadLine(...); const extra = dayLoad ?? weekLoad;`
Новое: добавить month как третий уровень каскада — month проверяем ТОЛЬКО если ни day, ни week не сработали:
```ts
const dayLoad = await maybeDayLoadLine(ctx.userId, new Date());
const weekLoad = dayLoad ? null : await maybeWeekLoadLine(ctx.userId, new Date());
const monthLoad = dayLoad || weekLoad ? null : await maybeMonthLoadLine(ctx.userId, new Date());
const extra = dayLoad ?? weekLoad ?? monthLoad;
```
Импорт `maybeMonthLoadLine` из `'../services/month-load.js'`. Максимум одна строка; приоритет день > неделя > месяц.

## 3. Поток данных
```
create_task → maybeDayLoadLine (день перегружен?) ──┐
   нет → maybeWeekLoadLine (неделя?) ───────────────┤→ ОДНА строка (или ничего)
      нет → maybeMonthLoadLine (месяц?) ────────────┘
maybeMonthLoadLine: gatherMonthLoad → computeCapacityFit → gate overloaded → dedup → describe → Insight
```

## 4. Решение (принято в дизайне, одобрено)
Month-нудж триггерится ТОЛЬКО из `create_task` (как day/week), НЕ из создания целей. Планировщик уже возвращает богатый ответ; оценки целей в тот момент async-пишутся. Триггер-на-цель = возможный fast-follow.

## 5. Обработка ошибок
`maybeMonthLoadLine` best-effort: любой сбой → null, create_task никогда не падает. `insight.create` с `.catch`. `getUserTimezone` фолбэк UTC.

## 6. Тестирование (zero vi.mock; структурные readFileSync+grep)
- `localMonthStartUTC` юнит (середина месяца → 1-е; переход года дек→янв; невалидная tz → не падает).
- `describeMonthLoad` юнит: overloaded → строка с «следующий месяц» + overflow label; fits → null.
- Структурные `month-load.ts`: гейт `isV2MonthLoadEnabled`; `computeCapacityFit`; `sumWeekCapacity`; `localMonthStartUTC`; demand задачи И недельные цели (`weeklyGoal.findMany`); дедуп `count(... source:'month_load' ... gte: dayStart)`; `'time:month_load'`; `DEFAULT_GOAL_MINUTES`.
- Структурный каскад `create-task.ts`: `maybeMonthLoadLine`; `dayLoad || weekLoad ? null : await maybeMonthLoadLine`; `?? weekLoad ?? monthLoad`.
- Изоляция grep: `savings`/`day-load.ts`/`week-load.ts` не изменены (day-load/week-load только читаются как импорт, файлы не правим).
- Полная сюита (база 2150) зелёная + tsc 0.

## 7. Инварианты / безопасность
- Флаг гейтит (сейчас =all); best-effort never-throw.
- Каскад: month не задвоится с day/week (проверяется ТОЛЬКО когда оба null).
- Границы месяца tz-aware (`localMonthStartUTC`), `monthEndExcl` эксклюзивно (`lt`); capacity по оставшимся дням, demand по всему месяцу (консервативно).
- Дедуп vs own source `month_load` (урок бага денег).
- `sumWeekCapacity`/`computeCapacityFit` переиспользуются без правок (generic).
- Деньги/день/неделя не тронуты.

## 8. Дисциплина выката
Коммит на шаг (TDD). Независимое ревью на диффе. Push/deploy — ТОЛЬКО по явному «пуш и деплой». Флаг уже =all → деплой кода активирует нудж сразу.
