# F2-links `end_relationship` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Инструмент `end_relationship` — явный ретайр отношения («уже не работаю с X» → инвалидируем entity-link, обратимо, видимо) за флагом `FEATURE_V2_UNLINK`.

**Architecture:** Примитивы `activeLinksForEntity` + `invalidateLink` на графе; тул `end_relationship` (зеркало `cancel_obligation`): resolveEntity → single-match-или-скип → invalidateLink. Handler-флаг-гейт.

**Спека:** `docs/superpowers/specs/2026-06-10-end-relationship-design.md`.

**Tech:** Fastify+Prisma6+Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`, zod. MAIN worktree `/Users/berikkurmangoliev/Desktop/LifeOS` (проверь branch=main). Коммит-на-шаг trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. push/deploy/флаг — по слову Berik.

**Риск-принцип:** баг=спрятать правду. single-match-или-скип; обратимо (invalidAt); видимое подтверждение; cross-user через userId-фильтр.

---

### Task 1: Flag `isV2UnlinkEnabled`
**Files:** `src/lib/feature-flags.ts` (+ `.test.ts`)
- [ ] **S1 failing test** — в `feature-flags.test.ts` (рядом с `isV2SupersedeEnabled`):
```ts
import { isV2UnlinkEnabled } from './feature-flags.js';
describe('isV2UnlinkEnabled', () => {
  const KEY = 'FEATURE_V2_UNLINK'; const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });
  it('all→true', () => { process.env[KEY]='all'; expect(isV2UnlinkEnabled('u')).toBe(true); });
  it('unset/none/empty→false', () => { delete process.env[KEY]; expect(isV2UnlinkEnabled('u')).toBe(false); process.env[KEY]='none'; expect(isV2UnlinkEnabled('u')).toBe(false); process.env[KEY]=''; expect(isV2UnlinkEnabled('u')).toBe(false); });
  it('csv', () => { process.env[KEY]='user-abc'; expect(isV2UnlinkEnabled('abc')).toBe(true); expect(isV2UnlinkEnabled('z')).toBe(false); });
});
```
- [ ] **S2 run FAIL** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/lib/feature-flags.test.ts`
- [ ] **S3 impl** — рядом с `isV2SupersedeEnabled`:
```ts
/**
 * F2-связи: явный ретайр отношения (end_relationship). OFF → handler {error},
 * связь не трогается (DB identical). Тул в capabilityText всегда (как cancel_obligation).
 */
export function isV2UnlinkEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_UNLINK, userId);
}
```
- [ ] **S4 run PASS + tsc** `… && npx vitest run --project unit src/lib/feature-flags.test.ts && npx tsc --noEmit`
- [ ] **S5 commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): isV2UnlinkEnabled flag (F2-links, off=identical)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Graph primitives `activeLinksForEntity` + `invalidateLink`
**Files:** `entity-graph/types.ts`, `entity-graph/postgres-impl.ts`; Create `tools/end-relationship-wiring.test.ts`
- [ ] **S1 failing test** — создать `tools/end-relationship-wiring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const impl = readFileSync(join(process.cwd(), 'src/services/entity-graph/postgres-impl.ts'), 'utf8');
const iface = readFileSync(join(process.cwd(), 'src/services/entity-graph/types.ts'), 'utf8');

describe('F2-links — graph primitives', () => {
  it('interface объявляет activeLinksForEntity + invalidateLink', () => {
    expect(iface).toMatch(/activeLinksForEntity\(/);
    expect(iface).toMatch(/invalidateLink\(/);
  });
  it('impl invalidateLink — userId-фильтр + invalidAt active guard (cross-user safe)', () => {
    expect(impl).toMatch(/async invalidateLink\(/);
    expect(impl).toMatch(/updateMany\(\{[\s\S]*?userId[\s\S]*?invalidAt:\s*null/);
  });
  it('impl activeLinksForEntity — fromId OR toId, invalidAt null', () => {
    expect(impl).toMatch(/async activeLinksForEntity\(/);
    expect(impl).toMatch(/OR:\s*\[\{\s*fromId:[\s\S]*?toId:/);
  });
});
```
- [ ] **S2 run FAIL** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/tools/end-relationship-wiring.test.ts`
- [ ] **S3 impl**
  3a. `entity-graph/types.ts` — в интерфейс `EntityGraphStore` (рядом с `linkEntities`):
  ```ts
  /** Активные (invalidAt IS NULL) связи, ссылающиеся на сущность (как from ИЛИ to). */
  activeLinksForEntity(userId: string, entityId: string): Promise<EntityRelationship[]>;
  /** Ретайр связи (обратимо): UPDATE invalidAt=now WHERE id+userId+active. Cross-user-safe. */
  invalidateLink(userId: string, relationshipId: string): Promise<void>;
  ```
  3b. `entity-graph/postgres-impl.ts` — методы класса (рядом с `linkEntities`):
  ```ts
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
  (`EntityRelationship` уже импортирован в postgres-impl.ts.)
- [ ] **S4 run PASS + tsc** `… && npx vitest run --project unit src/tools/end-relationship-wiring.test.ts && npx tsc --noEmit`
- [ ] **S5 commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/entity-graph/types.ts packages/server/src/services/entity-graph/postgres-impl.ts packages/server/src/tools/end-relationship-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): activeLinksForEntity + invalidateLink graph primitives (F2-links)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Tool `end_relationship` + registration
**Files:** Create `tools/end-relationship.ts`; Modify `tools/index.ts`; дополнить `end-relationship-wiring.test.ts`
- [ ] **S1 failing test** — добавить в `end-relationship-wiring.test.ts`:
```ts
describe('F2-links — end_relationship tool', () => {
  const tool = readFileSync(join(process.cwd(), 'src/tools/end-relationship.ts'), 'utf8');
  const idx = readFileSync(join(process.cwd(), 'src/tools/index.ts'), 'utf8');
  it('handler флаг-гейт isV2UnlinkEnabled', () => { expect(tool).toMatch(/isV2UnlinkEnabled\(ctx\.userId\)/); });
  it('single-match-или-скип (>1 и ===0 → не invalidate)', () => {
    expect(tool).toMatch(/links\.length > 1/);
    expect(tool).toMatch(/links\.length === 0/);
    expect(tool).toMatch(/invalidateLink\(/);
  });
  it('зарегистрирован в ALL_TOOLS', () => {
    expect(idx).toMatch(/endRelationshipTool/);
    expect(idx).toMatch(/from '\.\/end-relationship\.js'/);
  });
});
```
- [ ] **S2 run FAIL** `… && npx vitest run --project unit src/tools/end-relationship-wiring.test.ts`
- [ ] **S3 impl**
  3a. Создать `tools/end-relationship.ts`:
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
  (Сверься с `cancel-obligation.ts` / `link-relationship.ts` на точную форму `defineTool` + тип возврата handler — если фреймворк требует иной shape результата, приведи в соответствие, сохранив логику.)
  3b. `tools/index.ts`: `import { endRelationshipTool } from './end-relationship.js';` (рядом с другими memory-тулзами) + добавить `endRelationshipTool,` в массив `ALL_TOOLS` рядом с `linkRelationshipTool` (≈:123).
- [ ] **S4 run целевой + ПОЛНЫЙ unit + tsc** `… && npx vitest run --project unit src/tools/end-relationship-wiring.test.ts && npm test && npx tsc --noEmit` — полный suite зелёный (реестр-валидатор `tools/index.ts:170` не должен ругаться).
- [ ] **S5 commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/tools/end-relationship.ts packages/server/src/tools/index.ts packages/server/src/tools/end-relationship-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): end_relationship tool + register (F2-links)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Integration tests
**Files:** Create `services/end-relationship.it.test.ts`
> Образец harness — `mem-graph.it.test.ts` (own PrismaClient, mkUser, restore флага). Тул-хендлер зовётся напрямую с ctx `{ userId }` (сверься, какие поля ctx реально читает handler — он использует только `ctx.userId`).
- [ ] **S1 tests** — `npm run test:db:up` затем создать `end-relationship.it.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from './entity-graph/index.js';
import { endRelationshipTool } from '../tools/end-relationship.js';

const prisma = new PrismaClient();
const PREV = process.env.FEATURE_V2_UNLINK;
afterAll(async () => { if (PREV === undefined) delete process.env.FEATURE_V2_UNLINK; else process.env.FEATURE_V2_UNLINK = PREV; await prisma.$disconnect(); });
async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({ data: { email: `it-unlink-${tag}@it.local`, name: 'IT', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

describe('F2-links — graph primitives', () => {
  it('invalidateLink ретайрит активную связь; activeLinksForEntity её больше не отдаёт', async () => {
    const uid = await mkUser(`g-${Date.now()}`);
    const g = getEntityGraph();
    const me = await g.upsertEntity(uid, { type: 'person', name: 'Я' });
    const serik = await g.upsertEntity(uid, { type: 'person', name: 'Серик' });
    await g.linkEntities(uid, me.id, serik.id, 'colleague');
    let links = await g.activeLinksForEntity(uid, serik.id);
    expect(links.length).toBe(1);
    await g.invalidateLink(uid, links[0].id);
    const row = await prisma.entityRelationship.findUnique({ where: { id: links[0].id } });
    expect(row!.invalidAt).not.toBeNull();
    links = await g.activeLinksForEntity(uid, serik.id);
    expect(links.length).toBe(0);
  });
  it('cross-user: invalidateLink чужим userId не трогает', async () => {
    const uid = await mkUser(`x-${Date.now()}`);
    const g = getEntityGraph();
    const a = await g.upsertEntity(uid, { type: 'person', name: 'A' });
    const b = await g.upsertEntity(uid, { type: 'person', name: 'B' });
    const link = await g.linkEntities(uid, a.id, b.id, 'friend');
    await g.invalidateLink('someone-else-xyz', link.id);
    const row = await prisma.entityRelationship.findUnique({ where: { id: link.id } });
    expect(row!.invalidAt).toBeNull(); // чужой не тронул
  });
});

describe('F2-links — end_relationship tool', () => {
  it('off → {error}, связь не трогается', async () => {
    process.env.FEATURE_V2_UNLINK = 'none';
    const uid = await mkUser(`off-${Date.now()}`);
    const g = getEntityGraph();
    const me = await g.upsertEntity(uid, { type: 'person', name: 'Я' });
    const x = await g.upsertEntity(uid, { type: 'person', name: 'Серик' });
    const link = await g.linkEntities(uid, me.id, x.id, 'colleague');
    const res = await endRelationshipTool.handler({ name: 'Серик' }, { userId: uid } as never);
    expect((res as { error?: string }).error).toBeDefined();
    const row = await prisma.entityRelationship.findUnique({ where: { id: link.id } });
    expect(row!.invalidAt).toBeNull();
  });
  it('on + единственная связь → инвалидирует + видимое сообщение', async () => {
    process.env.FEATURE_V2_UNLINK = 'all';
    const uid = await mkUser(`on-${Date.now()}`);
    const g = getEntityGraph();
    const me = await g.upsertEntity(uid, { type: 'person', name: 'Я' });
    const x = await g.upsertEntity(uid, { type: 'person', name: 'Серик' });
    const link = await g.linkEntities(uid, me.id, x.id, 'colleague');
    const res = await endRelationshipTool.handler({ name: 'Серик' }, { userId: uid } as never);
    expect((res as { ended?: boolean }).ended).toBe(true);
    const row = await prisma.entityRelationship.findUnique({ where: { id: link.id } });
    expect(row!.invalidAt).not.toBeNull();
  });
  it('on + >1 связь → скип (не инвалидирует, просит уточнить)', async () => {
    process.env.FEATURE_V2_UNLINK = 'all';
    const uid = await mkUser(`amb-${Date.now()}`);
    const g = getEntityGraph();
    const me = await g.upsertEntity(uid, { type: 'person', name: 'Я' });
    const x = await g.upsertEntity(uid, { type: 'person', name: 'Серик' });
    const l1 = await g.linkEntities(uid, me.id, x.id, 'colleague');
    const l2 = await g.linkEntities(uid, me.id, x.id, 'friend');
    const res = await endRelationshipTool.handler({ name: 'Серик' }, { userId: uid } as never);
    expect((res as { ended?: boolean }).ended).toBeUndefined();
    const r1 = await prisma.entityRelationship.findUnique({ where: { id: l1.id } });
    const r2 = await prisma.entityRelationship.findUnique({ where: { id: l2.id } });
    expect(r1!.invalidAt).toBeNull(); expect(r2!.invalidAt).toBeNull();
  });
});
```
> Замечания: `endRelationshipTool.handler(input, ctx)` — `ctx` приведён `as never` для минимального `{userId}` (если handler читает иные поля ctx — добавь их или сверься с типом `ToolContext`). `linkEntities` с разными `type` (colleague/friend) даёт 2 строки (триплет различается по type). resolveEntity должен найти «Серик» по точному имени — если резолв не находит (другой матчинг), подгони имя/тип под реальное поведение, НЕ меняя прод-логику.
- [ ] **S2 run** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm run test:db:up && npx vitest run --project integration src/services/end-relationship.it.test.ts` — 5 PASS. Красное → Phase-1 debug (тест/сетап).
- [ ] **S3 commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/end-relationship.it.test.ts && git commit -m "$(cat <<'EOF'
test(memory): F2-links it — invalidate, ambiguity skip, off-gate, cross-user

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full verify + independent review
- [ ] **S1** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm test && npx tsc --noEmit` — ~2664+ unit зелёных.
- [ ] **S2** `npm run test:it` — зелёно (вкл. новый it).
- [ ] **S3 OFF-проверка** — diff: handler `if (!isV2UnlinkEnabled) return {error}`; примитивы userId-фильтрованы.
- [ ] **S4 независимое ревью** (code-reviewer субагент). Фокус: off=no-link-change; **single-match-или-скип** (0/>1 не инвалидирует); cross-user (`updateMany where userId`); обратимость (invalidAt не delete); видимое подтверждение; реестр-валидатор не падает; нет `any`/ESM/`vi.mock`.
- [ ] **S5 fix findings + commit** (если есть).
- [ ] **S6 СТОП** — доложить Berik. Не пушить. Предложить push+deploy+`FEATURE_V2_UNLINK=all` по слову.

---

## Self-Review
- **Покрытие спеки:** флаг (T1), примитивы (T2), тул+регистрация (T3), it (T4), verify (T5). Все юниты покрыты.
- **Заглушки:** код полный; команды точные; «сверься с _types/ToolContext/resolveEntity-поведением» — явная сверка с реальностью, не выдуманные символы.
- **Типы:** `isV2UnlinkEnabled(userId)`; `activeLinksForEntity(userId,entityId)→EntityRelationship[]`; `invalidateLink(userId,relationshipId)→void`; handler возврат `{error}`/`{ok,message}`/`{ok,ended,message}`.
- **Риск-гард:** single-match (`links.length`-ветки), cross-user (`where userId`), обратимо (invalidAt), видимое сообщение, handler-флаг-гейт.

## Execution Handoff
Subagent-Driven (как раньше): свежий субагент на задачу, ревью между. push/deploy/флаг — по слову Berik.
