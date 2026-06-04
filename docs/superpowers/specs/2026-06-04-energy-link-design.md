# Energy↔Result (кросс-домен мост #2) — Design

> Brainstormed + одобрено Berik 2026-06-04. SERVER-only (`packages/server`) →
> авто-обновление у всех по deploy. READ-ONLY, за флагом, off=байт-идентично.
> Зеркало шаблона Goal-Impact/Runway. Часть north-star «Chief of Staff»
> (chief_of_staff_vision, мост #6 «энергия↔результат»).

## Проблема / ценность
«Здоровье ради эффективности»: показать вычисленной связью, что сон двигает
продуктивность — «в дни сна ≥7ч ты закрываешь 78% дел, при <7ч — 52%», и
проактивно предупредить при недосыпе. Сегодня данные есть (журнал сна + задачи),
но связь никто не считает.

## Решения брейншторма (зафиксировано)
1. **Метод = бакет-контраст** (НЕ корреляция Пирсона, НЕ просто тренд). Честно,
   конкретными числами, устойчиво к шуму, без стат-жаргона.
2. **Драйвер v1 = только сон** (`sleepHours`). Энергия/настроение — fast-follow.
3. **Порог сна = фикс 7ч** (`≥7` хороший, `<7` мало). Личная медиана — fast-follow.
4. **Гейт честности:** показываем ТОЛЬКО при `goodN≥4 И poorN≥4 И |gapPct|≥15`.
   Иначе молчим (не выдумываем связь на разреженных данных).
5. **Окно = 60 дней.**

## Что переиспользуем (НЕ с нуля)
- `JournalEntry` (prisma): `date @db.Date`, `sleepHours Float?`, `energy Int?`,
  `mood Int?`. `@@unique([userId, date])` → один день = одна запись.
- `Task` (prisma): `date @db.Date`, `completed Boolean`. Дневной % = done/total за
  дату (как клиентский `computeDayStats`, но на сервере отдельной выборкой).
- Шаблон Goal-Impact/Runway: services/{types,gather,index} + enrichment-врезка +
  проактивный детектор с ранним флаг-return + флаг копия `isV2RunwayEnabled` +
  структурный no-write guard.
- НЕ дублируем EmotionalMemory (`detectMoodShift`) — там сдвиг настроения, а тут
  связь сон↔выполнение.

## Архитектура / файлы (относительно `src/`)
| Файл | Ответственность |
|---|---|
| `services/energy-link/types.ts` (create) | Чистые: `pairDays`, `bucketContrast`, `describeEnergyLink` + типы. |
| `services/energy-link/energy-link.ts` (create) | `buildEnergyLink(userId, now?)`: журнал-сон + дневной %-задач за окно → пары → бакеты → `EnergyLink \| null`. |
| `services/energy-link/index.ts` (create) | re-export. |
| `services/v2-enrichment.ts` (modify) | `formatEnergyLinkSection` + флаг-гейтнутый fetch + поле `energyLink: string\|null` в V2EnrichmentData + рендер. |
| `services/v2-proactivity-engine.ts` (modify) | source `'energy_link'` + `scoreSignificance` case + `TEMPLATES` + детектор `detectEnergyLink` (ранний флаг-return) + регистрация. |
| `lib/feature-flags.ts` (modify) | `isV2EnergyEnabled` (env `FEATURE_V2_ENERGY`). |

## Чистые формулы (`types.ts`)
```
type SleepDay = { sleepHours: number; completionPct: number };

pairDays(
  journalByDate: Record<dateKey, number>,   // dateKey → sleepHours (только ≠null)
  completionByDate: Record<dateKey, number>, // dateKey → % выполнения (0..100)
): SleepDay[]
  // пара только для дат, присутствующих в ОБОИХ; completionPct берётся из задач.

const SLEEP_THRESHOLD_H = 7;
const MIN_PER_BUCKET = 4;
const MIN_GAP_PCT = 15;

type ContrastStatus = 'insufficient' | 'weak' | 'link';
bucketContrast(pairs, thresholdH=7, minPerBucket=4, minGapPct=15):
  good = pairs[sleepHours >= thresholdH]; poor = pairs[sleepHours < thresholdH]
  goodN=good.length; poorN=poor.length
  goodN<minPerBucket || poorN<minPerBucket → { status:'insufficient', goodN, poorN, goodAvg:null, poorAvg:null, gapPct:null }
  goodAvg=round(avg good.completionPct); poorAvg=round(avg poor.completionPct)
  gapPct=goodAvg − poorAvg
  |gapPct| >= minGapPct → status='link' else 'weak'
  → { status, goodN, poorN, goodAvg, poorAvg, gapPct }

describeEnergyLink(c): string | null
  // только status==='link' и gapPct>0 (хороший сон → выше %):
  «🛌 В дни сна ≥7ч ты в среднем закрываешь {goodAvg}% дел, при <7ч — {poorAvg}%.
   Сон правда двигает твою продуктивность.»
  // gapPct<0 (парадокс: меньше сна — выше %) → null (не вводим в заблуждение).
  // insufficient/weak → null.
```

## Gather (`buildEnergyLink`)
1. `windowStart = now − 60 дней`.
2. `journalByDate`: `prisma.journalEntry.findMany({ where:{ userId, date:{gte:
   windowStart}, sleepHours:{not:null} }, select:{date,sleepHours} })` → map
   dateKey→sleepHours.
3. `completionByDate`: `prisma.task.findMany({ where:{ userId, date:{gte:
   windowStart} }, select:{date,completed} })` → агрегировать done/total по дате →
   dateKey→round(done/total*100). Дни без задач отсутствуют.
4. `pairs = pairDays(journalByDate, completionByDate)`.
5. `c = bucketContrast(pairs)`.
6. Гейт: `c.status !== 'link'` → return null.
7. `insightText = describeEnergyLink(c)`; null → return null.
8. Возврат `EnergyLink`: `{ goodAvg, poorAvg, gapPct, goodN, poorN, status,
   recentSleepLow, insightText }` где `recentSleepLow` = средний сон последних ~3
   дней с записью < 7ч (для детектора).

## Поверхность
- **Enrichment** (`v2-enrichment.ts`): за `isV2EnergyEnabled` в `fetchV2Enrichment
  Data` Promise.all → поле `energyLink: string|null`; `buildV2EnrichmentBlock`
  рендерит `formatEnergyLinkSection`. Мозг отвечает числами на «почему я
  непродуктивен на этой неделе?».
- **Проактивный детектор** `detectEnergyLink` (`v2-proactivity-engine.ts`):
  кандидат при `status==='link' && recentSleepLow` (связь есть И недавно недосып).
  Источник `energy_link`, `scoreSignificance` ~ от `|gapPct|` (gap30→~0.6,
  капается на 0.85). Ранний `if(!isV2EnergyEnabled(userId)) return []`. Тон под стиль.

## Флаг + безопасность
`isV2EnergyEnabled(userId)` — env `FEATURE_V2_ENERGY`. **READ-ONLY** — ни одной
записи (только чтение+расчёт; структурный guard в services/energy-link запрещает
prisma create/update/delete/upsert + raw SQL/$transaction). Off → enrichment-поле
null (секция отсутствует), детектор ранним return пуст → байт-идентично.

## Обработка ошибок / край
- `buildEnergyLink` try/catch → `null`.
- Деления нет на пустых бакетах (avg только при N≥minPerBucket; insufficient
  раньше).
- Все дни сон ≥7 ИЛИ все <7 → один бакет пуст → insufficient → молчим.
- `gapPct<0` (парадокс) → describe null (не вводим в заблуждение).
- enrichment best-effort (orchestrator оборачивает fetchV2EnrichmentData в
  withTimeout 900мс).

## Тестирование
- **Pure-юнит (TDD):** `pairDays` (join только общих дат, completionPct из задач);
  `bucketContrast` — insufficient (N<4), weak (|gap|<15), link (|gap|≥15), границы;
  `describeEnergyLink` — строка для link+gap>0, null для weak/insufficient/gap<0.
- **Поведенческий (тест-БД харнес):** `energy-link.it.test.ts` — юзер + журнал-сон
  + задачи 60 дней с явным контрастом (≥4 дня хорошего сна с высоким %, ≥4 плохого
  с низким) → `buildEnergyLink` не null, верные goodAvg/poorAvg/gap; мало данных →
  null; cross-user изоляция (B не видит A).
- **Структурный:** флаг; детектор+шаблон+регистрация; enrichment-врезка; no-write
  guard (ноль prisma write + raw SQL в services/energy-link).
- Baseline (unit + integration) зелёный; tsc чисто.

## Не-цели (v1)
Энергия/настроение как драйверы, личная медиана-порог, причинность (только
«связь»), графики, мульти-факторная модель. Всё — потом.

## Rollout-дисциплина
Коммит на шаг (trailer Co-Authored-By). Push/deploy/флаг — ТОЛЬКО по слову Berik.
Флаг сначала на Berik, потом all. SMOKE: боту «почему я непродуктивен?» → при
наличии данных ответ с контрастом сна. После — следующий мост из списка 9
(отношения-CRM).
