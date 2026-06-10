# F2-связи — ретайр отношений (`end_relationship`) — Design Spec

> Дата: 2026-06-10. Ветка-источник: **main**. Server-only (`packages/server`).
> Контекст: продолжение F2 (явная коррекция) на ОТНОШЕНИЯ. Berik выбрал **Вариант A — явный инструмент** (видимое действие = безопаснее молчаливого фона).

**Goal:** Когда юзер ЯВНО завершает отношение («уже не работаю с X», «развёлся с Y», «мы расстались»), бот инвалидирует активную entity-связь (обратимо, `invalidAt`) и ВИДИМО подтверждает. Сейчас связи создаются с `invalidAt:null` и пути ретайра нет.

**Architecture:** Новый инструмент `end_relationship` (зеркало `cancel_obligation`): резолвит сущность по имени → ищет активную связь, ссылающуюся на неё → **single-match-или-скип** → новый примитив `invalidateLink` (UPDATE `invalidAt`, обратимо). Читатели уже фильтруют `invalidAt IS NULL` → ретайр прячет связь. За флагом `FEATURE_V2_UNLINK` (handler-gate, как `cancel_obligation`).

**Риск-принцип (как F2-память):** баг = спрятать правду. Гасим: явный сигнал (tool-FSM), **видимое** подтверждение («убрал X» → юзер заметит ошибку), обратимо (не delete), single-match-или-скип, cross-user через `userId`-фильтр.

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`, zod-схемы. Коммит-на-шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Текущее (проверено на main)
- `linkEntities` создаёт `EntityRelationship` (триплет userId+fromId+toId+type, `invalidAt:null`). Идемпотентно. **Нет пути ретайра.**
- `EntityRelationship`{id,userId,fromId,toId,type,label,strength,validAt,invalidAt?,...}. Читатели (`getNeighbors`) фильтруют `invalidAt IS NULL`.
- `resolveEntity(userId, mention, type?) → Entity | null` (FTS+embedding резолвер).
- Тулзы: `defineTool({name,description,category,aliases,schema(zod),needsConfirm,sideEffects,examples,handler})`; `getEntityGraph()` из `'../services/entity-graph/index.js'`; handler-флаг-гейт = конвенция (`cancel_obligation:17`). Реестр `ALL_TOOLS` (tools/index.ts) статичен → `capabilityText()` автоген.

---

## Флаг
`feature-flags.ts` — новый (зеркало `isV2SupersedeEnabled`):
```ts
/**
 * F2-связи: явный ретайр отношения (end_relationship). OFF → handler возвращает
 * {error}, связь не трогается (DB identical). Тул в capabilityText всегда (как
 * cancel_obligation) — флипаем =all на деплое, тёмное окно короткое.
 */
export function isV2UnlinkEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_UNLINK, userId);
}
```

## Юнит A — примитивы графа (`EntityGraphStore`)

### Интерфейс (`entity-graph/types.ts`) + impl (`postgres-impl.ts`)
```ts
// interface (рядом с linkEntities/getNeighbors):
/** Активные (invalidAt IS NULL) связи, ссылающиеся на сущность (как from ИЛИ to). */
activeLinksForEntity(userId: string, entityId: string): Promise<EntityRelationship[]>;
/** Ретайр связи (обратимо): UPDATE invalidAt=now WHERE id+userId+active. Cross-user-safe. */
invalidateLink(userId: string, relationshipId: string): Promise<void>;
```
```ts
// impl:
async activeLinksForEntity(userId: string, entityId: string): Promise<EntityRelationship[]> {
  return prisma.entityRelationship.findMany({
    where: { userId, invalidAt: null, OR: [{ fromId: entityId }, { toId: entityId }] },
  });
}
async invalidateLink(userId: string, relationshipId: string): Promise<void> {
  await prisma.entityRelationship.updateMany({
    where: { id: relationshipId, userId, invalidAt: null },
    data: { invalidAt: new Date() },
  });
}
```
(`updateMany` + `where userId` — cross-user-safe и идемпотентно: тронет 0 строк, если чужая/уже-инвалидна.)

## Юнит B — инструмент `end_relationship`
`packages/server/src/tools/end-relationship.ts` (зеркало `cancel-obligation.ts` + `link-relationship.ts`):
```ts
import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';
import { isV2UnlinkEnabled } from '../lib/feature-flags.js';

export const endRelationshipTool = defineTool({
  name: 'end_relationship',
  description:
    'Завершить/убрать отношение с человеком, местом или организацией. Вызывай на «уже не работаю с X», «мы расстались», «развёлся с Y», «уволился из X». Обратимо.',
  category: 'memory',
  aliases: { person: 'name', who: 'name', entity: 'name', whom: 'name' },
  schema: z.object({ name: z.string().min(1).max(255) }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['уже не работаю с Сериком', 'мы расстались с Айгерим', 'уволился из Kaspi'],
  handler: async (input, ctx) => {
    if (!isV2UnlinkEnabled(ctx.userId)) return { error: 'функция отключена' };
    const graph = getEntityGraph();
    const ent = await graph.resolveEntity(ctx.userId, String(input.name));
    if (!ent) return { error: `Не нашёл «${input.name}» в связях` };
    const links = await graph.activeLinksForEntity(ctx.userId, ent.id);
    if (links.length === 0) return { ok: true, message: `У тебя нет активной связи с «${ent.name}»` };
    if (links.length > 1) return { ok: true, message: `У тебя несколько связей с «${ent.name}» — уточни, какую убрать?` };
    await graph.invalidateLink(ctx.userId, links[0].id);
    return { ok: true, ended: true, message: `Убрал связь с «${ent.name}» (можно вернуть)` };
  },
});
```
**Семантика:** off → `{error:'функция отключена'}` (DB не тронут). on → резолв → 0 связей: сообщение; >1: скип+уточнение (single-match-или-скип, не угадываем); ровно 1 → `invalidateLink` + видимое «Убрал X».

## Юнит C — регистрация
`tools/index.ts`: `import { endRelationshipTool } from './end-relationship.js';` + добавить `endRelationshipTool` в массив `ALL_TOOLS` рядом с `linkRelationshipTool` (≈:123).

## Обработка ошибок
- Резолв/поиск — best-effort через tool-loop (ошибка тула → is_error, бот сообщает, не падает). `invalidateLink` идемпотентен.
- Обратимо (`invalidAt`, не delete). Видимое подтверждение = юзер ловит ложный ретайр сразу.

## Тесты
**Unit:** `isV2UnlinkEnabled` (флаг); структурный — `end-relationship.ts` существует, handler-флаг-гейт `isV2UnlinkEnabled`, single-match (`links.length > 1` → скип-сообщение, `=== 0` → сообщение), `invalidateLink` зовётся; `tools/index.ts` регистрирует `endRelationshipTool`; интерфейс графа имеет `invalidateLink`+`activeLinksForEntity`.
**Integration (`end-relationship.it.test.ts`):**
- Создать 2 сущности + `linkEntities` (user↔X, type colleague). `activeLinksForEntity` → 1; `invalidateLink` → `invalidAt` выставлен; `activeLinksForEntity` → 0 (исчезла).
- Неоднозначность: 2 активные связи на X (colleague + friend) → tool-логика возвращает скип (>1), обе живы.
- cross-user: `invalidateLink(другой-userId, id)` → 0 строк (чужую не трогает).
- not-found: resolveEntity на несуществующее → handler `{error}`.

## Декомпозиция (файлы)
| Файл | Изменение |
|------|-----------|
| `src/lib/feature-flags.ts` (+test) | `isV2UnlinkEnabled` |
| `entity-graph/types.ts` + `postgres-impl.ts` | `activeLinksForEntity` + `invalidateLink` |
| `tools/end-relationship.ts` (new) | инструмент |
| `tools/index.ts` | регистрация |
| `tools/end-relationship-wiring.test.ts` (new) | структурный гард |
| `services/end-relationship.it.test.ts` (new) | интеграция |

## Rollout
Коммит-на-шаг (atomic TDD). Полный verify + независимое ревью (фокус: off=no-link-change; single-match-или-скип; cross-user через userId-фильтр; обратимость; видимое подтверждение). `push`/`deploy`/`FEATURE_V2_UNLINK=all` — ТОЛЬКО по слову Berik.

## Граница (честно)
- Ретайр по ЯВНОМУ сигналу через инструмент. «развёлся» без имени партнёра → resolveEntity не найдёт → `{error}` (скип, не угадываем).
- **Тип не различаем** (>1 связь к X → скип+уточнение, не выбираем какую). Будущее: принять опц. тип/relation.
- **off-нюанс:** тул в capabilityText всегда (реестр статичен, как `cancel_obligation`) — но handler-gated, DB-эффект только при флаге. НЕ byte-identical промпт (новый тул = +строка в ДЕЙСТВИЯ), но это конвенция для новых тулзов.
- НЕ детектит смену связи в фоне (это Вариант B, не выбран).
