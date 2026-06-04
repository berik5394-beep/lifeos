# Energy↔Result (кросс-домен мост #2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline)
> или subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Вычисленный бакет-контраст «в дни сна ≥7ч ты в среднем закрываешь 78%
дел, при <7ч — 52%» + проактивное предупреждение при недавнем недосыпе.

**Architecture:** Чистые хелперы (бакет-контраст) + `buildEnergyLink` (gather:
журнал-сон + дневной %-задач за 60 дней → пары → бакеты) → enrichment (число по
запросу) + проактивный детектор. За флагом, READ-ONLY, off=байт-идентично. Зеркало
Runway/Goal-Impact.

**Tech Stack:** Prisma 6, Postgres, vitest 2.1.9, тест-БД харнес.

**Rollout:** коммит на шаг (trailer `Co-Authored-By: Claude Opus 4.8 (1M context)`).
Push/deploy/флаг — ТОЛЬКО по слову Berik. Флаг сначала `user-<Berik>`, потом all.
Все пути относительно `packages/server/`.

**Pinned (из explore + spec):**
- `JournalEntry { date @db.Date, sleepHours Float? }`; `Task { date @db.Date,
  completed Boolean }`. `prisma` из `'../../lib/prisma.js'`.
- `windowStart = new Date(now.getTime() - 60 * 86_400_000)`.
- dateKey из Date: `d.toISOString().slice(0, 10)` (db.Date = UTC-полночь, стабильно).
- Флаг — копия `isV2RunwayEnabled`. Enrichment — паттерн runway-ветки. Детектор —
  паттерн `detectRunwayLow` (ранний флаг-return, dynamic import).
- v1 драйвер = только `sleepHours` (energy/mood НЕ используем). Порог 7ч.

---

### Task 1: Флаг `isV2EnergyEnabled`

**Files:** Modify `src/lib/feature-flags.ts`, `src/lib/feature-flags.test.ts`

- [ ] **Step 1: Добавить флаг** (после `isV2RunwayEnabled`)

```ts
/**
 * Energy↔Result (кросс-домен #2). Same shape as isV2AxesEnabled.
 */
export function isV2EnergyEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_ENERGY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 2: Юнит-тест** — в `src/lib/feature-flags.test.ts` добавить
`isV2EnergyEnabled,` в import-список и в конец файла:

```ts
describe('isV2EnergyEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_ENERGY;
  });
  it('unset → false', () => {
    expect(isV2EnergyEnabled('u1')).toBe(false);
  });
  it('all → true', () => {
    process.env.FEATURE_V2_ENERGY = 'all';
    expect(isV2EnergyEnabled('u1')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_ENERGY = 'user-u1';
    expect(isV2EnergyEnabled('u1')).toBe(true);
    expect(isV2EnergyEnabled('u2')).toBe(false);
  });
});
```

- [ ] **Step 3: Run + tsc.** `npm test -- feature-flags 2>&1 | tail -4` → PASS;
`npx tsc --noEmit` → 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/feature-flags.ts src/lib/feature-flags.test.ts
git commit -m "feat(energy-link): isV2EnergyEnabled flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Чистые хелперы (бакет-контраст, TDD)

**Files:** Create `src/services/energy-link/types.ts`,
`src/services/energy-link/types.test.ts`

- [ ] **Step 1: Падающий тест** `src/services/energy-link/types.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { pairDays, bucketContrast, describeEnergyLink } from './types.js';

describe('energy-link/types', () => {
  it('pairDays: пара только для общих дат', () => {
    const journal = { '2026-06-01': 8, '2026-06-02': 5, '2026-06-03': 7 };
    const completion = { '2026-06-01': 90, '2026-06-02': 40 };
    const pairs = pairDays(journal, completion);
    expect(pairs).toEqual([
      { sleepHours: 8, completionPct: 90 },
      { sleepHours: 5, completionPct: 40 },
    ]);
  });

  it('bucketContrast: link при достаточных данных и разрыве ≥15', () => {
    const pairs = [
      { sleepHours: 8, completionPct: 80 },
      { sleepHours: 7.5, completionPct: 76 },
      { sleepHours: 7, completionPct: 78 },
      { sleepHours: 9, completionPct: 82 },
      { sleepHours: 5, completionPct: 50 },
      { sleepHours: 6, completionPct: 54 },
      { sleepHours: 4, completionPct: 48 },
      { sleepHours: 6.5, completionPct: 52 },
    ];
    const c = bucketContrast(pairs);
    expect(c.status).toBe('link');
    expect(c.goodN).toBe(4);
    expect(c.poorN).toBe(4);
    expect(c.goodAvg).toBe(79); // round((80+76+78+82)/4)=79
    expect(c.poorAvg).toBe(51); // round((50+54+48+52)/4)=51
    expect(c.gapPct).toBe(28);
  });

  it('bucketContrast: insufficient при <4 в бакете', () => {
    const pairs = [
      { sleepHours: 8, completionPct: 80 },
      { sleepHours: 5, completionPct: 40 },
    ];
    const c = bucketContrast(pairs);
    expect(c.status).toBe('insufficient');
    expect(c.goodAvg).toBeNull();
    expect(c.gapPct).toBeNull();
  });

  it('bucketContrast: weak при разрыве <15', () => {
    const pairs = [
      { sleepHours: 8, completionPct: 70 },
      { sleepHours: 7, completionPct: 72 },
      { sleepHours: 7.5, completionPct: 68 },
      { sleepHours: 9, completionPct: 74 },
      { sleepHours: 5, completionPct: 65 },
      { sleepHours: 6, completionPct: 63 },
      { sleepHours: 4, completionPct: 67 },
      { sleepHours: 6.5, completionPct: 61 },
    ];
    expect(bucketContrast(pairs).status).toBe('weak');
  });

  it('describeEnergyLink: строка только для link+gap>0', () => {
    const link = bucketContrast([
      { sleepHours: 8, completionPct: 80 },
      { sleepHours: 7.5, completionPct: 76 },
      { sleepHours: 7, completionPct: 78 },
      { sleepHours: 9, completionPct: 82 },
      { sleepHours: 5, completionPct: 50 },
      { sleepHours: 6, completionPct: 54 },
      { sleepHours: 4, completionPct: 48 },
      { sleepHours: 6.5, completionPct: 52 },
    ]);
    const s = describeEnergyLink(link);
    expect(s).toContain('79%');
    expect(s).toContain('51%');
    expect(s).toContain('≥7ч');
  });

  it('describeEnergyLink: null для insufficient и для gap<0 (парадокс)', () => {
    const insuf = bucketContrast([{ sleepHours: 8, completionPct: 80 }]);
    expect(describeEnergyLink(insuf)).toBeNull();
    // парадокс: мало сна — выше %
    const paradox = bucketContrast([
      { sleepHours: 8, completionPct: 50 },
      { sleepHours: 7.5, completionPct: 52 },
      { sleepHours: 7, completionPct: 48 },
      { sleepHours: 9, completionPct: 50 },
      { sleepHours: 5, completionPct: 80 },
      { sleepHours: 6, completionPct: 78 },
      { sleepHours: 4, completionPct: 82 },
      { sleepHours: 6.5, completionPct: 80 },
    ]);
    expect(paradox.status).toBe('link');
    expect(paradox.gapPct).toBeLessThan(0);
    expect(describeEnergyLink(paradox)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — упасть.** `npm test -- energy-link/types 2>&1 | tail -4` →
FAIL (module not found).

- [ ] **Step 3: Реализация** `src/services/energy-link/types.ts`

```ts
export interface SleepDay {
  sleepHours: number;
  completionPct: number; // 0..100
}

export type ContrastStatus = 'insufficient' | 'weak' | 'link';

export interface Contrast {
  status: ContrastStatus;
  goodN: number;
  poorN: number;
  goodAvg: number | null; // средний % в дни сна ≥ порога
  poorAvg: number | null; // средний % в дни сна < порога
  gapPct: number | null; // goodAvg − poorAvg
}

const SLEEP_THRESHOLD_H = 7;
const MIN_PER_BUCKET = 4;
const MIN_GAP_PCT = 15;

/** Пара (сон, %выполнения) только для дат, присутствующих в ОБОИХ источниках. */
export function pairDays(
  journalByDate: Record<string, number>, // dateKey → sleepHours
  completionByDate: Record<string, number>, // dateKey → % (0..100)
): SleepDay[] {
  const out: SleepDay[] = [];
  for (const [k, sleepHours] of Object.entries(journalByDate)) {
    const completionPct = completionByDate[k];
    if (completionPct === undefined) continue;
    out.push({ sleepHours, completionPct });
  }
  return out;
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/** Контраст среднего %выполнения между «хороший сон» и «мало сна». */
export function bucketContrast(
  pairs: SleepDay[],
  thresholdH = SLEEP_THRESHOLD_H,
  minPerBucket = MIN_PER_BUCKET,
  minGapPct = MIN_GAP_PCT,
): Contrast {
  const good = pairs.filter((p) => p.sleepHours >= thresholdH);
  const poor = pairs.filter((p) => p.sleepHours < thresholdH);
  const goodN = good.length;
  const poorN = poor.length;
  if (goodN < minPerBucket || poorN < minPerBucket) {
    return { status: 'insufficient', goodN, poorN, goodAvg: null, poorAvg: null, gapPct: null };
  }
  const goodAvg = Math.round(avg(good.map((p) => p.completionPct)));
  const poorAvg = Math.round(avg(poor.map((p) => p.completionPct)));
  const gapPct = goodAvg - poorAvg;
  const status: ContrastStatus = Math.abs(gapPct) >= minGapPct ? 'link' : 'weak';
  return { status, goodN, poorN, goodAvg, poorAvg, gapPct };
}

/** Строка только для подтверждённой связи (link) с положительным разрывом. */
export function describeEnergyLink(c: Contrast): string | null {
  if (c.status !== 'link' || c.gapPct == null || c.gapPct <= 0) return null;
  return (
    `🛌 В дни сна ≥7ч ты в среднем закрываешь ${c.goodAvg}% дел, при <7ч — ` +
    `${c.poorAvg}%. Сон правда двигает твою продуктивность.`
  );
}
```

- [ ] **Step 4: Run — зелёный.** `npm test -- energy-link/types 2>&1 | tail -4` →
PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/services/energy-link/types.ts src/services/energy-link/types.test.ts
git commit -m "feat(energy-link): pure bucket-contrast helpers (pairDays/bucketContrast/describe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `buildEnergyLink` (gather + compute) + index

**Files:** Create `src/services/energy-link/energy-link.ts`,
`src/services/energy-link/index.ts`

- [ ] **Step 1: Реализация** `src/services/energy-link/energy-link.ts`

```ts
import { prisma } from '../../lib/prisma.js';
import {
  pairDays,
  bucketContrast,
  describeEnergyLink,
  type ContrastStatus,
} from './types.js';

const WINDOW_MS = 60 * 86_400_000;
const RECENT_MS = 7 * 86_400_000;
const SLEEP_THRESHOLD_H = 7;

export interface EnergyLink {
  goodAvg: number | null;
  poorAvg: number | null;
  gapPct: number | null;
  goodN: number;
  poorN: number;
  status: ContrastStatus;
  recentSleepLow: boolean; // последние ~7 дней журнала сон в среднем < 7ч
  insightText: string;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Кросс-доменный инсайт «сон ↔ выполнение» бакет-контрастом. READ-ONLY.
 * null если связь не подтверждена (insufficient/weak) или парадокс (gap<0).
 */
export async function buildEnergyLink(
  userId: string,
  now: Date = new Date(),
): Promise<EnergyLink | null> {
  try {
    const windowStart = new Date(now.getTime() - WINDOW_MS);
    const recentStart = new Date(now.getTime() - RECENT_MS);

    const [journalRows, taskRows] = await Promise.all([
      prisma.journalEntry.findMany({
        where: { userId, date: { gte: windowStart }, sleepHours: { not: null } },
        select: { date: true, sleepHours: true },
      }),
      prisma.task.findMany({
        where: { userId, date: { gte: windowStart } },
        select: { date: true, completed: true },
      }),
    ]);

    const journalByDate: Record<string, number> = {};
    const recentSleeps: number[] = [];
    for (const r of journalRows) {
      if (r.sleepHours == null) continue;
      journalByDate[dateKey(r.date)] = r.sleepHours;
      if (r.date >= recentStart) recentSleeps.push(r.sleepHours);
    }

    const agg: Record<string, { total: number; done: number }> = {};
    for (const t of taskRows) {
      const k = dateKey(t.date);
      if (!agg[k]) agg[k] = { total: 0, done: 0 };
      agg[k].total++;
      if (t.completed) agg[k].done++;
    }
    const completionByDate: Record<string, number> = {};
    for (const [k, a] of Object.entries(agg)) {
      completionByDate[k] = Math.round((a.done / a.total) * 100);
    }

    const c = bucketContrast(pairDays(journalByDate, completionByDate));
    if (c.status !== 'link') return null;
    const insightText = describeEnergyLink(c);
    if (!insightText) return null;

    const recentSleepLow =
      recentSleeps.length > 0 &&
      recentSleeps.reduce((s, n) => s + n, 0) / recentSleeps.length < SLEEP_THRESHOLD_H;

    return {
      goodAvg: c.goodAvg,
      poorAvg: c.poorAvg,
      gapPct: c.gapPct,
      goodN: c.goodN,
      poorN: c.poorN,
      status: c.status,
      recentSleepLow,
      insightText,
    };
  } catch (err) {
    console.warn(
      '[energy-link] buildEnergyLink failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
```

- [ ] **Step 2: Re-export** `src/services/energy-link/index.ts`

```ts
export * from './types.js';
export * from './energy-link.js';
```

- [ ] **Step 3: tsc.** `npx tsc --noEmit` → 0.

- [ ] **Step 4: Commit**

```bash
git add src/services/energy-link/energy-link.ts src/services/energy-link/index.ts
git commit -m "feat(energy-link): buildEnergyLink gather+compute (journal sleep × task completion)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Поведенческий тест через тест-БД харнес

**Files:** Create `src/services/energy-link/energy-link.it.test.ts`

- [ ] **Step 1: Тест** (реальная БД, 60-дневное окно с явным контрастом)

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildEnergyLink } from './energy-link.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'EL', passwordHash: 'x' } });
  return u.id;
}

const NOW = new Date(2026, 5, 15);
function daysAgo(n: number): Date {
  const d = new Date(NOW.getTime() - n * 86_400_000);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

describe('energy-link buildEnergyLink — реальная БД', () => {
  it('явный контраст: хороший сон → высокий %, мало сна → низкий → link', async () => {
    const userId = await seedUser('el-a@a.test');
    // 4 дня хорошего сна (8ч) с 2/2 задач выполнено (100%).
    for (const n of [10, 12, 14, 16]) {
      const date = daysAgo(n);
      await prisma.journalEntry.create({ data: { userId, date, sleepHours: 8 } });
      await prisma.task.create({ data: { userId, date, title: 'a', category: 'work', priority: 'low', completed: true } });
      await prisma.task.create({ data: { userId, date, title: 'b', category: 'work', priority: 'low', completed: true } });
    }
    // 4 дня малого сна (5ч) с 0/2 выполнено (0%).
    for (const n of [11, 13, 15, 17]) {
      const date = daysAgo(n);
      await prisma.journalEntry.create({ data: { userId, date, sleepHours: 5 } });
      await prisma.task.create({ data: { userId, date, title: 'a', category: 'work', priority: 'low', completed: false } });
      await prisma.task.create({ data: { userId, date, title: 'b', category: 'work', priority: 'low', completed: false } });
    }
    const el = await buildEnergyLink(userId, NOW);
    expect(el).not.toBeNull();
    expect(el!.status).toBe('link');
    expect(el!.goodAvg).toBe(100);
    expect(el!.poorAvg).toBe(0);
    expect(el!.gapPct).toBe(100);
    expect(el!.insightText).toContain('продуктивность');
  });

  it('мало данных → null', async () => {
    const userId = await seedUser('el-few@a.test');
    const date = daysAgo(5);
    await prisma.journalEntry.create({ data: { userId, date, sleepHours: 8 } });
    await prisma.task.create({ data: { userId, date, title: 'a', category: 'work', priority: 'low', completed: true } });
    expect(await buildEnergyLink(userId, NOW)).toBeNull();
  });

  it('cross-user: данные A не текут к B', async () => {
    const a = await seedUser('el-iso-a@a.test');
    const b = await seedUser('el-iso-b@a.test');
    const date = daysAgo(5);
    await prisma.journalEntry.create({ data: { userId: a, date, sleepHours: 8 } });
    await prisma.task.create({ data: { userId: a, date, title: 'a', category: 'work', priority: 'low', completed: true } });
    expect(await buildEnergyLink(b, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать через харнес.** Run: `npm run test:db:up && npm run test:it 2>&1 | grep -E "energy-link|Tests "` → PASS (+ baseline integration зелёный). Если поля Task/JournalEntry иначе — свериться: `grep -A12 "model Task " prisma/schema.prisma`.

- [ ] **Step 3: Commit**

```bash
git add src/services/energy-link/energy-link.it.test.ts
git commit -m "test(energy-link): behavioral buildEnergyLink + cross-user isolation (real DB)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Enrichment — число в контекст мозга

**Files:** Modify `src/services/v2-enrichment.ts`, Create
`src/services/energy-link-enrichment.test.ts`

- [ ] **Step 1: Импорты** — добавить `isV2EnergyEnabled` в список из
`'../lib/feature-flags.js'` и новый импорт:

```ts
import { buildEnergyLink } from './energy-link/index.js';
```

- [ ] **Step 2: Поле в типе** `V2EnrichmentData` — рядом с `runway`:

```ts
  /** Energy↔Result (кросс-домен #2): вычисленный инсайт или null. */
  energyLink: string | null;
```

- [ ] **Step 3: Форматтер** (рядом с `formatRunwaySection`):

```ts
/**
 * Energy↔Result — pure render. Empty → ''. Exported для юнит-теста.
 */
export function formatEnergyLinkSection(insightText: string | null): string {
  if (!insightText) return '';
  return `Сон и продуктивность (вычислено): ${insightText}`;
}
```

- [ ] **Step 4: Fetch в `fetchV2EnrichmentData`** — в Promise.all (после
runway-ветки):

```ts
      isV2EnergyEnabled(userId)
        ? buildEnergyLink(userId)
            .then((el) => el?.insightText ?? null)
            .catch(() => null)
        : Promise.resolve(null),
```
И в деструктуризацию результата добавить переменную `energyLink` (последней), и в
возвращаемый объект добавить `energyLink,`.

- [ ] **Step 5: Рендер в `buildV2EnrichmentBlock`** — после runway-секции:

```ts
  const el = formatEnergyLinkSection(data.energyLink ?? null);
  if (el) lines.push(el);
```

- [ ] **Step 6: Структурный тест** `src/services/energy-link-enrichment.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatEnergyLinkSection, buildV2EnrichmentBlock } from './v2-enrichment.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');

describe('energy-link enrichment врезка', () => {
  it('флаг-гейт + buildEnergyLink + рендер', () => {
    expect(src).toContain('isV2EnergyEnabled');
    expect(src).toContain('buildEnergyLink');
    expect(src).toContain('formatEnergyLinkSection');
  });
  it('formatEnergyLinkSection: null → пусто; текст → строка', () => {
    expect(formatEnergyLinkSection(null)).toBe('');
    expect(formatEnergyLinkSection('сон двигает')).toContain('Сон и продуктивность');
  });
  it('buildV2EnrichmentBlock включает energyLink когда он есть; off → нет', () => {
    const base = {
      identity: null,
      patterns: [],
      moodShift: null,
      entities: [],
      obligations: [],
      goalImpact: null,
      runway: null,
    };
    expect(buildV2EnrichmentBlock({ ...base, energyLink: 'сон двигает' })).toContain('Сон и продуктивность');
    expect(buildV2EnrichmentBlock({ ...base, energyLink: null })).not.toContain('Сон и продуктивность');
  });
});
```

- [ ] **Step 7: Run + tsc.** `npm test -- energy-link-enrichment v2-enrichment 2>&1 | tail -6` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 8: Commit**

```bash
git add src/services/v2-enrichment.ts src/services/energy-link-enrichment.test.ts
git commit -m "feat(energy-link): enrich brain context with sleep↔completion link (flag-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Проактивный детектор `detectEnergyLink`

**Files:** Modify `src/services/v2-proactivity-engine.ts`, Create
`src/services/v2-proactivity-energy.test.ts`

- [ ] **Step 1: Добавить `'energy_link'` в union `NudgeSource`** (после `'runway_low'`)

```ts
  | 'energy_link';
```

- [ ] **Step 2: Case в `scoreSignificance`** (после `runway_low`)

```ts
    case 'energy_link': {
      const gap = Math.abs(Number(c.payload.gap ?? 0));
      return Math.max(0, Math.min(0.85, gap / 50));
    }
```

- [ ] **Step 3: Блок в `TEMPLATES`** (после `runway_low`)

```ts
  energy_link: {
    gentle: 'Ты продуктивнее при сне ≥7ч ({{goodAvg}}% против {{poorAvg}}%). На этой неделе спишь меньше — выспись?',
    curious: 'Заметил: при сне ≥7ч у тебя {{goodAvg}}% дел, при <7ч — {{poorAvg}}%. Недосып бьёт по делам.',
    supportive: 'Похоже, недосып тянет продуктивность ({{goodAvg}}% vs {{poorAvg}}%). Дай себе отдохнуть.',
  },
```

- [ ] **Step 4: Детектор** (рядом с `detectRunwayLow`, ранний флаг-return)

```ts
async function detectEnergyLink(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2EnergyEnabled } = await import('../lib/feature-flags.js');
    if (!isV2EnergyEnabled(userId)) return [];
    const { buildEnergyLink } = await import('./energy-link/index.js');
    const el = await buildEnergyLink(userId);
    if (!el) return [];
    if (el.status !== 'link' || !el.recentSleepLow) return [];
    const cand: NudgeCandidate = {
      source: 'energy_link',
      significance: 0,
      payload: {
        goodAvg: String(el.goodAvg ?? ''),
        poorAvg: String(el.poorAvg ?? ''),
        gap: String(el.gapPct ?? 0),
      },
      toneHint: 'gentle',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectEnergyLink failed:', err);
    return [];
  }
}
```

- [ ] **Step 5: Зарегистрировать** в `V2ProactivityEngine.detectCandidates`
`Promise.allSettled([...])` — добавить `detectEnergyLink(userId),`.

- [ ] **Step 6: Обновить doc-коммент** числа детекторов: `(10 detectors)` →
`(11 detectors)` в шапке файла.

- [ ] **Step 7: Обновить exhaustiveness-тест** в
`src/services/v2-proactivity-engine.test.ts` — в массив `covers all known sources`
добавить `'energy_link',` (sorted: рядом с `'commitment_due'`).

- [ ] **Step 8: Структурный тест** `src/services/v2-proactivity-energy.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSignificance, TEMPLATES } from './v2-proactivity-engine.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');

describe('energy_link detector wiring', () => {
  it('источник + шаблон + детектор + ранний флаг-гейт + регистрация', () => {
    expect(src).toContain("'energy_link'");
    expect(src).toContain('energy_link:');
    expect(src).toContain('async function detectEnergyLink');
    expect(src).toMatch(
      /async function detectEnergyLink[\s\S]*?isV2EnergyEnabled\(userId\)\)\s*return \[\]/,
    );
    expect(src).toMatch(/detectCandidates[\s\S]*?detectEnergyLink\(userId\)/);
  });
  it('TEMPLATES.energy_link имеет тон-варианты', () => {
    expect(TEMPLATES.energy_link?.gentle).toContain('{{goodAvg}}');
  });
  it('scoreSignificance: растёт с gap, капается на 0.85', () => {
    const mk = (gap: string) =>
      scoreSignificance({
        source: 'energy_link',
        significance: 0,
        payload: { gap, goodAvg: '80', poorAvg: '50' },
        toneHint: 'gentle',
      });
    expect(mk('25')).toBeCloseTo(0.5, 5);
    expect(mk('100')).toBe(0.85); // капается
    expect(mk('0')).toBe(0);
  });
});
```

- [ ] **Step 9: Run + tsc.** `npm test -- v2-proactivity-energy v2-proactivity-engine 2>&1 | tail -6` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 10: Commit**

```bash
git add src/services/v2-proactivity-engine.ts src/services/v2-proactivity-energy.test.ts src/services/v2-proactivity-engine.test.ts
git commit -m "feat(energy-link): detectEnergyLink proactivity detector (flag-gated) + templates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: No-write guard + полная верификация + ревью

**Files:** Create `src/services/energy-link/no-write-guard.test.ts`

- [ ] **Step 1: Структурный read-only guard**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('energy-link read-only guard', () => {
  const dir = join(process.cwd(), 'src/services/energy-link');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'));
  it('ни одного prisma write в services/energy-link', () => {
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
Run: `npm test -- energy-link/no-write-guard 2>&1 | tail -4` → PASS.
Run: `npx tsc --noEmit` → 0.
Run: `npm test 2>&1 | tail -3` → unit PASS (новые + старые).
Run: `npm run test:db:up && npm run test:it 2>&1 | tail -3` → integration PASS.

- [ ] **Step 3: Negative control** — временно убрать `if (!isV2EnergyEnabled(userId))
return [];` из `detectEnergyLink` → структурный тест Task 6 (`energy_link detector
wiring`) КРАСНЕЕТ → откатить.

- [ ] **Step 4: Независимое ревью** — `pr-review-toolkit:code-reviewer` по диффу
energy-link: фокус (a) READ-ONLY (ноль write в services/energy-link), (b) cross-user
изоляция (все запросы по userId), (c) флаг-гейтинг детектора+enrichment
(off=identical), (d) пустые бакеты / деление на ноль (avg только при N≥minPerBucket;
completionByDate только для дат с total>0), (e) корректность join по дате
(`toISOString().slice(0,10)` для db.Date) и бакет-логики.

- [ ] **Step 5: Commit guard**

```bash
git add src/services/energy-link/no-write-guard.test.ts
git commit -m "test(energy-link): read-only guard + full verify

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review
- **Spec coverage:** флаг (T1), бакет-контраст формула (T2), gather buildEnergyLink
  + recentSleepLow (T3), поведенческий харнес (T4), enrichment (T5), детектор
  energy_link (T6), read-only guard+verify (T7). Все секции спеки.
- **Placeholder scan:** код в каждом шаге; «свериться grep'ом» (поля Task/Journal) —
  локаторы интеграции, не плейсхолдеры.
- **Type consistency:** `SleepDay`/`ContrastStatus`/`Contrast`/`EnergyLink` едины;
  `pairDays(journalByDate, completionByDate)→SleepDay[]`; `bucketContrast(pairs,...)
  →Contrast`; `describeEnergyLink(c)→string|null`; `buildEnergyLink(userId, now?)→
  EnergyLink|null` (поля `insightText`/`status`/`recentSleepLow`/`gapPct`); детектор
  читает `el.status`/`el.recentSleepLow`/`el.goodAvg`/`el.poorAvg`/`el.gapPct`.
- **Money/read-only:** T7 guard запрещает любой prisma write + raw SQL в energy-link.
- **Открытый риск:** точные поля `Task`/`JournalEntry` (date/completed/sleepHours) —
  досверяются в T4 Step 2 grep'ом (уже подтверждены в explore).

## Verification gate (вся фича)
1. `npm run test:db:up` healthy; `npm run test:it` — energy-link integration + baseline зелёные.
2. `npm test` unit зелёный; `npx tsc --noEmit` 0.
3. Negative control: убрать флаг-гейт детектора → красный → откат.
4. Флаг OFF → enrichment-поле null (секция отсутствует), детектор пуст → байт-идентично.
5. Read-only guard: ноль prisma write/raw SQL в services/energy-link.
