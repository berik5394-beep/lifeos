# Relationships / CRM-интеллект (кросс-домен мост #3) — Design

> Brainstormed + одобрено Berik 2026-06-04. SERVER-only (`packages/server`) →
> авто-обновление у всех по deploy. READ-ONLY, за флагом, off=байт-идентично.
> Зеркало шаблона Goal-Impact/Runway/Energy-Link. Часть north-star «Chief of
> Staff» (chief_of_staff_vision, мост #2 «люди = актив»).

## Проблема / ценность
Деловой живёт на отношениях. Граф людей уже есть, но «затих с человеком» и «дело
по этому человеку» не связаны. Мост связывает: «не писал Серику 2 недели, а ты ему
должен отчёт». Реальное дело из БД (обязательство), не выдумка.

## Решения брейншторма (зафиксировано)
1. **Источник «дела» v1 = только обязательства по FK** (`Obligation.personEntityId`).
   Детерминированно, ноль угадывания. Встречи (нечёткий матч имени) и ДР —
   fast-follow.
2. **Драйвер «застоялся» = `staleEntities(userId, 14, 5)`** (реюз готового):
   человек (type='person') не виден ≥14 дней, importance≥5.
3. **Триггер = контактная пауза** (не срок обязательства). Это отличает мост от
   `detectObligationDue` (срабатывает по dueDate) и `detectStaleEntity` (чистая
   staleness по frequency-паттерну).
4. **Гейт честности:** только если есть застоявшийся человек И у него РЕАЛЬНОЕ
   открытое обязательство в БД. Иначе null (молчим).

## Что переиспользуем (НЕ с нуля)
- `getEntityGraph().staleEntities(userId, sinceDays, minImportance): Promise<Entity[]>`
  (`entity-graph`) — застоявшиеся сущности (id, name, type, importance, lastSeenAt),
  сортировка по importance desc.
- `Obligation { userId, personEntityId String?, personName, direction('i_owe'|
  'owed_to_me'), description, status, ... }`. `listObligations` НЕ фильтрует по
  personEntityId → прямой `prisma.obligation.findMany({ where:{ userId,
  status:'open', personEntityId:{in: staleIds} }, select:{ personEntityId,
  direction, description } })`. `prisma` из `'../../lib/prisma.js'`.
- Шаблон Goal-Impact/Runway/Energy-Link: services/{types,gather,index} +
  enrichment-врезка + проактивный детектор с ранним флаг-return + флаг копия
  `isV2EnergyEnabled` + структурный no-write guard.
- НЕ дублируем `detectStaleEntity` (чистая staleness) и `detectObligationDue`
  (срок) — этот мост = пересечение контактной паузы и наличия обязательства.

## Архитектура / файлы (относительно `src/`)
| Файл | Ответственность |
|---|---|
| `services/relationship-link/types.ts` (create) | Чистые: `pickRelationshipLink`, `describeRelationshipLink` + типы `StalePerson`/`OpenObligation`/`RelationshipLink`. |
| `services/relationship-link/relationship-link.ts` (create) | `buildRelationshipNudge(userId, now?)`: staleEntities (люди) × открытые обязательства по FK → `RelationshipNudge \| null`. |
| `services/relationship-link/index.ts` (create) | re-export. |
| `services/v2-enrichment.ts` (modify) | `formatRelationshipSection` + флаг-гейтнутый fetch + поле `relationship: string\|null` + рендер. |
| `services/v2-proactivity-engine.ts` (modify) | source `'relationship_link'` в `NudgeSource` + `scoreSignificance` case + `TEMPLATES` + детектор `detectRelationshipLink` (ранний флаг-return) + регистрация. |
| `lib/feature-flags.ts` (modify) | `isV2RelationshipsEnabled` (env `FEATURE_V2_RELATIONSHIPS`). |

## Чистые формулы (`types.ts`)
```
type StalePerson = { id: string; name: string; daysSince: number; importance: number };
type OpenObligation = { direction: 'i_owe' | 'owed_to_me'; description: string };
type RelationshipLink = {
  personName: string; daysSince: number;
  direction: 'i_owe' | 'owed_to_me'; description: string;
};

pickRelationshipLink(
  persons: StalePerson[],              // отсортированы по importance desc
  obligationsByEntity: Record<string, OpenObligation[]>,  // entityId → открытые
): RelationshipLink | null
  // первый person, у кого есть ≥1 открытое обязательство; берём первое
  // обязательство (FK-список уже по dueDate/createdAt). null если ни у кого нет.

describeRelationshipLink(link): string
  i_owe: «🤝 Не общались с {personName} уже {daysSince} дн, а ты ему должен:
          «{description}». Написать?»
  owed_to_me: «🤝 Не общались с {personName} уже {daysSince} дн, а он тебе
               должен: «{description}». Напомнить?»
```

## Gather (`buildRelationshipNudge`)
1. `stale = await getEntityGraph().staleEntities(userId, 14, 5)` → фильтр
   `e.type === 'person'`; `StalePerson` с `daysSince = floor((now − lastSeenAt)/DAY)`
   (≥1). Уже отсортированы по importance desc.
2. `staleIds = stale.map(p => p.id)`; если пусто → null.
3. `obls = await prisma.obligation.findMany({ where:{ userId, status:'open',
   personEntityId:{ in: staleIds } }, select:{ personEntityId:true, direction:true,
   description:true } })`.
4. Группируем по `personEntityId` → `Record<string, OpenObligation[]>`.
5. `link = pickRelationshipLink(stale, obligationsByEntity)`; null → null.
6. `insightText = describeRelationshipLink(link)`.
7. Возврат `RelationshipNudge`: `{ personName, daysSince, direction, description,
   importance, insightText }` (importance выбранного человека — для значимости
   детектора).
8. try/catch → null.

## Поверхность
- **Enrichment** (`v2-enrichment.ts`): за `isV2RelationshipsEnabled` в
  `fetchV2EnrichmentData` Promise.all → поле `relationship: string|null`;
  `buildV2EnrichmentBlock` рендерит `formatRelationshipSection`. Мозг отвечает на
  «кому из контактов написать?».
- **Проактивный детектор** `detectRelationshipLink` (`v2-proactivity-engine.ts`):
  тот же гейт (застой + обязательство). Источник `relationship_link`,
  `scoreSignificance` ~ от `daysSince` и `importance` (cap 0.85). Ранний
  `if(!isV2RelationshipsEnabled(userId)) return []`. Тон под стиль.

## Флаг + безопасность
`isV2RelationshipsEnabled(userId)` — env `FEATURE_V2_RELATIONSHIPS`. **READ-ONLY** —
ни одной записи (только чтение+расчёт; структурный guard в services/relationship-link
запрещает prisma create/update/delete/upsert + raw SQL/$transaction). Off →
enrichment-поле null (секция отсутствует), детектор ранним return пуст →
байт-идентично.

## Обработка ошибок / край
- `buildRelationshipNudge` try/catch → null.
- Нет застоявшихся людей / ни у кого нет обязательств → null (молчим).
- Обязательство без `personEntityId` (привязано только по имени) → не попадает в
  `in:[staleIds]` → игнорируется (v1: только FK-связанные).
- enrichment best-effort (orchestrator оборачивает в withTimeout 900мс).

## Тестирование
- **Pure-юнит (TDD):** `pickRelationshipLink` (человек с обязательством выбран;
  человек без — пропущен; никто — null; порядок по importance); `describeRelation
  shipLink` (i_owe vs owed_to_me, число дней).
- **Поведенческий (тест-БД харнес):** `relationship-link.it.test.ts` — юзер +
  Entity person с давним lastSeenAt (≥14 дн) importance≥5 + Obligation status=open
  personEntityId=этот → `buildRelationshipNudge` верный personName+description+
  direction; без обязательства → null; cross-user изоляция (B не видит A).
- **Структурный:** флаг; детектор+шаблон+регистрация; enrichment-врезка; no-write
  guard.
- Baseline (unit + integration) зелёный; tsc чисто.

## Не-цели (v1)
Встречи нечётким матчем имени, ДР/праздники, обязательства привязанные только по
имени (без FK), owed-to-me деньги-числа, многосвязные люди/граф-обход. Всё — потом.

## Rollout-дисциплина
Коммит на шаг (trailer Co-Authored-By). Push/deploy/флаг — ТОЛЬКО по слову Berik.
Флаг сначала на Berik, потом all. SMOKE: завести obligation с personEntityId на
застоявшегося человека → боту «кому написать?» → ответ с человеком + делом. После —
следующий мост из списка 9 (решения-исходы).
