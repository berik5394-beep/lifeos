# Memory — целостность графа (T5-остаток) — Design Spec

> Дата: 2026-06-09. Ветка-источник: **main**. Server-only (`packages/server`).
> Контекст: продолжение «качества факт-памяти». Tier-2 (T4+T3+T5-details+E2-recall) уже done+prod (`FEATURE_V2_MEM_QUALITY=all`). Этот срез закрывает **остаток T5** из диагноза `docs/diagnostics/2026-06-07-memory-quality-diagnosis.md`.

**Goal:** Остановить АКТИВНУЮ тихую порчу графа: (1) `Entity.attributes` затираются «incoming-wins» при коллизии ключа («брат»→«знакомый» из случайной реплики); (2) FTS-дедуп памяти обновляет ЧУЖУЮ строку по одному общему токену (нет порога ранга).

**Architecture:** 2 точечных guard'а за НОВЫМ флагом `FEATURE_V2_MEM_GRAPH`, off=байт-идентично. Различаем **намеренную** запись (инструменты — явная правда юзера, incoming-wins) и **фоновую** (экстракция — preserve существующего). Память/граф best-effort — изменения только в путях upsert/dedup, не на критическом пути ответа.

**Tech Stack:** Fastify + Prisma6 + Postgres(+pgvector), ESM (`.js`), TS strict (no `any`), vitest (`npm test` unit / `npm run test:it` integration на :5433), zero `vi.mock`. Коммит-на-шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Корень (проверено на `main`)

| # | Дыра | Точка | Сейчас |
|---|------|-------|--------|
| **A** | `Entity.attributes` incoming-wins → коллизия ключа клобберит сильное слабым («брат»→«знакомый») | `entity-graph/postgres-impl.ts:113` (точный матч), `:136` (resolve-merge) | `{ ...existing.attributes, ...attributes }` — incoming перетирает |
| **B** | FTS-дедуп памяти берёт `LIMIT 1` по `ts_rank` БЕЗ минимального порога → слабый матч (один общий токен) обновляет чужую строку | `episodic-memory.ts:176-189` (`$queryRaw` дедупа в `writeMemory`) | `@@ plainto_tsquery` + `ORDER BY ts_rank DESC LIMIT 1`, без `WHERE rank > порог` |

`upsertEntity(userId, entity)` вызывается из: **инструментов** (намеренно) `remember-entity.ts:30`, `set-birthday.ts:36`, `link-relationship.ts:31,35`, `set-person-type.ts:27`; **фоновой экстракции** `v2-capture.ts:70,83,87`.

---

## Флаг

`packages/server/src/lib/feature-flags.ts` — новый (зеркало `isV2MemQualityEnabled`), ОТДЕЛЬНЫЙ (т.к. `FEATURE_V2_MEM_QUALITY` уже =all → этот должен быть тёмным до ревью+флипа):

```ts
/**
 * Целостность графа (T5-остаток): guard на Entity.attributes (preserve при
 * фоновой записи, incoming-wins при намеренной) + порог ранга в FTS-дедупе
 * памяти. OFF → байт-идентично прежнему incoming-wins / без-порога.
 */
export function isV2MemGraphEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MEM_GRAPH, userId);
}
```

---

## Юнит A — `mergeAttributes` + врезка в upsertEntity

### Чистый хелпер
`packages/server/src/services/entity-graph/merge-helpers.ts` (рядом с `capAliases`):

```ts
/**
 * Merge атрибутов сущности (T5).
 *  - deliberate=true (инструмент, явная правда юзера): incoming-wins (как сейчас).
 *  - deliberate=false (фоновая экстракция): НЕ затирать непустое существующее;
 *    заполнять пустые ключи; добавлять новые. → «брат» не сменится «знакомым»
 *    из случайной реплики.
 */
export function mergeAttributes(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  deliberate: boolean,
): Record<string, unknown> {
  if (deliberate) return { ...existing, ...incoming };
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    const cur = out[k];
    const curEmpty = cur === undefined || cur === null || cur === '';
    if (curEmpty) out[k] = v; // заполнить пустое; непустое — сохранить
  }
  return out;
}
```

### Сигнатура upsertEntity + opts
`entity-graph/types.ts` (interface) и `postgres-impl.ts` (impl) — добавить 3-й опц. параметр:

```ts
upsertEntity(
  userId: string,
  entity: Partial<Entity> & { name: string; type: string },
  opts?: { deliberate?: boolean },
): Promise<Entity>;
```

### Врезка (за флагом) — в обеих точках merge
`postgres-impl.ts:113` и `:136` — заменить `const mergedAttributes = { ...(…), ...attributes };` на:

```ts
const deliberate = opts?.deliberate ?? false;
const mergedAttributes = isV2MemGraphEnabled(userId)
  ? mergeAttributes(existing.attributes as Record<string, unknown>, attributes, deliberate)
  : { ...(existing.attributes as Record<string, unknown>), ...attributes };
```
(во второй точке — `resolved.attributes` вместо `existing.attributes`). **off → `{ ...existing, ...attributes }`** байт-идентично. Импорт `mergeAttributes` из `./merge-helpers.js`, `isV2MemGraphEnabled` из `../../lib/feature-flags.js`.

### Пробросить deliberate из инструментов
В 5 tool-call-сайтах добавить 3-м аргументом `{ deliberate: true }`:
- `tools/remember-entity.ts:30`, `tools/set-birthday.ts:36`, `tools/link-relationship.ts:31` и `:35`, `tools/set-person-type.ts:27`.

Фоновые (`v2-capture.ts:70,83,87`) — НЕ трогаем (default `deliberate:false` → preserve).

**Семантика:** off → все incoming-wins (как сегодня). on → инструменты incoming-wins (правки работают), экстракция preserve (стоп клобберу). Единственное изменение поведения on = фоновая экстракция перестаёт затирать непустые атрибуты.

---

## Юнит B — Порог ранга в FTS-дедупе памяти

`packages/server/src/services/episodic-memory.ts` — в `writeMemory`, дедуп-`$queryRaw` (строки 176-189):

1. Константа рядом: `const MEM_DEDUP_MIN_RANK = 0.05;`
2. В SELECT дедупа добавить ранг: `, ts_rank(to_tsvector('russian', coalesce(m.content, '')), plainto_tsquery('russian', ${content})) AS rank` (тип результата +`rank: number`).
3. Гейт в JS перед update-веткой:

```ts
if (dup.length > 0) {
  const existing = dup[0];
  const rankOk =
    !isV2MemGraphEnabled(userId) || (existing.rank ?? 1) > MEM_DEDUP_MIN_RANK;
  if (rankOk) {
    // ...существующая update-ветка (мерж tags/details/importance, эмбеддинг)...
    return { id: existing.id, action: 'updated' };
  }
  // on + слабый матч → проваливаемся в create (новая запись, не клобберим чужую)
}
// ...существующая create-ветка...
```

**off → `rankOk` всегда true → байт-идентично** (update как сегодня). on → матч с `rank ≤ 0.05` создаёт новую запись. `MEM_DEDUP_MIN_RANK` — консервативный, настраиваемый. Эмбеддинг-дедуп НЕ трогаем.

---

## Обработка ошибок
- `mergeAttributes`/гейт ранга — чистые/синхронные, не бросают. `writeMemory` уже глотает ошибки (`action:'skipped'`). upsertEntity — как сейчас. Изменения только в путях записи графа/памяти, не в ответе юзеру.

## Тесты
**Unit (`*.test.ts`):**
- `mergeAttributes` (в `merge-helpers.test.ts`): deliberate→incoming-wins; !deliberate коллизия непустого→preserve; пустой/undefined ключ→fill; новые ключи→добавлены; пустой incoming→existing неизменно.
- `isV2MemGraphEnabled` (в `feature-flags.test.ts`): all/none/unset/csv.
- Структурный гард: `postgres-impl.ts` имеет флаг-ветку `mergeAttributes` в ОБЕИХ точках + OFF-ветка `{ ...…, ...attributes }`; `episodic-memory.ts` имеет `MEM_DEDUP_MIN_RANK` + `rankOk` гейт; 5 tool-call-сайтов содержат `deliberate: true`.

**Integration (`*.it.test.ts`):**
- A: фоновый `upsertEntity` с `attributes:{relation:'брат'}`, затем фоновый с `{relation:'знакомый'}` (флаг on) → `relation` остаётся `'брат'`. Тот же сценарий с `{deliberate:true}` → `'знакомый'` (правка работает). Новый ключ при фоновом → добавляется.
- B: `writeMemory` строки с непересекающимся смыслом, но одним общим стоп-токеном (слабый FTS-матч) под флагом → создаётся НОВАЯ запись (не обновляется чужая). Сильный матч (тот же факт) → дедуп как прежде.
- cross-user изоляция.

Baseline ~2635 unit зелёный.

## Декомпозиция (файлы)
| Файл | Изменение |
|------|-----------|
| `src/lib/feature-flags.ts` (+ test) | `isV2MemGraphEnabled` |
| `entity-graph/merge-helpers.ts` (+ test) | `mergeAttributes` pure |
| `entity-graph/types.ts` | upsertEntity `opts?` в interface |
| `entity-graph/postgres-impl.ts` | upsertEntity `opts?` + флаг-ветка `mergeAttributes` ×2 |
| `tools/{remember-entity,set-birthday,link-relationship,set-person-type}.ts` | `{ deliberate: true }` |
| `services/episodic-memory.ts` | `MEM_DEDUP_MIN_RANK` + `rank` в SELECT + `rankOk` гейт |
| структурный + it тесты | новые |

## Rollout
Коммит-на-шаг (atomic TDD). Полный verify + независимое ревью (фокус: off=байт-идентично; deliberate-проброс верный; дедуп-порог не ломает сильный матч; нет `any`/ESM). `push`/`deploy`/`FEATURE_V2_MEM_GRAPH=all` — ТОЛЬКО по слову Berik, флаг сразу =all.

## Граница
Чинит ЦЕЛОСТНОСТЬ графа (стоп активной порче). НЕ трогает: F2-контрадикшн/супер-седдинг, чистку старого мусора («Камила»), E2-переупорядочивание блоков, T6/T7/F6 — это отдельные следующие срезы на чистой основе.
