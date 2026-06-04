# Relationships / CRM-link (кросс-домен мост #3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline)
> или subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Вычисленный кросс-доменный инсайт «не общались с {человек} уже {N} дн, а
ты ему должен: «{дело}»» — связь застоявшегося контакта с реальным открытым
обязательством по нему.

**Architecture:** Чистые хелперы (выбор+рендер) + `buildRelationshipNudge`
(gather: реюз `staleEntities` + открытые обязательства по `personEntityId` FK) →
enrichment (по запросу) + проактивный детектор. За флагом, READ-ONLY,
off=байт-идентично. Зеркало Energy-Link/Runway.

**Tech Stack:** Prisma 6, Postgres, vitest 2.1.9, тест-БД харнес.

**Rollout:** коммит на шаг (trailer `Co-Authored-By: Claude Opus 4.8 (1M context)`).
Push/deploy/флаг — ТОЛЬКО по слову Berik. Флаг сначала `user-<Berik>`, потом all.
Все пути относительно `packages/server/`.

**Pinned (из explore + spec):**
- `getEntityGraph()` из `'../entity-graph/index.js'`; `staleEntities(userId,
  sinceDays, minImportance): Promise<Entity[]>` где `Entity { id, name, type,
  importance, lastSeenAt: Date }`. Вызов `staleEntities(userId, 14, 5)` → фильтр
  `type==='person'`. Отсортированы по importance desc.
- Открытые обязательства: `prisma.obligation.findMany({ where:{ userId,
  status:'open', personEntityId:{ in: staleIds } }, select:{ personEntityId:true,
  direction:true, description:true } })`. `prisma` из `'../../lib/prisma.js'`.
- `DAY_MS = 86_400_000`.
- Флаг — копия `isV2EnergyEnabled`. Enrichment — паттерн energy-link-ветки.
  Детектор — паттерн `detectEnergyLink` (ранний флаг-return, dynamic import).
- Триггер — контактная пауза + наличие обязательства. НЕ дублирует
  `detectStaleEntity` (frequency-паттерн) и `detectObligationDue` (срок).

---

### Task 1: Флаг `isV2RelationshipsEnabled`

**Files:** Modify `src/lib/feature-flags.ts`, `src/lib/feature-flags.test.ts`

- [ ] **Step 1: Добавить флаг** (после `isV2EnergyEnabled`)

```ts
/**
 * Relationships / CRM-link (кросс-домен #3). Same shape as isV2AxesEnabled.
 */
export function isV2RelationshipsEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_RELATIONSHIPS;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 2: Юнит-тест** — в `src/lib/feature-flags.test.ts` добавить
`isV2RelationshipsEnabled,` в import-список и в конец файла:

```ts
describe('isV2RelationshipsEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_RELATIONSHIPS;
  });
  it('unset → false', () => {
    expect(isV2RelationshipsEnabled('u1')).toBe(false);
  });
  it('all → true', () => {
    process.env.FEATURE_V2_RELATIONSHIPS = 'all';
    expect(isV2RelationshipsEnabled('u1')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_RELATIONSHIPS = 'user-u1';
    expect(isV2RelationshipsEnabled('u1')).toBe(true);
    expect(isV2RelationshipsEnabled('u2')).toBe(false);
  });
});
```

- [ ] **Step 3: Run + tsc.** `npm test -- feature-flags 2>&1 | tail -4` → PASS;
`npx tsc --noEmit` → 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/feature-flags.ts src/lib/feature-flags.test.ts
git commit -m "feat(relationship-link): isV2RelationshipsEnabled flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Чистые хелперы (выбор + рендер, TDD)

**Files:** Create `src/services/relationship-link/types.ts`,
`src/services/relationship-link/types.test.ts`

- [ ] **Step 1: Падающий тест** `src/services/relationship-link/types.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  pickRelationshipLink,
  describeRelationshipLink,
  type StalePerson,
  type OpenObligation,
} from './types.js';

const serik: StalePerson = { id: 'e1', name: 'Серик', daysSince: 16, importance: 7 };
const ahmet: StalePerson = { id: 'e2', name: 'Ахмет', daysSince: 20, importance: 6 };

describe('relationship-link/types', () => {
  it('pickRelationshipLink: первый человек с обязательством', () => {
    const obls: Record<string, OpenObligation[]> = {
      e2: [{ direction: 'i_owe', description: 'отчёт' }],
    };
    // serik без обязательства, ahmet с обязательством → ahmet
    const link = pickRelationshipLink([serik, ahmet], obls);
    expect(link).toEqual({
      personName: 'Ахмет',
      daysSince: 20,
      direction: 'i_owe',
      description: 'отчёт',
    });
  });

  it('pickRelationshipLink: предпочитает раннего в списке (importance desc)', () => {
    const obls: Record<string, OpenObligation[]> = {
      e1: [{ direction: 'owed_to_me', description: 'деньги' }],
      e2: [{ direction: 'i_owe', description: 'отчёт' }],
    };
    const link = pickRelationshipLink([serik, ahmet], obls);
    expect(link?.personName).toBe('Серик');
  });

  it('pickRelationshipLink: никто без обязательства → null', () => {
    expect(pickRelationshipLink([serik, ahmet], {})).toBeNull();
  });

  it('describeRelationshipLink: i_owe', () => {
    const s = describeRelationshipLink({
      personName: 'Серик', daysSince: 16, direction: 'i_owe', description: 'отчёт',
    });
    expect(s).toContain('Серик');
    expect(s).toContain('16');
    expect(s).toContain('ты ему должен');
    expect(s).toContain('отчёт');
  });

  it('describeRelationshipLink: owed_to_me', () => {
    const s = describeRelationshipLink({
      personName: 'Ахмет', daysSince: 20, direction: 'owed_to_me', description: 'деньги',
    });
    expect(s).toContain('он тебе должен');
    expect(s).toContain('деньги');
  });
});
```

- [ ] **Step 2: Run — упасть.** `npm test -- relationship-link/types 2>&1 | tail -4`
→ FAIL (module not found).

- [ ] **Step 3: Реализация** `src/services/relationship-link/types.ts`

```ts
export type ObligationDirection = 'i_owe' | 'owed_to_me';

export interface StalePerson {
  id: string;
  name: string;
  daysSince: number;
  importance: number;
}

export interface OpenObligation {
  direction: ObligationDirection;
  description: string;
}

export interface RelationshipLink {
  personName: string;
  daysSince: number;
  direction: ObligationDirection;
  description: string;
}

/**
 * Первый застоявшийся человек (persons отсортированы по importance desc),
 * у которого есть ≥1 открытое обязательство. Берём первое обязательство.
 * Никто не имеет обязательства → null.
 */
export function pickRelationshipLink(
  persons: StalePerson[],
  obligationsByEntity: Record<string, OpenObligation[]>,
): RelationshipLink | null {
  for (const p of persons) {
    const obls = obligationsByEntity[p.id];
    if (obls && obls.length > 0) {
      const o = obls[0];
      return {
        personName: p.name,
        daysSince: p.daysSince,
        direction: o.direction,
        description: o.description,
      };
    }
  }
  return null;
}

/** Человеческая строка под направление обязательства. */
export function describeRelationshipLink(link: RelationshipLink): string {
  const head = `🤝 Не общались с ${link.personName} уже ${link.daysSince} дн`;
  if (link.direction === 'i_owe') {
    return `${head}, а ты ему должен: «${link.description}». Написать?`;
  }
  return `${head}, а он тебе должен: «${link.description}». Напомнить?`;
}
```

- [ ] **Step 4: Run — зелёный.** `npm test -- relationship-link/types 2>&1 | tail -4`
→ PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/services/relationship-link/types.ts src/services/relationship-link/types.test.ts
git commit -m "feat(relationship-link): pure helpers (pickRelationshipLink/describe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `buildRelationshipNudge` (gather + compute) + index

**Files:** Create `src/services/relationship-link/relationship-link.ts`,
`src/services/relationship-link/index.ts`

- [ ] **Step 1: Реализация** `src/services/relationship-link/relationship-link.ts`

```ts
import { prisma } from '../../lib/prisma.js';
import { getEntityGraph } from '../entity-graph/index.js';
import {
  pickRelationshipLink,
  describeRelationshipLink,
  type StalePerson,
  type OpenObligation,
  type ObligationDirection,
} from './types.js';

const DAY_MS = 86_400_000;
const STALE_DAYS = 14;
const MIN_IMPORTANCE = 5;

export interface RelationshipNudge {
  personName: string;
  daysSince: number;
  direction: ObligationDirection;
  description: string;
  importance: number;
  insightText: string;
}

/**
 * Кросс-доменный инсайт: застоявшийся человек × открытое обязательство по нему
 * (через personEntityId FK). READ-ONLY. null если нет такой связки (молчим —
 * чистую staleness ведёт detectStaleEntity).
 */
export async function buildRelationshipNudge(
  userId: string,
  now: Date = new Date(),
): Promise<RelationshipNudge | null> {
  try {
    const graph = getEntityGraph();
    const stale = await graph.staleEntities(userId, STALE_DAYS, MIN_IMPORTANCE);
    const persons: StalePerson[] = stale
      .filter((e) => e.type === 'person')
      .map((e) => ({
        id: e.id,
        name: e.name,
        importance: e.importance,
        daysSince: Math.max(
          1,
          Math.floor((now.getTime() - e.lastSeenAt.getTime()) / DAY_MS),
        ),
      }));
    if (persons.length === 0) return null;

    const staleIds = persons.map((p) => p.id);
    const obls = await prisma.obligation.findMany({
      where: { userId, status: 'open', personEntityId: { in: staleIds } },
      select: { personEntityId: true, direction: true, description: true },
    });

    const obligationsByEntity: Record<string, OpenObligation[]> = {};
    for (const o of obls) {
      if (!o.personEntityId) continue;
      (obligationsByEntity[o.personEntityId] ??= []).push({
        direction: o.direction as ObligationDirection,
        description: o.description,
      });
    }

    const link = pickRelationshipLink(persons, obligationsByEntity);
    if (!link) return null;
    const insightText = describeRelationshipLink(link);
    const importance =
      persons.find((p) => p.name === link.personName)?.importance ?? MIN_IMPORTANCE;

    return {
      personName: link.personName,
      daysSince: link.daysSince,
      direction: link.direction,
      description: link.description,
      importance,
      insightText,
    };
  } catch (err) {
    console.warn(
      '[relationship-link] buildRelationshipNudge failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
```

- [ ] **Step 2: Re-export** `src/services/relationship-link/index.ts`

```ts
export * from './types.js';
export * from './relationship-link.js';
```

- [ ] **Step 3: tsc.** `npx tsc --noEmit` → 0. (Если поля `Entity` не сошлись —
досверить: `grep -n "interface Entity" -A10 src/services/entity-graph/types.ts`.)

- [ ] **Step 4: Commit**

```bash
git add src/services/relationship-link/relationship-link.ts src/services/relationship-link/index.ts
git commit -m "feat(relationship-link): buildRelationshipNudge gather (stale person x obligation FK)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Поведенческий тест через тест-БД харнес

**Files:** Create `src/services/relationship-link/relationship-link.it.test.ts`

- [ ] **Step 1: Тест** (реальная БД)

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildRelationshipNudge } from './relationship-link.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

const NOW = new Date(2026, 5, 15);
const DAY = 86_400_000;

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'RL', passwordHash: 'x' } });
  return u.id;
}

async function seedPerson(userId: string, name: string, daysAgo: number): Promise<string> {
  const e = await prisma.entity.create({
    data: {
      userId,
      type: 'person',
      name,
      importance: 6,
      lastSeenAt: new Date(NOW.getTime() - daysAgo * DAY),
    },
  });
  return e.id;
}

describe('relationship-link buildRelationshipNudge — реальная БД', () => {
  it('застоявшийся человек + открытое обязательство → инсайт', async () => {
    const userId = await seedUser('rl-a@a.test');
    const entityId = await seedPerson(userId, 'Серик', 20);
    await prisma.obligation.create({
      data: {
        userId,
        personEntityId: entityId,
        personName: 'Серик',
        direction: 'i_owe',
        kind: 'action',
        description: 'отчёт',
        status: 'open',
        source: 'manual',
      },
    });
    const rn = await buildRelationshipNudge(userId, NOW);
    expect(rn).not.toBeNull();
    expect(rn!.personName).toBe('Серик');
    expect(rn!.direction).toBe('i_owe');
    expect(rn!.description).toBe('отчёт');
    expect(rn!.insightText).toContain('Серик');
    expect(rn!.insightText).toContain('отчёт');
  });

  it('застоявшийся человек БЕЗ обязательства → null', async () => {
    const userId = await seedUser('rl-noobl@a.test');
    await seedPerson(userId, 'Айгуль', 20);
    expect(await buildRelationshipNudge(userId, NOW)).toBeNull();
  });

  it('cross-user: данные A не текут к B', async () => {
    const a = await seedUser('rl-iso-a@a.test');
    const b = await seedUser('rl-iso-b@a.test');
    const entityId = await seedPerson(a, 'Бекзат', 20);
    await prisma.obligation.create({
      data: {
        userId: a, personEntityId: entityId, personName: 'Бекзат', direction: 'i_owe',
        kind: 'action', description: 'долг', status: 'open', source: 'manual',
      },
    });
    expect(await buildRelationshipNudge(b, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать через харнес.** Run: `npm run test:db:up && npm run test:it 2>&1 | grep -E "relationship-link|Tests "` → PASS (+ baseline integration зелёный). Если поля Entity/Obligation иначе — свериться: `grep -A14 "model Entity " prisma/schema.prisma` и `grep -A14 "model Obligation" prisma/schema.prisma`.

- [ ] **Step 3: Commit**

```bash
git add src/services/relationship-link/relationship-link.it.test.ts
git commit -m "test(relationship-link): behavioral buildRelationshipNudge + cross-user isolation (real DB)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Enrichment — человек+дело в контекст мозга

**Files:** Modify `src/services/v2-enrichment.ts`, Create
`src/services/relationship-link-enrichment.test.ts`

- [ ] **Step 1: Импорты** — добавить `isV2RelationshipsEnabled` в список из
`'../lib/feature-flags.js'` и новый импорт:

```ts
import { buildRelationshipNudge } from './relationship-link/index.js';
```

- [ ] **Step 2: Поле в типе** `V2EnrichmentData` — рядом с `energyLink`:

```ts
  /** Relationships (кросс-домен #3): вычисленный инсайт или null. */
  relationship: string | null;
```

- [ ] **Step 3: Форматтер** (рядом с `formatEnergyLinkSection`):

```ts
/**
 * Relationships (кросс-домен #3) — pure render. Empty → ''. Exported для теста.
 */
export function formatRelationshipSection(insightText: string | null): string {
  if (!insightText) return '';
  return `Отношения (вычислено): ${insightText}`;
}
```

- [ ] **Step 4: Fetch в `fetchV2EnrichmentData`** — в Promise.all (после
energy-link-ветки):

```ts
      isV2RelationshipsEnabled(userId)
        ? buildRelationshipNudge(userId)
            .then((r) => r?.insightText ?? null)
            .catch(() => null)
        : Promise.resolve(null),
```
И в деструктуризацию результата добавить переменную `relationship` (последней), и в
возвращаемый объект добавить `relationship,`.

- [ ] **Step 5: Рендер в `buildV2EnrichmentBlock`** — после energy-link-секции:

```ts
  const rel = formatRelationshipSection(data.relationship ?? null);
  if (rel) lines.push(rel);
```

- [ ] **Step 6: Структурный тест** `src/services/relationship-link-enrichment.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatRelationshipSection, buildV2EnrichmentBlock } from './v2-enrichment.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');

describe('relationship-link enrichment врезка', () => {
  it('флаг-гейт + buildRelationshipNudge + рендер', () => {
    expect(src).toContain('isV2RelationshipsEnabled');
    expect(src).toContain('buildRelationshipNudge');
    expect(src).toContain('formatRelationshipSection');
  });
  it('formatRelationshipSection: null → пусто; текст → строка', () => {
    expect(formatRelationshipSection(null)).toBe('');
    expect(formatRelationshipSection('не общались с X')).toContain('Отношения');
  });
  it('buildV2EnrichmentBlock включает relationship когда есть; off → нет', () => {
    const base = {
      identity: null,
      patterns: [],
      moodShift: null,
      entities: [],
      obligations: [],
      goalImpact: null,
      runway: null,
      energyLink: null,
    };
    expect(buildV2EnrichmentBlock({ ...base, relationship: 'не общались с X' })).toContain('Отношения');
    expect(buildV2EnrichmentBlock({ ...base, relationship: null })).not.toContain('Отношения');
  });
});
```

- [ ] **Step 7: Run + tsc.** `npm test -- relationship-link-enrichment v2-enrichment 2>&1 | tail -6` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 8: Commit**

```bash
git add src/services/v2-enrichment.ts src/services/relationship-link-enrichment.test.ts
git commit -m "feat(relationship-link): enrich brain context with stale-contact x obligation (flag-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Проактивный детектор `detectRelationshipLink`

**Files:** Modify `src/services/v2-proactivity-engine.ts`, Create
`src/services/v2-proactivity-relationship.test.ts`

- [ ] **Step 1: Добавить `'relationship_link'` в union `NudgeSource`** (после
`'energy_link'`)

```ts
  | 'relationship_link';
```

- [ ] **Step 2: Case в `scoreSignificance`** (после `energy_link`)

```ts
    case 'relationship_link': {
      const days = Number(c.payload.daysSince ?? 0);
      const imp = Number(c.payload.importance ?? 5);
      return Math.max(0, Math.min(0.85, (days / 30) * (imp / 10)));
    }
```

- [ ] **Step 3: Блок в `TEMPLATES`** (после `energy_link`)

```ts
  relationship_link: {
    gentle: 'Не общался с {{name}} уже {{days}} дн, а по нему висит: «{{description}}». Напишешь?',
    curious: 'Кстати, {{name}} — {{days}} дн тишины, а у вас открыто «{{description}}». Решим?',
    supportive: '{{name}} давно без вестей ({{days}} дн), и есть «{{description}}». Хочешь — помогу составить сообщение.',
  },
```

- [ ] **Step 4: Детектор** (рядом с `detectEnergyLink`, ранний флаг-return)

```ts
async function detectRelationshipLink(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2RelationshipsEnabled } = await import('../lib/feature-flags.js');
    if (!isV2RelationshipsEnabled(userId)) return [];
    const { buildRelationshipNudge } = await import('./relationship-link/index.js');
    const rn = await buildRelationshipNudge(userId);
    if (!rn) return [];
    const cand: NudgeCandidate = {
      source: 'relationship_link',
      significance: 0,
      payload: {
        name: rn.personName,
        description: rn.description,
        days: String(rn.daysSince),
        daysSince: String(rn.daysSince),
        importance: String(rn.importance),
      },
      toneHint: 'gentle',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectRelationshipLink failed:', err);
    return [];
  }
}
```

- [ ] **Step 5: Зарегистрировать** в `V2ProactivityEngine.detectCandidates`
`Promise.allSettled([...])` — добавить `detectRelationshipLink(userId),`.

- [ ] **Step 6: Обновить doc-коммент** числа детекторов: `(11 detectors)` →
`(12 detectors)` в шапке файла.

- [ ] **Step 7: Обновить exhaustiveness-тест** в
`src/services/v2-proactivity-engine.test.ts` — в массив `covers all known sources`
добавить `'relationship_link',` (sorted: после `'obligation_due'`).

- [ ] **Step 8: Структурный тест** `src/services/v2-proactivity-relationship.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSignificance, TEMPLATES } from './v2-proactivity-engine.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');

describe('relationship_link detector wiring', () => {
  it('источник + шаблон + детектор + ранний флаг-гейт + регистрация', () => {
    expect(src).toContain("'relationship_link'");
    expect(src).toContain('relationship_link:');
    expect(src).toContain('async function detectRelationshipLink');
    expect(src).toMatch(
      /async function detectRelationshipLink[\s\S]*?isV2RelationshipsEnabled\(userId\)\)\s*return \[\]/,
    );
    expect(src).toMatch(/detectCandidates[\s\S]*?detectRelationshipLink\(userId\)/);
  });
  it('TEMPLATES.relationship_link имеет тон-варианты', () => {
    expect(TEMPLATES.relationship_link?.gentle).toContain('{{name}}');
  });
  it('scoreSignificance: растёт с daysSince×importance, капается на 0.85', () => {
    const mk = (daysSince: string, importance: string) =>
      scoreSignificance({
        source: 'relationship_link',
        significance: 0,
        payload: { daysSince, importance, name: 'X', description: 'y', days: daysSince },
        toneHint: 'gentle',
      });
    expect(mk('15', '10')).toBeCloseTo(0.5, 5); // (15/30)*(10/10)=0.5
    expect(mk('60', '10')).toBe(0.85); // капается
    expect(mk('0', '10')).toBe(0);
  });
});
```

- [ ] **Step 9: Run + tsc.** `npm test -- v2-proactivity-relationship v2-proactivity-engine 2>&1 | tail -6` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 10: Commit**

```bash
git add src/services/v2-proactivity-engine.ts src/services/v2-proactivity-relationship.test.ts src/services/v2-proactivity-engine.test.ts
git commit -m "feat(relationship-link): detectRelationshipLink proactivity detector (flag-gated) + templates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: No-write guard + полная верификация + ревью

**Files:** Create `src/services/relationship-link/no-write-guard.test.ts`

- [ ] **Step 1: Структурный read-only guard**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('relationship-link read-only guard', () => {
  const dir = join(process.cwd(), 'src/services/relationship-link');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'));
  it('ни одного prisma write в services/relationship-link', () => {
    for (const f of files) {
      const s = readFileSync(join(dir, f), 'utf-8');
      expect(s, `${f} must not write`).not.toMatch(
        /prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/,
      );
      expect(s, `${f} must not use raw SQL / $transaction`).not.toMatch(
        /prisma\.\$(executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe|transaction)\b/,
      );
    }
  });
});
```

- [ ] **Step 2: Запустить guard + tsc + оба прогона.**
Run: `npm test -- relationship-link/no-write-guard 2>&1 | tail -4` → PASS.
Run: `npx tsc --noEmit` → 0.
Run: `npm test 2>&1 | tail -3` → unit PASS (новые + старые).
Run: `npm run test:db:up && npm run test:it 2>&1 | tail -3` → integration PASS.

- [ ] **Step 3: Negative control** — временно убрать `if
(!isV2RelationshipsEnabled(userId)) return [];` из `detectRelationshipLink` →
структурный тест Task 6 (`relationship_link detector wiring`) КРАСНЕЕТ → откатить.

- [ ] **Step 4: Независимое ревью** — `pr-review-toolkit:code-reviewer` по диффу
relationship-link: фокус (a) READ-ONLY (ноль write в services/relationship-link),
(b) cross-user изоляция (staleEntities по userId + obligation.findMany where userId),
(c) флаг-гейтинг детектора+enrichment (off=identical), (d) нет деления на ноль /
краёв (пустой persons → null до запроса), (e) корректность реюза `staleEntities` +
FK-обязательств и что НЕ дублирует `detectStaleEntity`/`detectObligationDue`
(разные триггеры).

- [ ] **Step 5: Commit guard**

```bash
git add src/services/relationship-link/no-write-guard.test.ts
git commit -m "test(relationship-link): read-only guard + full verify

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review
- **Spec coverage:** флаг (T1), чистые pick+describe (T2), gather buildRelationship
  Nudge + staleEntities + FK-обязательства (T3), поведенческий харнес (T4),
  enrichment (T5), детектор relationship_link (T6), read-only guard+verify (T7).
  Все секции спеки.
- **Placeholder scan:** код в каждом шаге; «свериться grep'ом» (поля Entity/
  Obligation) — локаторы интеграции, не плейсхолдеры.
- **Type consistency:** `StalePerson`/`OpenObligation`/`RelationshipLink`/
  `ObligationDirection`/`RelationshipNudge` едины; `pickRelationshipLink(persons,
  obligationsByEntity)→RelationshipLink|null`; `describeRelationshipLink(link)→
  string`; `buildRelationshipNudge(userId, now?)→RelationshipNudge|null` (поля
  `insightText`/`personName`/`daysSince`/`importance`); детектор читает
  `rn.personName`/`rn.description`/`rn.daysSince`/`rn.importance`.
- **Money/read-only:** T7 guard запрещает любой prisma write + raw SQL в
  relationship-link.
- **Открытый риск:** точные поля доменного `Entity` (`type`/`lastSeenAt`) —
  досверяются в T3 Step 3 grep'ом (интеграционная точка).

## Verification gate (вся фича)
1. `npm run test:db:up` healthy; `npm run test:it` — relationship-link integration +
   baseline зелёные.
2. `npm test` unit зелёный; `npx tsc --noEmit` 0.
3. Negative control: убрать флаг-гейт детектора → красный → откат.
4. Флаг OFF → enrichment-поле null (секция отсутствует), детектор пуст →
   байт-идентично.
5. Read-only guard: ноль prisma write/raw SQL в services/relationship-link.
