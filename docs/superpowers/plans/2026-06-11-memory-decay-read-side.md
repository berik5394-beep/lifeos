# «Камила» read-side decay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Старое низко-ценное (разовая «Камила» 6 мес назад) тонет в ранжировании entity-enrichment + recall, уступая свежему/важному. READ-ONLY, ничего не удаляем.

**Architecture:** Флаг `FEATURE_V2_DECAY`; чистый хелпер `recencyFactor`+`entityDecayScore`; Part 1 — entity-enrichment ранг `importance×свежесть`; Part 2 — recall FTS importance-член затухает с возрастом. off=байт-идентично.

**Спека:** `docs/superpowers/specs/2026-06-11-memory-decay-read-side-design.md`.

**Tech:** Fastify+Prisma6+Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`. MAIN worktree `/Users/berikkurmangoliev/Desktop/LifeOS` (branch=main). Коммит-на-шаг trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. push/deploy/флаг — по слову Berik.

**Риск:** read-only (0 записей/удалений). Риск — скрыть важного-нечастого; гасим мягким умножением + сохранением importance. Калибровка в спеке (арифметика).

---

### Task 1: Flag `isV2DecayEnabled`
**Files:** `src/lib/feature-flags.ts` (+`.test.ts`)
- [ ] **S1** тест (рядом с `isV2UnlinkEnabled`):
```ts
import { isV2DecayEnabled } from './feature-flags.js';
describe('isV2DecayEnabled', () => {
  const KEY = 'FEATURE_V2_DECAY'; const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });
  it('all→true', () => { process.env[KEY]='all'; expect(isV2DecayEnabled('u')).toBe(true); });
  it('unset/none/empty→false', () => { delete process.env[KEY]; expect(isV2DecayEnabled('u')).toBe(false); process.env[KEY]='none'; expect(isV2DecayEnabled('u')).toBe(false); process.env[KEY]=''; expect(isV2DecayEnabled('u')).toBe(false); });
  it('csv', () => { process.env[KEY]='user-abc'; expect(isV2DecayEnabled('abc')).toBe(true); expect(isV2DecayEnabled('z')).toBe(false); });
});
```
- [ ] **S2** FAIL: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/lib/feature-flags.test.ts`
- [ ] **S3** impl (рядом с `isV2UnlinkEnabled`):
```ts
/**
 * Read-side decay (Камила): старое низко-ценное тонет в ранжировании enrichment+recall.
 * READ-ONLY — ничего не пишется/удаляется. OFF → ранжирование прежнее (байт-идентично).
 */
export function isV2DecayEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_DECAY, userId);
}
```
- [ ] **S4** PASS+tsc: `… && npx vitest run --project unit src/lib/feature-flags.test.ts && npx tsc --noEmit`
- [ ] **S5** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): isV2DecayEnabled flag (read-side decay, off=identical)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure helpers `memory-decay.ts`
**Files:** Create `src/services/memory-decay.ts` + `src/services/memory-decay.test.ts`
- [ ] **S1** тест `memory-decay.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { recencyFactor, entityDecayScore, ENTITY_HALFLIFE_DAYS } from './memory-decay.js';

describe('recencyFactor', () => {
  it('1.0 на 0 дней', () => { expect(recencyFactor(0, 45)).toBeCloseTo(1, 6); });
  it('0.5 на halflife', () => { expect(recencyFactor(45, 45)).toBeCloseTo(0.5, 6); });
  it('убывает с возрастом', () => { expect(recencyFactor(180, 45)).toBeLessThan(recencyFactor(45, 45)); });
  it('клампит отрицательное к 0 (→1.0)', () => { expect(recencyFactor(-10, 45)).toBeCloseTo(1, 6); });
});
describe('entityDecayScore', () => {
  const NOW = new Date('2026-06-11T00:00:00Z');
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
  it('мама imp9 @40д > Камила imp5 @180д', () => {
    const mama = entityDecayScore(9, daysAgo(40), NOW);
    const kamila = entityDecayScore(5, daysAgo(180), NOW);
    expect(mama).toBeGreaterThan(kamila);
    expect(kamila).toBeLessThan(1); // протухла
  });
  it('свежий imp4 @5д остаётся высоким', () => { expect(entityDecayScore(4, daysAgo(5), NOW)).toBeGreaterThan(3); });
  it('null lastSeenAt → очень низкий (трактуем как древнее)', () => { expect(entityDecayScore(5, null, NOW)).toBeLessThan(0.1); });
  it('ENTITY_HALFLIFE_DAYS = 45', () => { expect(ENTITY_HALFLIFE_DAYS).toBe(45); });
});
```
- [ ] **S2** FAIL: `… && npx vitest run --project unit src/services/memory-decay.test.ts`
- [ ] **S3** impl `memory-decay.ts`:
```ts
/** Экспоненциальная свежесть: 1.0 сейчас → 0.5 через halflifeDays → ~0 на больших сроках. */
export function recencyFactor(daysSince: number, halflifeDays: number): number {
  const d = Math.max(0, daysSince);
  return Math.pow(2, -d / halflifeDays);
}

/** Период полураспада значимости сущности (дни). */
export const ENTITY_HALFLIFE_DAYS = 45;

/** Эффективная значимость сущности для показа: importance × свежесть(lastSeenAt).
 *  null lastSeenAt → трактуем как древнее (10 лет). */
export function entityDecayScore(
  importance: number,
  lastSeenAt: Date | null,
  now: Date,
): number {
  const days = lastSeenAt ? (now.getTime() - lastSeenAt.getTime()) / 86_400_000 : 3650;
  return importance * recencyFactor(days, ENTITY_HALFLIFE_DAYS);
}
```
- [ ] **S4** PASS+tsc: `… && npx vitest run --project unit src/services/memory-decay.test.ts && npx tsc --noEmit`
- [ ] **S5** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/memory-decay.ts packages/server/src/services/memory-decay.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): recencyFactor + entityDecayScore pure helpers (read-side decay)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Part 1 — entity-enrichment ранг по свежести
**Files:** Modify `src/services/v2-enrichment.ts`; Create `src/services/mem-decay-wiring.test.ts`
- [ ] **S1** создать `mem-decay-wiring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const enr = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf8');

describe('read-side decay — Part 1 entity-enrichment', () => {
  it('флаг-ветка isV2DecayEnabled + entityDecayScore ре-ранг', () => {
    expect(enr).toMatch(/isV2DecayEnabled\(/);
    expect(enr).toMatch(/entityDecayScore\(/);
    expect(enr).toMatch(/take:\s*25/); // широкая сеть в on-ветке
  });
  it('off-ветка сохраняет take: 5', () => { expect(enr).toMatch(/take:\s*5/); });
});
```
- [ ] **S2** FAIL: `… && npx vitest run --project unit src/services/mem-decay-wiring.test.ts`
- [ ] **S3** impl: ОТКРОЙ `v2-enrichment.ts`, найди entity-запрос `prisma.entity.findMany({ where:{userId}, orderBy:[{importance:'desc'},{lastSeenAt:'desc'}], take:5, select:{name,importance,lastSeenAt} })` (≈:352). Замени на флаг-ветку:
```ts
let entityRows;
if (isV2DecayEnabled(userId)) {
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
Сверь имя переменной результата с тем, что используется ниже (если не `entityRows` — переименуй ветки под существующее). Убедись `now` в области (иначе `const now = new Date()` перед веткой — он уже используется для daysSinceLastSeen). Импорты вверху: `isV2DecayEnabled` из `'../lib/feature-flags.js'`, `entityDecayScore` из `'./memory-decay.js'`. off-ветка ДОЛЖНА быть точной копией прежнего запроса (take:5, тот orderBy/select).
- [ ] **S4** целевой+ПОЛНЫЙ unit+tsc: `… && npx vitest run --project unit src/services/mem-decay-wiring.test.ts && npm test && npx tsc --noEmit` — полный зелёный.
- [ ] **S5** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/v2-enrichment.ts packages/server/src/services/mem-decay-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): entity-enrichment ranks by importance×freshness behind flag (Part 1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Part 2 — recall FTS importance-член затухает
**Files:** Modify `src/services/memory-service.ts`; дополнить `mem-decay-wiring.test.ts`
- [ ] **S1** добавить в `mem-decay-wiring.test.ts`:
```ts
describe('read-side decay — Part 2 recall FTS', () => {
  const svc = readFileSync(join(process.cwd(), 'src/services/memory-service.ts'), 'utf8');
  it('флаг-гейт impTerm + MEM_HALFLIFE_DAYS', () => {
    expect(svc).toMatch(/isV2DecayEnabled\(/);
    expect(svc).toMatch(/MEM_HALFLIFE_DAYS/);
    expect(svc).toMatch(/power\(2,/); // затухание importance
  });
  it('off сохраняет прежний importance-литерал', () => { expect(svc).toMatch(/m\.importance::float \/ 10\.0/); });
});
```
- [ ] **S2** FAIL: `… && npx vitest run --project unit src/services/mem-decay-wiring.test.ts`
- [ ] **S3** impl: ОТКРОЙ `memory-service.ts` FTS-путь `getRelevantMemories` (≈:228-245). Найди в строке скоринга литерал `(m.importance::float / 10.0)`. Перед построением запроса добавь:
```ts
const MEM_HALFLIFE_DAYS = 90;
const impTerm = isV2DecayEnabled(userId)
  ? `(m.importance::float / 10.0) * power(2, - extract(epoch from (NOW() - m."createdAt")) / (86400.0 * ${MEM_HALFLIFE_DAYS}))`
  : `(m.importance::float / 10.0)`;
```
и подставь `${impTerm}` ВМЕСТО литерала `(m.importance::float / 10.0)` в строку скоринга. ВАЖНО: сверь, что скоринг строится как строка для `$queryRawUnsafe` (интерполяция). Если это tagged-template `$queryRaw` (параметризованный) — НЕ ломай параметризацию: тогда вынеси весь score-expr как строковый фрагмент так же, как сейчас (он уже строковый, раз содержит `exp(...)`). Импорт `isV2DecayEnabled` вверху. off → `impTerm` РОВНО прежний литерал → SQL байт-идентичен.
- [ ] **S4** целевой+ПОЛНЫЙ unit+tsc: `… && npx vitest run --project unit src/services/mem-decay-wiring.test.ts && npm test && npx tsc --noEmit`.
- [ ] **S5** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/memory-service.ts packages/server/src/services/mem-decay-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): recall FTS importance term decays with age behind flag (Part 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Integration tests
**Files:** Create `src/services/mem-decay.it.test.ts`
> Образец harness — `mem-graph.it.test.ts` (own PrismaClient, mkUser, restore флага). Part 1 — через `entityDecayScore` ре-ранг (или вызвать enrichment-функцию, если экспортирована); Part 2 — через `getRelevantMemories` сравнить порядок.
- [ ] **S1** `npm run test:db:up`, затем `mem-decay.it.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from './entity-graph/index.js';
import { entityDecayScore } from './memory-decay.js';

const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });
async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({ data: { email: `it-decay-${tag}@it.local`, name: 'IT', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe('read-side decay — Part 1 entity ранг', () => {
  it('Камила (старая разовая) тонет ниже мамы и свежих по entityDecayScore', async () => {
    const uid = await mkUser(`p1-${Date.now()}`);
    const g = getEntityGraph();
    const mama = await g.upsertEntity(uid, { type: 'person', name: 'Мама', importance: 9 });
    const kamila = await g.upsertEntity(uid, { type: 'person', name: 'Камила', importance: 5 });
    // сдвинуть lastSeenAt напрямую (upsert ставит now)
    await prisma.entity.update({ where: { id: mama.id }, data: { lastSeenAt: daysAgo(40) } });
    await prisma.entity.update({ where: { id: kamila.id }, data: { lastSeenAt: daysAgo(180) } });
    const rows = await prisma.entity.findMany({ where: { userId: uid }, select: { name: true, importance: true, lastSeenAt: true } });
    const now = new Date();
    const ranked = rows.map((e) => ({ name: e.name, s: entityDecayScore(e.importance, e.lastSeenAt, now) })).sort((a, b) => b.s - a.s);
    expect(ranked[0].name).toBe('Мама');
    expect(ranked.find((r) => r.name === 'Камила')!.s).toBeLessThan(ranked.find((r) => r.name === 'Мама')!.s);
  });
});

describe('read-side decay — Part 2 recall порядок', () => {
  it('свежий fact ранжируется не ниже старого при флаге on', async () => {
    process.env.FEATURE_V2_DECAY = 'all';
    const { getRelevantMemories } = await import('./memory-service.js');
    const { writeMemory } = await import('./episodic-memory.js');
    const uid = await mkUser(`p2-${Date.now()}`);
    const oldM = await writeMemory(uid, { type: 'fact', content: 'кофейня на Абая', importance: 5 });
    await prisma.memory.update({ where: { id: oldM.id }, data: { createdAt: daysAgo(180) } });
    await writeMemory(uid, { type: 'fact', content: 'кофейня новая открылась', importance: 5 });
    const res = await getRelevantMemories(uid, 'кофейня', 10);
    const idxNew = res.findIndex((r) => r.content.includes('новая'));
    const idxOld = res.findIndex((r) => r.content.includes('Абая'));
    expect(idxNew).toBeGreaterThanOrEqual(0);
    if (idxOld >= 0) expect(idxNew).toBeLessThanOrEqual(idxOld); // свежий не ниже старого
    delete process.env.FEATURE_V2_DECAY;
  });
});
```
Замечания: если `writeMemory`/`getRelevantMemories` сигнатуры иные — сверь и подгони. Если FORGET/прочие флаги влияют — выставь явно. Если Part 2 порядок зависит от ts_rank одинаково (оба матчат «кофейня») — разница только в impTerm×возраст, свежий должен быть ≥. Если не воспроизводится чисто — упрости (один и тот же importance, разный возраст), НЕ меняй прод-логику.
- [ ] **S2** run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm run test:db:up && npx vitest run --project integration src/services/mem-decay.it.test.ts` — зелёное. Красное → Phase-1 debug (тест/сетап).
- [ ] **S3** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/mem-decay.it.test.ts && git commit -m "$(cat <<'EOF'
test(memory): read-side decay it — entity rank + recall order

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full verify + independent review
- [ ] **S1** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm test && npx tsc --noEmit` — ~2680+ unit зелёных.
- [ ] **S2** `npm run test:it` целевые decay + соседние (leak-чек).
- [ ] **S3 OFF-проверка** — diff: обе врезки off-ветки — точные прежние литералы (`take:5`, `(m.importance::float / 10.0)`); 0 записей/удалений (read-only).
- [ ] **S4 независимое ревью** (code-reviewer opus). Фокус: off=байт-идентично обе врезки; READ-ONLY (никаких write/delete); важное-нечастое (мама @40д) НЕ исчезает; Part 2 не ломает relevance (ts_rank доминирует для матча); константы вменяемы; нет `any`/ESM/`vi.mock`.
- [ ] **S5** fix findings + commit (если есть).
- [ ] **S6 СТОП** — доложить Berik. Не пушить. Предложить push+deploy+`FEATURE_V2_DECAY=all` по слову.

---

## Self-Review
- **Покрытие спеки:** флаг (T1), хелперы (T2), Part 1 (T3), Part 2 (T4), it (T5), verify (T6). Все юниты покрыты.
- **Заглушки:** код полный; «сверь имя переменной/сигнатуру/Unsafe-путь» — явная сверка с реальностью (символы существующие), не выдуманные.
- **Типы:** `recencyFactor(days,halflife)→number`; `entityDecayScore(importance,lastSeenAt:Date|null,now:Date)→number`; `isV2DecayEnabled(userId)`.
- **off=identical:** обе врезки имеют off-ветку = прежний литерал (структурный тест проверяет `take:5` и `m.importance::float / 10.0`).

## Execution Handoff
Subagent-Driven. push/deploy/флаг — по слову Berik.
