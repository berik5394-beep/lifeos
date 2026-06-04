# Goal-Impact — кросс-доменный движок, Срез 1 (Design)

> Brainstormed + одобрено Berik 2026-06-04 (источники: «оба» — траты-категории
> + денежные обязательства). Quality bar «умный Джарвис», YAGNI. SERVER-only
> (`packages/server`) → авто-обновление у тест-юзеров по deploy. Направление:
> docs/superpowers/specs/2026-06-04-cross-domain-engine-direction.md.

## Проблема / ценность
Кросс-доменное рассуждение сегодня = «свалить факты в промпт → надеяться, что LLM
свяжет» (недетерминированно, часть захардкожена). Срез 1 превращает ОДИН мост в
**вычисленный детерминированный инсайт с реальным числом**: как конкретные **траты
по категориям** и **денежные обязательства** «съедают» денежную цель. Это и есть
north-star «взаимосвязь как витрина, а не побочка».

## Что УЖЕ есть (реюз)
- `savings-pace.ts` → `computeSavingsPace(SavingsPaceFacts): SavingsPace` —
  `{ monthsLeft, remaining, requiredMonthly, projected, paceGap, shortfall,
  progressPct, status }`. **`requiredMonthly`** — ключевой вход моста. Чистое ядро.
- `savings-coach.ts` → `maybeSavingsCoachLine(userId, …)` строит факты (выбор
  денежной YearlyGoal + savedSoFar YTD + monthlyPace) и зовёт computeSavingsPace.
  **Реюз:** если выбор цели+пейс не вынесен отдельно — извлечь
  `getMoneyGoalPace(userId): Promise<{ goalText; target; pace: SavingsPace } | null>`
  в savings-coach и звать из обоих (targeted improvement, без дублирования).
- `obligation` (новьё) — `kind='money'`, `direction='i_owe'`, `status='open'`,
  `amount` → сумма «я должен денег».
- finance — расходы; месячный итог считается, **по категориям — нет** (новый groupBy).
- `v2-proactivity-engine.ts` (детекторы+шаблоны), `v2-enrichment.ts` (врезка в
  системный промпт), `feature-flags.ts` (форма флага), тест-БД харнес.

## Цель slice 1
Вычисляющий слой `goal-impact`: `requiredMonthly` × (топ-категория трат + сумма
i_owe денег) → числовой инсайт «доставка = Y% от нужного; долг сдвинет на N мес».
Поверхность: enrichment (детерминированный ответ по запросу) + проактивный детектор
(сам выдаёт). За флагом, read-only, off=байт-идентично.

## Не-цели (slice 1)
Немонетарные цели, корреляции настроение/сон, граф-данных взаимосвязей (Срез 2),
мобайл-UI, изменение самого пейсинга/коуча.

## Архитектура (одна фраза)
`goal-impact` считает влияние трат-категорий и i_owe-обязательств на денежную цель
(через готовый `requiredMonthly`) → отдаёт `{ structured, insightText }`; enrichment
вливает это в контекст мозга, детектор выдаёт проактивно. Всё за `isV2GoalImpactEnabled`.

## Компоненты (новые файлы, относительно `src/`)
| Файл | Ответственность |
|---|---|
| `services/goal-impact/types.ts` | типы + **чистые хелперы** (юнит): `computeCategoryImpact`, `computeObligationImpact`, `pickTopCategory`, `describeGoalImpact` |
| `services/goal-impact/goal-impact.ts` | gather+compute: `getMoneyGoalPace` (реюз) + `spendByCategory` (groupBy) + сумма i_owe → `buildGoalImpact(userId): Promise<GoalImpact | null>` |
| `services/goal-impact/index.ts` | singleton/re-export |
| (modify) `services/savings-coach.ts` | вынести `getMoneyGoalPace(userId)` (если ещё не вынесено) |
| (modify) `services/v2-enrichment.ts` | врезать `formatGoalImpactSection` за флагом + withTimeout |
| (modify) `services/v2-proactivity-engine.ts` | детектор `detectGoalImpact` + шаблоны + регистрация |
| (modify) `lib/feature-flags.ts` | `isV2GoalImpactEnabled` |

## Чистые хелперы (формулы — детерминизм)
```
type CategorySpend = { category: string; amount: number };

// доля категории от месячной нормы накопления
computeCategoryImpact(categorySpend, requiredMonthly):
  requiredMonthly <= 0 → null
  share = categorySpend / requiredMonthly        // 0..N (может быть >1)

// на сколько месяцев долги отодвигают цель
computeObligationImpact(totalOwed, requiredMonthly):
  requiredMonthly <= 0 → null
  monthsDelay = totalOwed / requiredMonthly

pickTopCategory(byCategory[]): запись с max amount (или null если пусто)

describeGoalImpact(goalText, requiredMonthly, topCat?, owed?): string | null
  // строит детерминированную строку из чисел; null если нечего сказать
```

## Gather + compute (`buildGoalImpact`)
1. `getMoneyGoalPace(userId)` → нет денежной цели → return null.
2. **Инсайт только если есть смысл напрягаться:** `pace.status ∈ {behind, stalled}`
   И `requiredMonthly > 0`. Иначе (on_track/ahead/reached) → return null (не ноем —
   консистентно с `describeGoalPace`).
3. `spendByCategory(userId, month)` = `prisma.expense.groupBy({ by:['category'],
   where:{ userId, date: {gte: monthStart} }, _sum:{ amount:true } })` → топ-категория.
4. `totalOwed` = `prisma.obligation.aggregate({ _sum:{amount}, where:{ userId,
   kind:'money', direction:'i_owe', status:'open' } })`.
5. `computeCategoryImpact` + `computeObligationImpact` + `describeGoalImpact` →
   `{ structured: { requiredMonthly, topCategory, categoryShare, totalOwed,
   monthsDelay, status }, insightText }`.

## Поверхность
- **Enrichment** (`v2-enrichment.ts`): за флагом + `withTimeout(buildGoalImpact, 700, null)`
  → `formatGoalImpactSection` → блок в системный промпт. Мозг отвечает числами
  надёжно на «как у меня с целью?».
- **Проактивный детектор** `detectGoalImpact` (`v2-proactivity-engine.ts`): кандидат,
  если `categoryShare ≥ 0.25` (категория ест ≥25% нормы) ИЛИ `monthsDelay ≥ 1`.
  Источник `goal_impact`, шаблоны под стиль (друг/строгий/токсичный). За тем же
  флагом (ранний return, как у obligation_due) + общие гейты проактивности.

## Флаг + безопасность
`isV2GoalImpactEnabled(userId)` — env `FEATURE_V2_GOAL_IMPACT`, форма `(all|true|
none|false|user-X)`. **Read-only** — ни одной записи в БД (только чтение+расчёт).
Off → enrichment пуст, детектор ранним return пуст → байт-идентично.

## Обработка ошибок
- `buildGoalImpact` — try/catch, при сбое `null` (enrichment/детектор просто молчат).
- enrichment — `withTimeout`, не блокирует чат.
- requiredMonthly=0 / нет цели / нет трат → корректный `null`, без деления на ноль.

## Тестирование
- **Pure-юнит (TDD):** `computeCategoryImpact` (share, requiredMonthly≤0→null),
  `computeObligationImpact` (monthsDelay, ≤0→null), `pickTopCategory` (max/пусто),
  `describeGoalImpact` (есть инсайт / null когда нечего).
- **Поведенческий (тест-БД харнес):** `goal-impact.it.test.ts` — юзер + денежная
  цель (behind) + расходы 2 категорий + i_owe-обязательство → `buildGoalImpact`
  возвращает верные числа (топ-категория, share, monthsDelay); on_track-цель → null;
  cross-user изоляция (B не видит данные A).
- **Структурный:** флаг, enrichment-врезка за флагом, детектор+шаблон+регистрация.
- Baseline (~2231 unit + integration) зелёный; tsc чисто.

## Rollout-дисциплина
Коммит на шаг (trailer Co-Authored-By). Push/deploy/флаг — ТОЛЬКО по слову Berik.
Флаг сначала на Berik (настроить порог 0.25 на реальных данных), потом all. SMOKE:
боту «как у меня с целью миллион?» → ответ с числом доли категории + влияния долга.
