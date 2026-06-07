# Person-Types (CRM мост #2) — План A (люди-сторона)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development или superpowers:executing-plans. Шаги — чекбоксы `- [ ]`.

**Goal:** Дать боту пометить человека (клиент/партнёр/инвестор/семья/друг) и проактивно напоминать про ЗАПУЩЕННЫХ важных людей — с кросс-доменом тип↔каденс↔**деньги** («клиент Ахмет 20 дн без контакта, должен тебе 200к»).

**Architecture:** Захват `set_person_type` пишет `Entity.attributes.personType` (Json-мерж, без миграции). Единый `personTypeWeight` + новый READ-ONLY детектор `detectNeglectedKeyPerson` (свой findMany по застоявшимся людям + owed-money обязательства) + enrichment-врезка. Зеркало shipped `relationship-link`. Off=байт-идентично (флаг + ранний return). План B (отдельно): усиления shipped relationship_link/birthday ×weight + календарь-бриф.

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict (no any), vitest (zero vi.mock). Baseline unit ~2616 + integration ~126 зелёные. Commit-per-step + trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. БЕЗ миграции (personType в Json attributes). Push/deploy/флаг — по слову Berik.

---

## File Structure
| Файл | Действие | Ответственность |
|---|---|---|
| `src/services/person-types/types.ts` | Create | Чистые: `personTypeWeight`, `pickNeglectedKeyPerson`, `describeNeglected` + типы. |
| `src/services/person-types/types.test.ts` | Create | Pure-юниты. |
| `src/services/person-types/impl.ts` | Create | `buildNeglectedKeyPerson` (READ-ONLY gather: застой + owed-money). |
| `src/services/person-types/index.ts` | Create | re-export. |
| `src/services/person-types/no-write-guard.test.ts` | Create | grep-гард: ни одного prisma write. |
| `src/services/person-types/person-types.it.test.ts` | Create | real prisma. |
| `src/lib/feature-flags.ts` | Modify | `isV2PersonTypesEnabled`. |
| `src/tools/set-person-type.ts` | Create | tool захвата. |
| `src/tools/set-person-type.it.test.ts` | Create | real prisma. |
| `src/tools/index.ts` | Modify | регистрация. |
| `src/services/v2-proactivity-engine.ts` | Modify | source `neglected_key_person`. |
| `src/services/v2-proactivity-engine.test.ts` | Modify | юнит pick + exhaustiveness. |
| `src/services/v2-enrichment.ts` | Modify | врезка `personTypes`. |
| `src/services/person-types-wiring.test.ts` | Create | структурный гард. |

---

## Task 1: Чистое ядро `person-types/types.ts`

**Files:** Create `src/services/person-types/types.ts`, `src/services/person-types/types.test.ts`

- [ ] **Step 1: Failing test** — `types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { personTypeWeight, pickNeglectedKeyPerson, describeNeglected, type TypedPerson } from './types.js';

describe('personTypeWeight', () => {
  it('бизнес-типы выше личных', () => {
    expect(personTypeWeight('client')).toBe(1.0);
    expect(personTypeWeight('investor')).toBe(0.95);
    expect(personTypeWeight('partner')).toBe(0.9);
    expect(personTypeWeight('family')).toBe(0.7);
    expect(personTypeWeight('friend')).toBe(0.55);
  });
  it('не задан/мусор → 0.6 (нейтрально)', () => {
    expect(personTypeWeight(undefined)).toBe(0.6);
    expect(personTypeWeight('xyz')).toBe(0.6);
  });
});

describe('pickNeglectedKeyPerson', () => {
  const base = (over: Partial<TypedPerson>): TypedPerson => ({ id: 'e1', name: 'X', importance: 5, daysSince: 14, ...over });
  it('типизированный человек выбран, weightedScore + owed в payload', () => {
    const p = base({ id: 'c1', name: 'Ахмет', type: 'client', importance: 6, daysSince: 21 });
    const r = pickNeglectedKeyPerson([p], { c1: 200000 });
    expect(r?.name).toBe('Ахмет');
    expect(r?.type).toBe('client');
    expect(r?.owed).toBe(200000);
    expect(r?.weightedScore).toBeGreaterThan(0);
  });
  it('берёт max weightedScore', () => {
    const friend = base({ id: 'f', name: 'Друг', type: 'friend', importance: 5, daysSince: 14 }); // 1*0.55*0.5=0.275
    const client = base({ id: 'c', name: 'Клиент', type: 'client', importance: 8, daysSince: 28 }); // 2*1*0.8=1.6
    expect(pickNeglectedKeyPerson([friend, client], {})?.name).toBe('Клиент');
  });
  it('не типизирован И importance<7 → не выбираем (не спамим про знакомых)', () => {
    expect(pickNeglectedKeyPerson([base({ type: undefined, importance: 6 })], {})).toBeNull();
  });
  it('не типизирован, но importance≥7 → выбираем', () => {
    expect(pickNeglectedKeyPerson([base({ type: undefined, importance: 7 })], {})).not.toBeNull();
  });
  it('пусто → null', () => {
    expect(pickNeglectedKeyPerson([], {})).toBeNull();
  });
});

describe('describeNeglected', () => {
  it('с owed — деньги в тексте', () => {
    const s = describeNeglected({ name: 'Ахмет', type: 'client', daysSince: 21, weightedScore: 1, owed: 200000 });
    expect(s).toContain('Ахмет');
    expect(s).toContain('200000');
  });
  it('без owed — без денег', () => {
    const s = describeNeglected({ name: 'Серик', type: 'partner', daysSince: 15, weightedScore: 1 });
    expect(s).toContain('Серик');
    expect(s).not.toContain('должен');
  });
});
```

- [ ] **Step 2: Run → fail.** `cd packages/server && npx vitest run src/services/person-types/types.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `types.ts`:

```typescript
export type PersonType = 'client' | 'partner' | 'investor' | 'family' | 'friend';

export interface TypedPerson {
  id: string;
  name: string;
  type?: PersonType;
  importance: number;
  daysSince: number;
}

export interface NeglectedKeyPerson {
  name: string;
  type?: PersonType;
  daysSince: number;
  weightedScore: number;
  owed?: number; // owed_to_me деньги по этому человеку (сумма), если есть
}

const WEIGHTS: Record<PersonType, number> = {
  client: 1.0,
  investor: 0.95,
  partner: 0.9,
  family: 0.7,
  friend: 0.55,
};

/** Единый источник веса типа. Не задан/неизвестен → 0.6 (нейтрально между business и личным). */
export function personTypeWeight(type?: string): number {
  return (type && WEIGHTS[type as PersonType]) || 0.6;
}

/**
 * Самый «запущенный» важный человек. weightedScore = (daysSince/14) × вес типа ×
 * (importance/10). ГЕЙТ честности: нудим только если человек типизирован ИЛИ
 * importance≥7 (не спамим про случайных знакомых). max по weightedScore. owed —
 * сумма owed_to_me денег по нему (если есть). Никого → null.
 */
export function pickNeglectedKeyPerson(
  persons: TypedPerson[],
  owedByEntity: Record<string, number>,
): NeglectedKeyPerson | null {
  let best: NeglectedKeyPerson | null = null;
  for (const p of persons) {
    if (!p.type && p.importance < 7) continue; // гейт
    const weightedScore = (p.daysSince / 14) * personTypeWeight(p.type) * (p.importance / 10);
    if (!best || weightedScore > best.weightedScore) {
      const owed = owedByEntity[p.id];
      best = { name: p.name, type: p.type, daysSince: p.daysSince, weightedScore, owed: owed || undefined };
    }
  }
  return best;
}

const TYPE_LABEL: Record<PersonType, string> = {
  client: 'клиент', investor: 'инвестор', partner: 'партнёр', family: 'семья', friend: 'друг',
};

/** Текст нуджа. Деньги-aware: с owed добавляет сумму долга тебе. */
export function describeNeglected(p: NeglectedKeyPerson): string {
  const label = p.type ? `[${TYPE_LABEL[p.type]}] ` : '';
  const head = `🤝 ${label}${p.name}: ${p.daysSince} дн без контакта`;
  if (p.owed && p.owed > 0) {
    return `${head}, должен тебе ${p.owed}₸. Напомнить?`;
  }
  return `${head}. Написать?`;
}
```

- [ ] **Step 4: Run → pass.** `npx vitest run src/services/person-types/types.test.ts` → PASS.

- [ ] **Step 5: tsc + commit.**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/services/person-types/types.ts packages/server/src/services/person-types/types.test.ts
git commit -F - <<'EOF'
feat(person-types): чистое ядро — personTypeWeight + pickNeglectedKeyPerson (T1)

Единый вес типа (клиент 1.0…друг 0.55, неизв 0.6). pick: weightedScore с гейтом
«типизирован ИЛИ importance≥7» (не спамим про знакомых). describeNeglected деньги-aware.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Флаг `isV2PersonTypesEnabled`

**Files:** Modify `src/lib/feature-flags.ts` (после `isV2RelationshipsEnabled`, ~:201)

- [ ] **Step 1: Failing test** — добавь в существующий `src/lib/feature-flags.test.ts` (или создай блок): сверь env-парс.

```typescript
import { isV2PersonTypesEnabled } from './feature-flags.js';
describe('isV2PersonTypesEnabled', () => {
  const KEY = 'FEATURE_V2_PERSON_TYPES';
  afterEach(() => { delete process.env[KEY]; });
  it('undefined → false', () => { expect(isV2PersonTypesEnabled('u1')).toBe(false); });
  it('all → true', () => { process.env[KEY] = 'all'; expect(isV2PersonTypesEnabled('u1')).toBe(true); });
  it('user-список', () => { process.env[KEY] = 'user-u1'; expect(isV2PersonTypesEnabled('u1')).toBe(true); expect(isV2PersonTypesEnabled('u2')).toBe(false); });
});
```

- [ ] **Step 2: Run → fail** (функции нет).

- [ ] **Step 3: Implement** — добавь в `feature-flags.ts` сразу после `isV2RelationshipsEnabled`:

```typescript
/**
 * Person-types / CRM-типы (мост #2). Same shape as isV2RelationshipsEnabled.
 */
export function isV2PersonTypesEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_PERSON_TYPES;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: tsc + commit.**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts
git commit -F - <<'EOF'
feat(person-types): флаг isV2PersonTypesEnabled (FEATURE_V2_PERSON_TYPES) (T2)

Копия isV2RelationshipsEnabled. off=байт-идентично.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Инструмент `set_person_type`

**Files:** Create `src/tools/set-person-type.ts`, `src/tools/set-person-type.it.test.ts`; Modify `src/tools/index.ts`

- [ ] **Step 1: Failing it-test** — `set-person-type.it.test.ts`:

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setPersonTypeTool } from './set-person-type.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function mkUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: 'PT', passwordHash: 'x' } });
  return u.id;
}
async function setType(userId: string, person: string, type: string) {
  return (await setPersonTypeTool.handler({ person, type } as never, { userId } as never)) as {
    message: string; entityId: string;
  };
}

describe('set_person_type — real prisma', () => {
  it('пишет personType в Entity.attributes', async () => {
    const u = await mkUser('pt-a@a.test');
    const r = await setType(u, 'Ахмет', 'client');
    const e = await prisma.entity.findUnique({ where: { id: r.entityId } });
    expect((e?.attributes as Record<string, unknown>).personType).toBe('client');
  });
  it('idempotent + НЕ затирает birthday (merge)', async () => {
    const u = await mkUser('pt-b@a.test');
    // сначала кладём birthday руками
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик', attributes: { birthday: { day: 5, month: 6 } } } });
    await setType(u, 'Серик', 'partner');
    const e = await prisma.entity.findFirst({ where: { userId: u, name: 'Серик' } });
    const attrs = e?.attributes as Record<string, unknown>;
    expect(attrs.personType).toBe('partner');
    expect(attrs.birthday).toBeTruthy(); // не затёрли
  });
  it('cross-user изоляция', async () => {
    const a = await mkUser('pt-iso-a@a.test');
    const b = await mkUser('pt-iso-b@a.test');
    await setType(a, 'Бекзат', 'investor');
    expect(await prisma.entity.findFirst({ where: { userId: b, name: 'Бекзат' } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail.** `npx vitest run --project integration src/tools/set-person-type.it.test.ts`.

- [ ] **Step 3: Implement** — `set-person-type.ts` (клон set_birthday):

```typescript
import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';

/**
 * CRM-тип человека — agent-callable. Пишет Entity.attributes.personType
 * (upsertEntity МЕРЖИТ attributes — не затирает birthday/прочее). Reversible/
 * idempotent на каноничном имени → needsConfirm:false. Money-safety: ноль денег.
 */
export const setPersonTypeTool = defineTool({
  name: 'set_person_type',
  description:
    'Пометить тип человека для CRM: клиент / партнёр / инвестор / семья / друг. ' +
    'Вызывай когда юзер называет роль («Ахмет — мой клиент», «Серик мой партнёр по бизнесу»).',
  category: 'memory',
  aliases: { name: 'person', personName: 'person', role: 'type' },
  schema: z.object({
    person: z.string().min(1).max(120).describe('Имя человека, напр. «Ахмет»'),
    type: z
      .enum(['client', 'partner', 'investor', 'family', 'friend'])
      .describe('Тип: client|partner|investor|family|friend (рус. клиент/партнёр/инвестор/семья/друг тоже)'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['Ахмет — мой клиент', 'Серик мой партнёр', 'мама — это семья'],
  handler: async (input, ctx) => {
    const entity = await getEntityGraph().upsertEntity(ctx.userId, {
      type: 'person',
      name: input.person,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JsonValue (как set_birthday)
      attributes: { personType: input.type } as any,
      importance: 5,
    });
    const labels: Record<string, string> = { client: 'клиент', partner: 'партнёр', investor: 'инвестор', family: 'семья', friend: 'друг' };
    return {
      message: `Запомнил: ${input.person} — ${labels[input.type]}.`,
      entityId: entity.id,
    };
  },
});
```

- [ ] **Step 4: Register** — `tools/index.ts`: импорт `import { setPersonTypeTool } from './set-person-type.js';` (рядом с setBirthdayTool ~:47) + `setPersonTypeTool,` в `ALL_TOOLS` (рядом с setBirthdayTool).

- [ ] **Step 5: Run → pass.** Note: рус-алиасы типов («клиент»→client) обрабатываются нормализатором аргументов на уровне runRegistryTool; в схеме enum английский, LLM мапит. Если нужно — добавить рус-значения в нормализатор (отдельно), но v1 полагается на LLM-маппинг (описание в .describe()).

- [ ] **Step 6: tsc + commit.**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/tools/set-person-type.ts packages/server/src/tools/set-person-type.it.test.ts packages/server/src/tools/index.ts
git commit -F - <<'EOF'
feat(person-types): set_person_type — захват типа в Entity.attributes (T3)

Клон set_birthday: upsertEntity мерж attributes.personType (не затирает birthday),
needsConfirm:false, ноль денег. it: пишет/мерж/cross-user. Зарегистрирован.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Gather `person-types/impl.ts` (тип↔каденс↔деньги)

**Files:** Create `src/services/person-types/impl.ts`, `src/services/person-types/index.ts`, `src/services/person-types/no-write-guard.test.ts`, `src/services/person-types/person-types.it.test.ts`

- [ ] **Step 1: Failing it-test** — `person-types.it.test.ts`:

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildNeglectedKeyPerson } from './impl.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const DAY = 86_400_000;
const STALE_AT = new Date(Date.now() - 40 * DAY);

async function mkUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: 'PT', passwordHash: 'x' } });
  return u.id;
}
function mkPerson(userId: string, name: string, attrs: object, importance = 6) {
  return prisma.entity.create({ data: { userId, type: 'person', name, importance, lastSeenAt: STALE_AT, attributes: attrs as never } });
}

describe('buildNeglectedKeyPerson — real prisma', () => {
  it('типизированный застоявшийся клиент → нудж', async () => {
    const u = await mkUser('nk-a@a.test');
    await mkPerson(u, 'Ахмет', { personType: 'client' });
    const r = await buildNeglectedKeyPerson(u);
    expect(r?.name).toBe('Ахмет');
    expect(r?.type).toBe('client');
  });
  it('+ owed_to_me money obligation → сумма в payload', async () => {
    const u = await mkUser('nk-b@a.test');
    const e = await mkPerson(u, 'Серик', { personType: 'client' });
    await prisma.obligation.create({ data: { userId: u, personEntityId: e.id, personName: 'Серик', direction: 'owed_to_me', kind: 'money', amount: 200000, description: 'оплата', status: 'open', source: 'manual' } });
    const r = await buildNeglectedKeyPerson(u);
    expect(r?.owed).toBe(200000);
  });
  it('нет типизированных и importance<7 → null', async () => {
    const u = await mkUser('nk-c@a.test');
    await mkPerson(u, 'Знакомый', {}, 6); // без типа, imp 6
    expect(await buildNeglectedKeyPerson(u)).toBeNull();
  });
  it('cross-user изоляция', async () => {
    const a = await mkUser('nk-iso-a@a.test');
    const b = await mkUser('nk-iso-b@a.test');
    await mkPerson(a, 'Бекзат', { personType: 'investor' });
    expect(await buildNeglectedKeyPerson(b)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — `impl.ts` (READ-ONLY; свой findMany т.к. нужен attributes.personType):

```typescript
import { prisma } from '../../lib/prisma.js';
import {
  pickNeglectedKeyPerson,
  describeNeglected,
  type TypedPerson,
  type PersonType,
  type NeglectedKeyPerson,
} from './types.js';

const DAY_MS = 86_400_000;
const STALE_DAYS = 14;
const MIN_IMPORTANCE = 5;

export interface NeglectedNudge extends NeglectedKeyPerson {
  insightText: string;
  typeWeightImportance: number; // importance выбранного — для значимости
}

/**
 * Кросс-доменный инсайт: важный ЗАПУЩЕННЫЙ человек (по типу/важности) ×
 * owed_to_me деньги по нему. READ-ONLY. null если некого. Свой findMany
 * (нужен attributes.personType, которого нет в staleEntities-проекции).
 */
export async function buildNeglectedKeyPerson(
  userId: string,
  now: Date = new Date(),
): Promise<NeglectedNudge | null> {
  try {
    const staleAt = new Date(now.getTime() - STALE_DAYS * DAY_MS);
    const rows = await prisma.entity.findMany({
      where: { userId, type: 'person', importance: { gte: MIN_IMPORTANCE }, lastSeenAt: { lt: staleAt } },
      select: { id: true, name: true, importance: true, lastSeenAt: true, attributes: true },
      orderBy: { importance: 'desc' },
    });
    if (rows.length === 0) return null;

    const persons: TypedPerson[] = rows.map((r) => {
      const attrs = (r.attributes ?? {}) as Record<string, unknown>;
      const pt = attrs.personType;
      return {
        id: r.id,
        name: r.name,
        type: typeof pt === 'string' ? (pt as PersonType) : undefined,
        importance: r.importance,
        daysSince: Math.max(1, Math.floor((now.getTime() - r.lastSeenAt.getTime()) / DAY_MS)),
      };
    });

    const ids = persons.map((p) => p.id);
    const owed = await prisma.obligation.findMany({
      where: { userId, status: 'open', kind: 'money', direction: 'owed_to_me', personEntityId: { in: ids } },
      select: { personEntityId: true, amount: true },
    });
    const owedByEntity: Record<string, number> = {};
    for (const o of owed) {
      if (o.personEntityId && o.amount) owedByEntity[o.personEntityId] = (owedByEntity[o.personEntityId] ?? 0) + o.amount;
    }

    const picked = pickNeglectedKeyPerson(persons, owedByEntity);
    if (!picked) return null;
    const importance = persons.find((p) => p.name === picked.name)?.importance ?? MIN_IMPORTANCE;
    return { ...picked, insightText: describeNeglected(picked), typeWeightImportance: importance };
  } catch (err) {
    console.warn('[person-types] buildNeglectedKeyPerson failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 4: index.ts:**

```typescript
export { buildNeglectedKeyPerson, type NeglectedNudge } from './impl.js';
export { personTypeWeight, pickNeglectedKeyPerson, describeNeglected, type PersonType, type TypedPerson, type NeglectedKeyPerson } from './types.js';
```

- [ ] **Step 5: no-write-guard.test.ts** (копия relationship-link guard, путь `src/services/person-types`):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('person-types read-only guard', () => {
  const dir = join(process.cwd(), 'src/services/person-types');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'));
  it('ни одного prisma write в services/person-types', () => {
    for (const f of files) {
      const s = readFileSync(join(dir, f), 'utf-8');
      expect(s, `${f} must not write`).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/);
      expect(s, `${f} must not use raw SQL / $transaction`).not.toMatch(/prisma\.\$(executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe|transaction)\b/);
    }
  });
});
```

- [ ] **Step 6: Run → pass** (it + guard). `npx vitest run --project integration src/services/person-types/person-types.it.test.ts` + `npx vitest run src/services/person-types/no-write-guard.test.ts`.

- [ ] **Step 7: tsc + commit.**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/services/person-types/impl.ts packages/server/src/services/person-types/index.ts packages/server/src/services/person-types/no-write-guard.test.ts packages/server/src/services/person-types/person-types.it.test.ts
git commit -F - <<'EOF'
feat(person-types): buildNeglectedKeyPerson — тип↔каденс↔деньги (T4)

READ-ONLY: застоявшиеся важные люди (свой findMany с attributes.personType) ×
owed_to_me money обязательства → NeglectedNudge с суммой. no-write guard + it
(typed stale→nudge; +owed money→сумма; гейт; cross-user).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Детектор `detectNeglectedKeyPerson` в движке

**Files:** Modify `src/services/v2-proactivity-engine.ts`, `src/services/v2-proactivity-engine.test.ts`

- [ ] **Step 1: Failing unit** — в `v2-proactivity-engine.test.ts`: добавь `'neglected_key_person'` в exhaustiveness-массив (рядом с `'monthly_goal_stall'`); ничего больше (pure pick тестируется в T1, exhaustiveness ловит союз/score/TEMPLATES).

```typescript
//  в массив сорт-exhaustiveness:
        'neglected_key_person',
```

- [ ] **Step 2: Run → fail** (массив не совпадёт с TEMPLATES-ключами, т.к. source ещё нет).

- [ ] **Step 3a: union** — `v2-proactivity-engine.ts:36` область, после `| 'monthly_goal_stall'`:

```typescript
  | 'monthly_goal_stall'
  | 'neglected_key_person';
```

- [ ] **Step 3b: scoreSignificance case** — после `case 'monthly_goal_stall'`:

```typescript
    case 'neglected_key_person': {
      const ws = Number(c.payload.weightedScore ?? 0);
      const owed = Number(c.payload.owed ?? 0);
      return Math.min(0.9, Math.min(0.85, ws) + (owed > 0 ? 0.1 : 0));
    }
```

- [ ] **Step 3c: TEMPLATES** — после `monthly_goal_stall` блока:

```typescript
  neglected_key_person: {
    curious: 'Кстати, {{insightText}}',
    gentle: '{{insightText}}',
  },
```

- [ ] **Step 3d: detector + register** — после `detectMonthlyGoalStall` (или рядом с detectRelationshipLink), новый детектор:

```typescript
// Person-types: важный ЗАПУЩЕННЫЙ человек × тип × owed-money (READ-ONLY).
async function detectNeglectedKeyPerson(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2PersonTypesEnabled } = await import('../lib/feature-flags.js');
    if (!isV2PersonTypesEnabled(userId)) return [];
    const { buildNeglectedKeyPerson } = await import('./person-types/index.js');
    const n = await buildNeglectedKeyPerson(userId);
    if (!n) return [];
    const business = n.type === 'client' || n.type === 'partner' || n.type === 'investor';
    const cand: NudgeCandidate = {
      source: 'neglected_key_person',
      significance: 0,
      payload: {
        insightText: n.insightText,
        weightedScore: n.weightedScore,
        owed: n.owed ?? 0,
        name: n.name,
      },
      toneHint: business ? 'curious' : 'gentle',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectNeglectedKeyPerson failed:', err);
    return [];
  }
}
```
И в `detectCandidates` Promise.allSettled — `detectNeglectedKeyPerson(userId),` после `detectMonthlyGoalStall(userId),`.

- [ ] **Step 4: Run → pass.** `npx vitest run src/services/v2-proactivity-engine.test.ts`.

- [ ] **Step 5: tsc + commit.**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -F - <<'EOF'
feat(person-types): detectNeglectedKeyPerson — проактив про запущенных важных людей (T5)

source neglected_key_person + score (деньги +0.1, cap 0.9) + TEMPLATES + детектор
(ранний флаг-return, тон business→curious). Зарегистрирован. exhaustiveness.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Enrichment-врезка `personTypes`

**Files:** Modify `src/services/v2-enrichment.ts`

- [ ] **Step 1: формат-функция** — рядом с `formatRelationshipSection` (~:189):

```typescript
/** Person-types (CRM мост #2) — pure render. Empty → ''. Exported для теста. */
export function formatPersonTypesSection(insightText: string | null): string {
  if (!insightText) return '';
  return `Ключевые люди (CRM): ${insightText}`;
}
```

- [ ] **Step 2: импорт + флаг** — в шапке: `import { isV2PersonTypesEnabled } from '../lib/feature-flags.js';` (рядом с isV2RelationshipsEnabled) + `import { buildNeglectedKeyPerson } from './person-types/index.js';`.

- [ ] **Step 3: тип поля** — в интерфейс данных (рядом с `relationship: string | null;` :82): `personTypes: string | null;`.

- [ ] **Step 4: fetch** — в `Promise.all([...])` (рядом с relationship fetch ~:372) добавь элемент:

```typescript
      isV2PersonTypesEnabled(userId)
        ? withTimeout(buildNeglectedKeyPerson(userId), CROSS_DOMAIN_BUDGET_MS, null)
            .then((n) => n?.insightText ?? null)
            .catch(() => null)
        : Promise.resolve(null),
```

- [ ] **Step 5: destructure + return** — добавь `personTypes` в деструктуризацию `const [...] = await Promise.all(...)` (в ТОЙ ЖЕ позиции, что и fetch-элемент) и в возвращаемый объект (рядом с `relationship,` :451): `personTypes,`.

- [ ] **Step 6: рендер** — в `buildV2EnrichmentBlock` рядом с `const rel = formatRelationshipSection(...)` (:142):

```typescript
  const pt = formatPersonTypesSection(data.personTypes ?? null);
  if (pt) lines.push(pt);
```

- [ ] **Step 7: tsc** (ловит рассинхрон destructure↔Promise.all): `npx tsc --noEmit` → чисто.

- [ ] **Step 8: commit.**

```bash
git add packages/server/src/services/v2-enrichment.ts
git commit -F - <<'EOF'
feat(person-types): enrichment-врезка «ключевые люди (CRM)» (T6)

Флаг-гейтнутый fetch buildNeglectedKeyPerson → personTypes в промпт. Мозг отвечает
«кому из клиентов написать / кто должен денег». off → null (секции нет).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Структурный гард + полный verify + независимое ревью

**Files:** Create `src/services/person-types-wiring.test.ts`

- [ ] **Step 1: Structural test:**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = readFileSync(join(__dirname, 'v2-proactivity-engine.ts'), 'utf8');
const TOOLS = readFileSync(join(__dirname, '../tools/index.ts'), 'utf8');
const ENRICH = readFileSync(join(__dirname, 'v2-enrichment.ts'), 'utf8');
const FLAGS = readFileSync(join(__dirname, '../lib/feature-flags.ts'), 'utf8');

describe('person-types wiring (гард)', () => {
  it('neglected_key_person в union/score/TEMPLATES/detectCandidates', () => {
    expect(ENGINE).toContain("| 'neglected_key_person'");
    expect(ENGINE).toContain("case 'neglected_key_person':");
    expect(ENGINE).toContain('neglected_key_person: {');
    expect(ENGINE).toContain('detectNeglectedKeyPerson(userId),');
  });
  it('детектор флаг-гейтнут (off=identical)', () => {
    expect(ENGINE).toContain('if (!isV2PersonTypesEnabled(userId)) return [];');
  });
  it('set_person_type зарегистрирован', () => {
    expect(TOOLS).toContain('setPersonTypeTool');
  });
  it('врезка personTypes за флагом', () => {
    expect(ENRICH).toContain('isV2PersonTypesEnabled(userId)');
    expect(ENRICH).toContain('formatPersonTypesSection');
  });
  it('флаг существует', () => {
    expect(FLAGS).toContain('export function isV2PersonTypesEnabled');
  });
});
```

- [ ] **Step 2: Run → pass.**

- [ ] **Step 3: Полный verify.** `npx tsc --noEmit && npx vitest run` (unit ~2625+ зелёные) + `npx vitest run --project integration` (~133 зелёные, +7 новых it).

- [ ] **Step 4: commit.**

```bash
git add packages/server/src/services/person-types-wiring.test.ts
git commit -F - <<'EOF'
test(person-types): структурный гард wiring + полный verify зелёный (T7)

neglected_key_person в union/score/TEMPLATES/detectCandidates; флаг-гейт; set_person_type;
врезка. tsc + полная сюита зелёные.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Независимое ревью** (`pr-review-toolkit:code-reviewer`) на дифф. Фокус:
  - **off=байт-идентично:** при `!isV2PersonTypesEnabled` детектор пуст, врезка null → ноль изменений в промпте/нуджах. set_person_type — единственная запись.
  - **READ-ONLY services/person-types:** no-write guard; buildNeglectedKeyPerson только findMany.
  - **attributes-мерж:** set_person_type не затирает birthday (upsertEntity мерж) — it доказывает.
  - **деньги-aware реальный:** owed читает owed_to_me+money+open по FK, сумма в тексте — живой кросс-домен тип↔деньги.
  - **гейт не спамит:** pickNeglectedKeyPerson требует тип ИЛИ importance≥7; gate3=0.6 отсекает слабые (но они во врезке).
  - **exhaustiveness:** scoreSignificance/ TEMPLATES покрывают neglected_key_person (tsc + тест).
  - Если 0 блокеров — доклад Berik + предложить деплой (push/деплой по слову; БЕЗ миграции). + анонс **Плана B** (усиления shipped relationship_link/birthday ×weight + календарь-бриф detectPersonMeeting на внутреннем CalendarEvent + нашем tz).

---

## Self-Review (выполнено при написании)
**Spec coverage:** захват set_person_type (T3 ✓), personTypeWeight (T1 ✓), detectNeglectedKeyPerson тип↔каденс↔деньги (T1+T4+T5 ✓), врезка (T6 ✓), флаг+off-safe (T2 + ранний return ✓), READ-ONLY+guard (T4 ✓), тесты pure+it+структурный (✓). **Отложено в План B (явно):** усиления shipped relationship_link/birthday ×weight (#2/#4 спеки), календарь-бриф (#5). **Placeholder scan:** полный код в шагах; рус-алиасы типов — note в T3 (LLM-маппинг через .describe(), не placeholder). **Type consistency:** `personTypeWeight`/`pickNeglectedKeyPerson`/`describeNeglected`/`buildNeglectedKeyPerson`/`NeglectedNudge` едины T1↔T4↔T5; payload-ключи `{insightText,weightedScore,owed,name}` совпадают детектор↔score↔TEMPLATES; `formatPersonTypesSection`/`personTypes` едины T6.
