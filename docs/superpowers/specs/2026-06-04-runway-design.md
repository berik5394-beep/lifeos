# Runway (кросс-домен мост #1 из списка 9) — Design

> Brainstormed + одобрено Berik 2026-06-04. SERVER-only (`packages/server`) →
> авто-обновление у всех по deploy. READ-ONLY, за флагом, off=байт-идентично.
> Зеркало шаблона Goal-Impact (`docs/.../2026-06-04-goal-impact-design.md`).
> Часть north-star «Chief of Staff» (chief_of_staff_vision).

## Проблема / ценность
Деловому человеку критичен вопрос выживаемости кэша: «при таком темпе на сколько
хватит денег?». Сегодня LifeOS считает помесячный баланс, но НЕ говорит runway и
НЕ предупреждает проактивно о коротком запасе. Runway — отдельный угол от
Goal-Impact (там деньги↔цель; тут выживаемость кэша во времени).

## Решения брейншторма (зафиксировано)
1. **Числитель «деньги на руках» = накопленный net по записям** (сумма всех
   доходов − всех расходов за всё время в LifeOS). READ-ONLY, ноль новых полей.
   Честная оговорка «по записям». Override юзером (задать реальный баланс) — НЕ
   v1 (fast-follow).
2. **Бёрн для runway = ЧИСТЫЙ отток** = `monthlyBurn − monthlyIncome`. Если
   доход ≥ расхода → cash-flow-положителен → runway не считаем («ты в плюсе»).
3. **Пороги:** `< 1 мес` = critical, `< 3 мес` = short, иначе healthy.
4. **Ноем только при коротком runway** (short/critical/underwater); при
   healthy/cash_positive/no_data — молчим (не грузим).

## Что переиспользуем (НЕ с нуля)
- `gatherReflectorFacts(userId, now)` (`reflector-service.ts`) уже считает
  `monthlyIncome` + `monthlyBurn` (окно WINDOW_MONTHS=3). Знаменатель готов.
- Накопленный net: `prisma.income.aggregate({_sum})` + `prisma.expense.aggregate
  ({_sum})` за всё время (без date-фильтра), `net = incomes − expenses`.
- Шаблон Goal-Impact: services/{types,gather,index} + enrichment-врезка в
  `fetchV2EnrichmentData`/`buildV2EnrichmentBlock` + проактивный детектор с ранним
  флаг-return + флаг копия `isV2GoalImpactEnabled` + структурный no-write guard.

## Архитектура / файлы (относительно `src/`)
| Файл | Ответственность |
|---|---|
| `services/runway/types.ts` (create) | Чистые: `computeRunway`, `describeRunway` + типы `RunwayStatus`/`Runway`. |
| `services/runway/runway.ts` (create) | `buildRunway(userId, now?)`: reflector facts + накопленный net → `Runway \| null`. |
| `services/runway/index.ts` (create) | re-export. |
| `services/v2-enrichment.ts` (modify) | `formatRunwaySection` + флаг-гейтнутый fetch в `fetchV2EnrichmentData`, рендер в `buildV2EnrichmentBlock`. |
| `services/v2-proactivity-engine.ts` (modify) | source `'runway_low'` в `NudgeSource` + `scoreSignificance` case + `TEMPLATES` + детектор `detectRunwayLow` (ранний флаг-return) + регистрация в `detectCandidates`. |
| `lib/feature-flags.ts` (modify) | `isV2RunwayEnabled` (env `FEATURE_V2_RUNWAY`, форма `all\|true\|none\|false\|user-X`). |

## Чистая формула (`computeRunway`)
```
вход: { cashOnHand, monthlyIncome, monthlyBurn }   (все числа ≥ могут быть 0)
netBurnRate = monthlyBurn − monthlyIncome

status / runwayMonths:
  monthlyBurn <= 0 && monthlyIncome <= 0 → status='no_data',      runwayMonths=null
  netBurnRate <= 0                       → status='cash_positive', runwayMonths=null
  cashOnHand <= 0                        → status='underwater',    runwayMonths=0
  else:
    runwayMonths = cashOnHand / netBurnRate
    runwayMonths < 1  → 'critical'
    runwayMonths < 3  → 'short'
    else              → 'healthy'

возврат: { netBurnRate, runwayMonths, status }
```
`describeRunway(r, cashOnHand)` → строка только для short/critical/underwater:
- critical/short: `💸 По записям у тебя ~{cash}₸, чистый расход ~{netBurn}₸/мес →
  денег хватит на ~{N} мес.`
- underwater: `💸 По записям расходы давно обгоняют доходы (накоплен минус).
  Стоит сократить траты.`
- healthy/cash_positive/no_data → null (молчим).

## Gather (`buildRunway`)
1. `facts = gatherReflectorFacts(userId, now)` → `monthlyIncome`, `monthlyBurn`.
2. Накопленный net: `Promise.all([income.aggregate({_sum:{amount}, where:{userId}}),
   expense.aggregate({_sum:{amount}, where:{userId}})])` → `cashOnHand = (inc ?? 0)
   − (exp ?? 0)`.
3. `r = computeRunway({ cashOnHand, monthlyIncome, monthlyBurn })`.
4. Гейт: если `status ∈ {healthy, cash_positive, no_data}` → return null (молчим).
5. `insightText = describeRunway(r, cashOnHand)`; если null → return null.
6. Возврат `Runway`: `{ cashOnHand, monthlyIncome, monthlyBurn, netBurnRate,
   runwayMonths, status, insightText }`.
7. try/catch → при сбое `null` (enrichment/детектор молчат).

## Поверхность
- **Enrichment** (`v2-enrichment.ts`): за `isV2RunwayEnabled` в `fetchV2Enrichment
  Data` Promise.all (как goal-impact ветка) → поле `runway: string|null` в
  `V2EnrichmentData`; `buildV2EnrichmentBlock` рендерит `formatRunwaySection`.
  Мозг отвечает числом на «на сколько хватит денег?».
- **Проактивный детектор** `detectRunwayLow` (`v2-proactivity-engine.ts`): кандидат
  при `status ∈ {short, critical}` (underwater — тоже кандидат). Источник
  `runway_low`, `scoreSignificance`: critical→0.9, short→0.7, underwater→0.8.
  Ранний `if(!isV2RunwayEnabled(userId)) return []`. Тон под стиль.

## Флаг + безопасность
`isV2RunwayEnabled(userId)` — env `FEATURE_V2_RUNWAY`. **READ-ONLY** — ни одной
записи в БД (только чтение+расчёт; структурный guard в services/runway запрещает
prisma create/update/delete/upsert + raw SQL/$transaction). Off → enrichment-поле
null (секция отсутствует), детектор ранним return пуст → байт-идентично.

## Обработка ошибок / край
- `buildRunway` try/catch → `null`.
- Деление только при `netBurnRate > 0` (иначе cash_positive/no_data раньше).
- `monthlyBurn≤0 && monthlyIncome≤0` (нет транзакций) → no_data → молчим.
- Накопленный net может быть отрицательным → underwater (особый месседж).
- enrichment — best-effort (orchestrator уже оборачивает fetchV2EnrichmentData в
  withTimeout 900мс).

## Тестирование
- **Pure-юнит (TDD):** `computeRunway` — cash_positive (income≥burn), no_data
  (нет данных), underwater (net<0), границы critical(<1)/short(<3)/healthy(≥3),
  netBurnRate расчёт. `describeRunway` — строка для short/critical/underwater,
  null для healthy/cash_positive/no_data.
- **Поведенческий (тест-БД харнес):** `runway.it.test.ts` — юзер + доходы+расходы
  (расход>доход, накоплен положительный net) → верный N мес + status short/
  critical; cash-positive юзер → null; cross-user изоляция (B не видит A).
- **Структурный:** флаг; детектор+шаблон+регистрация; enrichment-врезка; no-write
  guard (ноль prisma write + raw SQL в services/runway).
- Baseline (unit + integration) зелёный; tsc чисто.

## Не-цели (v1)
Override баланса юзером, прибыльность-по-клиенту, прогноз кэшфлоу, графики,
мульти-валюта, отдельный бизнес-vs-личный кэш. Всё — потом.

## Rollout-дисциплина
Коммит на шаг (trailer Co-Authored-By). Push/deploy/флаг — ТОЛЬКО по слову Berik.
Флаг сначала на Berik, потом all. SMOKE: боту «на сколько мне хватит денег?» →
ответ с числом месяцев + честная оговорка «по записям». После Runway — следующий
мост из списка 9 (энергия↔результат).
