# «Камила» — затухание на чтении (read-side decay) — Design Spec

> Дата: 2026-06-11. Ветка-источник: **main**. Server-only (`packages/server`).
> Контекст: финал memory-качества (F6, диагноз `docs/diagnostics/2026-06-07-memory-quality-diagnosis.md`). Berik: «сделать Камилу → закрыть память». Выбран read-side (видимое поведение, НИЧЕГО не удаляем).

**Goal:** Старая низко-ценная сущность/факт (разовая «Камила», виделись раз 6 мес назад) перестаёт **всплывать** в «ключевых людях» и в recall, уступая место свежему/важному. Данные НЕ удаляем — меняем только РАНЖИРОВАНИЕ/что показываем.

**Root cause (проверено explore):**
- TTL только у `event`(30д)/`emotion`(14д); `person`/`fact`/`preference` → `expiresAt=null` = вечные.
- `FEATURE_V2_FORGET=all` убирает из recall только `type='message'` — НЕ `person`/`fact`.
- Entity-enrichment «ключевые люди» = top-5 по `importance` (`v2-enrichment.ts`), `lastSeenAt` для затухания НЕ используется → разовая «Камила» сидит вечно.
- Recall FTS-скор: `ts_rank + importance/10 + exp(-age/30)` — `importance/10` НЕ зависит от возраста → старая imp-5 стоит вровень со свежей.

**Architecture:** Один флаг `FEATURE_V2_DECAY`, **read-only**, off=байт-идентично. Чистый хелпер `recencyFactor` + `entityDecayScore`. Две врезки: (1) entity-enrichment ранг = `importance × свежесть`; (2) recall FTS-скор — `importance`-вклад умножается на свежесть. НИЧЕГО не пишется/удаляется → полностью обратимо (флаг off).

**Риск-принцип:** ниже F2 (там прятали; тут только ПОРЯДОК показа, данные целы). Главный риск — скрыть из вида важного-но-нечастого человека (мама, виделись 40д). Гасим: затухание МЯГКОЕ (умножение, не отсечка) + importance сохраняется (мама imp-9 при 40д всё ещё высоко). Константы калибруем.

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`. Коммит-на-шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Текущее (проверено на main, explore)
- `v2-enrichment.ts:~352`: `prisma.entity.findMany({ where:{userId}, orderBy:[{importance:'desc'},{lastSeenAt:'desc'}], take:5, select:{name,importance,lastSeenAt} })` → map в `{name, importance, daysSinceLastSeen}`.
- `memory-service.ts` `getRelevantMemories` FTS-путь (≈:228-245): скор `ts_rank(...) + (m.importance::float/10.0) + exp(- extract(epoch from (NOW()-m."createdAt"))/(86400.0*30.0))`.
- `Entity.lastSeenAt` пишется в upsertEntity; `Memory.importance`/`createdAt` есть.

---

## Флаг
`feature-flags.ts` — новый (зеркало `isV2UnlinkEnabled`):
```ts
/**
 * Read-side decay (Камила): старое низко-ценное тонет в ранжировании enrichment+recall.
 * READ-ONLY — ничего не пишется/удаляется. OFF → ранжирование прежнее (байт-идентично).
 */
export function isV2DecayEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_DECAY, userId);
}
```

## Юнит A — чистые хелперы
`packages/server/src/services/memory-decay.ts` (новый, чистые функции, легко юнит-тестировать):
```ts
/** Экспоненциальная свежесть: 1.0 сейчас → 0.5 через halflifeDays → ~0 на больших сроках.
 *  daysSince клампится в [0, ∞). halflifeDays > 0. */
export function recencyFactor(daysSince: number, halflifeDays: number): number {
  const d = Math.max(0, daysSince);
  return Math.pow(2, -d / halflifeDays);
}

/** Эффективная значимость сущности для показа: importance × свежесть(lastSeenAt).
 *  null lastSeenAt → трактуем как очень старое (фактор для большого срока). */
export const ENTITY_HALFLIFE_DAYS = 45;
export function entityDecayScore(
  importance: number,
  lastSeenAt: Date | null,
  now: Date,
): number {
  const days = lastSeenAt ? (now.getTime() - lastSeenAt.getTime()) / 86_400_000 : 3650;
  return importance * recencyFactor(days, ENTITY_HALFLIFE_DAYS);
}
```
**Калибровка (в спеке, проверить юнитом):** мама imp9 @40д = 9×2^(−40/45)=9×0.54≈**4.9**; разовая «Камила» imp5 @180д = 5×2^(−180/45)=5×0.0625≈**0.31**; свежий знакомый imp4 @5д = 4×2^(−5/45)≈**3.7**. → мама и свежий остаются в top-5, Камила тонет. `ENTITY_HALFLIFE_DAYS=45` — мягко, важное не отсекаем.

## Юнит B — Part 1: entity-enrichment ранг по свежести
`v2-enrichment.ts` — флаг-ветка вокруг entity-запроса:
```ts
let entityRows;
if (isV2DecayEnabled(userId)) {
  // Шире сеть → ре-ранг по importance×свежесть → top-5 (старые одноразовые тонут).
  const wide = await prisma.entity.findMany({
    where: { userId },
    orderBy: [{ importance: 'desc' }, { lastSeenAt: 'desc' }],
    take: 25,
    select: { name: true, importance: true, lastSeenAt: true },
  });
  entityRows = wide
    .map((e) => ({ e, s: entityDecayScore(e.importance, e.lastSeenAt, now) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.e);
} else {
  entityRows = await prisma.entity.findMany({
    where: { userId },
    orderBy: [{ importance: 'desc' }, { lastSeenAt: 'desc' }],
    take: 5,
    select: { name: true, importance: true, lastSeenAt: true },
  });
}
```
**off** → ровно прежний запрос (`take:5`, тот orderBy) → байт-идентично. `now` уже есть в области (используется ниже для `daysSinceLastSeen`); если нет — `const now = new Date()` рядом. Импорт `isV2DecayEnabled`, `entityDecayScore`.

## Юнит C — Part 2: recall FTS — importance-вклад затухает с возрастом
`memory-service.ts` FTS-путь — `importance`-член умножается на свежесть (флаг-гейт в строке SQL):
```ts
const MEM_HALFLIFE_DAYS = 90; // факты живут дольше людей
const impTerm = isV2DecayEnabled(userId)
  ? `(m.importance::float / 10.0) * power(2, - extract(epoch from (NOW() - m."createdAt")) / (86400.0 * ${MEM_HALFLIFE_DAYS}))`
  : `(m.importance::float / 10.0)`;
```
И подставить `${impTerm}` вместо литерального `(m.importance::float / 10.0)` в выражение скора. Существующий бонус `+ exp(-age/30)` НЕ трогаем. **off** → строка ровно прежняя `(m.importance::float / 10.0)` → SQL байт-идентичен.
**Калибровка:** imp5 свежий = 0.5×1=0.5; imp5 @180д = 0.5×2^(−2)=0.125; imp2 @180д = 0.2×0.25=0.05. Старая низко-важная тонет, свежая релевантная — нет. `MEM_HALFLIFE_DAYS=90`.

## Обработка ошибок
- Чисто read-only: ошибок записи нет. Хелперы тотальные (клампы). Флаг off → прежнее поведение.
- Часть Part 2 — строка в существующем `$queryRawUnsafe`-скоринге (сверить, что путь именно `Unsafe`-интерполяция числовой константы безопасна — `MEM_HALFLIFE_DAYS` литерал кода, НЕ юзер-ввод).

## Тесты
**Unit:** `recencyFactor` (1.0@0, 0.5@halflife, убывает); `entityDecayScore` (мама>Камила числа из спеки); `isV2DecayEnabled` флаг. Структурный: `v2-enrichment.ts` имеет флаг-ветку + `entityDecayScore`/`take: 25`; `memory-service.ts` имеет флаг-гейт `impTerm`/`MEM_HALFLIFE_DAYS`; off-ветки сохраняют прежние литералы (`take: 5`, `(m.importance::float / 10.0)`).
**Integration (`mem-decay.it.test.ts`):**
- Part 1: создать сущности — важная-старая (мама imp9 @40д), разовая-старая («Камила» imp5 @180д), 4 свежих заполнителя; enrichment-функция (или прямой ре-ранг через `entityDecayScore`) с флагом on → «Камила» НЕ в top-5, мама В top-5; флаг off → старый порядок (Камила может быть в top-5).
- Part 2: две памяти type `fact` одинаковой важности, одна свежая одна 180д, FTS-запрос по общему слову → on: свежая ранжируется выше; off: старая не ниже (прежний скор). (если прямой замер скора сложен — сравнить порядок результатов `getRelevantMemories`).

## Декомпозиция (файлы)
| Файл | Изменение |
|------|-----------|
| `src/lib/feature-flags.ts` (+test) | `isV2DecayEnabled` |
| `src/services/memory-decay.ts` (new) + `.test.ts` | `recencyFactor`, `entityDecayScore`, константы |
| `src/services/v2-enrichment.ts` | Part 1 флаг-ветка entity-ранг |
| `src/services/memory-service.ts` | Part 2 флаг-гейт impTerm |
| `src/services/mem-decay-wiring.test.ts` (new) | структурный гард обеих врезок |
| `src/services/mem-decay.it.test.ts` (new) | интеграция Part 1 + Part 2 |

## Rollout
Коммит-на-шаг (atomic TDD). Полный verify + независимое ревью (фокус: off=байт-идентично обе врезки; read-only — 0 записей/удалений; важное-нечастое НЕ исчезает; константы вменяемы). `push`/`deploy`/`FEATURE_V2_DECAY=all` — ТОЛЬКО по слову Berik.

## Граница (честно)
- Чиним **что ВСПЛЫВАЕТ** (recall+enrichment). Ряд в БД остаётся (невидимый, безвредный). Storage НЕ сжимается — это отдельный (рискованнее) шаг: TTL на person/fact или разовая чистка. НЕ в этом срезе.
- Константы (45д/90д) — стартовые, проверены арифметикой в спеке; read-side → не safety-critical, тюнятся позже.
- Part 2 трогает общий recall-скоринг (не только «Камилу») — мягко (умножение), но осознанно: старое-низко-важное тонет по всем запросам. Это и есть цель.
- НЕ детектит «выдуманность» (фабрикацию) — только возраст×важность. Антифабрикация — отдельный слой (уже есть `FEATURE_V2_ANTIFAB`).
