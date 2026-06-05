# complete_habit честность + умный матч + кросс-домен привычка↔цель Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Отметка привычки всегда реальна (или честный отказ, не враньё), находит привычку несмотря на морфологию, и связывает выполнение с целью + проактивный сигнал «цель проседает».

**Architecture:** Часть 1-2 (честный матч) — чинит FAKE, шипим всем без флага: чистый `matchHabit` + на промахе `throw` (loop ставит is_error, модель не врёт). Часть 3 (кросс-домен привычка↔цель↔серия) за флагом `isV2GoalHabitsEnabled`, off=байт-идентично: текст-связка в ответе + детектор `detectGoalHabitStall` (чинит захардкоженный goalsBehind:0) + enrichment. HabitLog читают 7 сервисов → честная запись авто-восстанавливает серию/питомца.

**Tech Stack:** Fastify + Prisma 6 + Postgres, TS strict (no any), ESM (`.js`), vitest, zero vi.mock.

**Rollout:** Коммит на шаг (heredoc, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). push/deploy/флаг — по слову Berik; флаг сразу all. `npx tsc --noEmit` (из packages/server) чисто каждый шаг. Baseline ~2494 unit зелёный.

---

## File Structure
- Create `src/tools/_habit-match.ts` — нормализация + matchHabit + buildNotFoundMessage (чистые).
- Create `src/tools/_habit-match.test.ts`.
- Modify `src/tools/complete-habit.ts` — matchHabit + throw + text-link (флаг).
- Modify `src/tools/complete-multiple-habits.ts` — matchHabit + throw если 0.
- Create `src/services/goal-habits/types.ts` (+ test), `health.ts`, `index.ts`.
- Modify `src/lib/feature-flags.ts` (+ test) — isV2GoalHabitsEnabled.
- Modify `src/services/v2-proactivity-engine.ts` (+ test) — goal_habits_stall.
- Modify `src/services/v2-enrichment.ts` — goalHabits врезка.
- Create `src/tools/complete-habit.it.test.ts`, `src/services/goal-habits/goal-habits-wiring.test.ts`.

---

## Task 1: Чистый матч — `_habit-match.ts`

**Files:** Create `src/tools/_habit-match.ts`, `src/tools/_habit-match.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tools/_habit-match.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeHabit, matchHabit, buildNotFoundMessage } from './_habit-match.js';

const H = (id: string, name: string) => ({ id, name });

describe('normalizeHabit', () => {
  it('lowercase + убирает пунктуацию + схлоп пробелов', () => {
    expect(normalizeHabit('  Утренняя, Зарядка!  ')).toBe('утренняя зарядка');
  });
});

describe('matchHabit (морфология)', () => {
  const habits = [H('h1', 'Зарядка'), H('h2', 'Медитация'), H('h3', 'Чтение')];
  it('винительный падеж: «зарядку» → Зарядка', () => {
    expect(matchHabit('зарядку', habits)?.id).toBe('h1');
  });
  it('«медитацию» → Медитация', () => {
    expect(matchHabit('медитацию', habits)?.id).toBe('h2');
  });
  it('род. падеж: «чтения» → Чтение', () => {
    expect(matchHabit('чтения', habits)?.id).toBe('h3');
  });
  it('точное совпадение', () => {
    expect(matchHabit('Зарядка', habits)?.id).toBe('h1');
  });
  it('опечатка «зарядкаа» → fuzzy → Зарядка', () => {
    expect(matchHabit('зарядкаа', habits)?.id).toBe('h1');
  });
  it('семантически далёкое «бег» → null (честный отказ)', () => {
    expect(matchHabit('бег', habits)).toBeNull();
  });
  it('пустой/нет привычек → null', () => {
    expect(matchHabit('', habits)).toBeNull();
    expect(matchHabit('зарядка', [])).toBeNull();
  });
  it('неоднозначность (два равных кандидата) → null', () => {
    const ambi = [H('a', 'Бег утром'), H('b', 'Бег вечером')];
    expect(matchHabit('бег', ambi)).toBeNull();
  });
});

describe('buildNotFoundMessage', () => {
  it('есть привычки → список + вопрос', () => {
    const m = buildNotFoundMessage('зарядку', [H('h1', 'Чтение'), H('h2', 'Медитация')]);
    expect(m).toContain('Не нашёл');
    expect(m).toContain('Чтение');
    expect(m).toContain('Медитация');
  });
  it('нет привычек → предложение завести', () => {
    expect(buildNotFoundMessage('зарядку', [])).toContain('нет привычек');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/tools/_habit-match.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Write minimal implementation**

Create `src/tools/_habit-match.ts`:

```ts
/**
 * Умный матч привычки по имени (рус. морфология). Чистый, юнит-тестируемый.
 * Тяжёлые семантические случаи НЕ матчатся → null → честный not-found+список.
 */

// Хвостовые окончания, отсортированы длинными вперёд (срезаем самое длинное).
const ENDINGS = ['ого', 'его', 'ами', 'ями', 'ую', 'юю', 'ах', 'ях', 'ой', 'ою', 'а', 'я', 'ы', 'и', 'е', 'о', 'у', 'ю'];

export function normalizeHabit(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(token: string): string {
  for (const e of ENDINGS) {
    if (token.length - e.length >= 3 && token.endsWith(e)) {
      return token.slice(0, -e.length);
    }
  }
  return token;
}

function stemJoined(s: string): string {
  return stem(normalizeHabit(s).replace(/\s+/g, ''));
}

function stemTokens(s: string): string[] {
  return normalizeHabit(s).split(' ').filter(Boolean).map(stem);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export interface HabitRef { id: string; name: string }

export function matchHabit(query: string, habits: HabitRef[]): HabitRef | null {
  const nq = normalizeHabit(query);
  if (!nq || habits.length === 0) return null;
  const sq = stemJoined(query);
  const qt = stemTokens(query);

  const scored = habits
    .map((h) => {
      const nn = normalizeHabit(h.name);
      const sn = stemJoined(h.name);
      let tier = 99;
      let dist = 999;
      if (nn === nq) { tier = 0; dist = 0; }
      else if (sn === sq) { tier = 1; dist = 0; }
      else if (sn.length >= 3 && sq.length >= 3 && (sn.includes(sq) || sq.includes(sn))) {
        tier = 2; dist = Math.abs(sn.length - sq.length);
      } else if (qt.some((t) => t.length >= 3 && stemTokens(h.name).includes(t))) {
        tier = 3; dist = 0;
      } else {
        const d = levenshtein(sq, sn);
        const thr = Math.max(1, Math.floor(Math.max(sq.length, sn.length) / 4));
        if (d <= thr) { tier = 4; dist = d; }
      }
      return { h, tier, dist };
    })
    .filter((c) => c.tier < 99)
    .sort((a, b) => a.tier - b.tier || a.dist - b.dist);

  if (scored.length === 0) return null;
  // Неоднозначность: два лучших на одном тире+дистанции → не угадываем.
  if (scored.length >= 2 && scored[0].tier === scored[1].tier && scored[0].dist === scored[1].dist) {
    return null;
  }
  return { id: scored[0].h.id, name: scored[0].h.name };
}

export function buildNotFoundMessage(query: string, habits: HabitRef[]): string {
  if (habits.length === 0) {
    return `Не нашёл привычку «${query}» — у тебя пока нет привычек. Хочешь завести?`;
  }
  const list = habits.map((h) => h.name).join(', ');
  return `Не нашёл привычку «${query}». Сейчас у тебя: ${list}. Какую отметить?`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/tools/_habit-match.test.ts`
Expected: PASS (все кейсы). `npx tsc --noEmit` — чисто.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/tools/_habit-match.ts packages/server/src/tools/_habit-match.test.ts
git commit -F - <<'EOF'
feat(habit): pure matchHabit (morphology) + buildNotFoundMessage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Честность complete_habit (throw на промахе) + select goalId

**Files:** Modify `src/tools/complete-habit.ts`

- [ ] **Step 1: Replace match + not-found logic**

В `src/tools/complete-habit.ts`:
1. Добавь импорт сверху:
   ```ts
   import { matchHabit, buildNotFoundMessage } from './_habit-match.js';
   ```
2. Замени блок резолва привычки (от `let habit = input.habitId` до `if (!habit) return ...`) на:
   ```ts
   let habit = input.habitId
     ? await prisma.habit.findFirst({
         where: { id: input.habitId, userId },
         select: { id: true, name: true, goalId: true },
       })
     : null;
   if (!habit && input.name) {
     const active = await prisma.habit.findMany({
       where: { userId, active: true },
       select: { id: true, name: true, goalId: true },
     });
     const matched = matchHabit(input.name, active);
     if (matched) {
       habit = active.find((h) => h.id === matched.id) ?? null;
     } else {
       // ЧЕСТНОСТЬ: throw → claude-agent ставит is_error:true → модель НЕ врёт «отметил».
       throw new Error(buildNotFoundMessage(input.name, active));
     }
   }
   if (!habit) {
     throw new Error('Не указано какую привычку отметить (нет имени и id).');
   }
   ```
   (Запись `habitLog.upsert` ниже остаётся как есть; `return { message: '...отмечена ✅', habitId }` пока без текст-связки — её добавим в Task 5.)

- [ ] **Step 2: Verify tsc**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/tools/complete-habit.ts
git commit -F - <<'EOF'
fix(habit): complete_habit honest — matchHabit + throw on miss (no fake success)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Честность complete_multiple_habits

**Files:** Modify `src/tools/complete-multiple-habits.ts`

- [ ] **Step 1: Use matchHabit + throw when none found**

В `src/tools/complete-multiple-habits.ts`:
1. Импорт:
   ```ts
   import { matchHabit, buildNotFoundMessage } from './_habit-match.js';
   ```
2. Замени `nameResolves` (Promise.all с findFirst contains) на единый fetch + matchHabit:
   ```ts
   const active = (input.habitNames ?? []).length
     ? await prisma.habit.findMany({
         where: { userId, active: true },
         select: { id: true, name: true },
       })
     : [];
   const nameResolves = (input.habitNames ?? []).map((name) => ({
     requestedName: name,
     habit: matchHabit(name, active),
   }));
   ```
3. После вычисления `notFound`/`succeededIds`/`failedIds` (логика upsert ниже не меняется), добавь честный throw ПЕРЕД финальным `return`, когда вообще ничего не отмечено:
   ```ts
   if (succeededIds.length === 0 && (input.habitIds ?? []).length === 0) {
     // НИ одной привычки не отмечено → честный провал (модель не врёт «отметил»).
     throw new Error(buildNotFoundMessage((input.habitNames ?? []).join(', '), active));
   }
   ```
   (Частичный успех — succeededIds.length>0 — остаётся success с `notFoundNames` в message, как сейчас. throw НЕ делаем: реальная запись произошла.)

- [ ] **Step 2: Verify tsc**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/tools/complete-multiple-habits.ts
git commit -F - <<'EOF'
fix(habit): complete_multiple honest — matchHabit + throw when none matched

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Флаг + goal-habits gather (types + health)

**Files:** Modify `src/lib/feature-flags.ts`, `src/lib/feature-flags.test.ts`; Create `src/services/goal-habits/types.ts`, `types.test.ts`, `health.ts`, `index.ts`

- [ ] **Step 1: Flag test (red)**

В `src/lib/feature-flags.test.ts` добавь имя `isV2GoalHabitsEnabled` в import из `./feature-flags.js` и блок:
```ts
describe('isV2GoalHabitsEnabled', () => {
  const KEY = 'FEATURE_V2_GOAL_HABITS';
  afterEach(() => { delete process.env[KEY]; });
  it('undefined → false', () => { delete process.env[KEY]; expect(isV2GoalHabitsEnabled('u1')).toBe(false); });
  it('"all" → true', () => { process.env[KEY] = 'all'; expect(isV2GoalHabitsEnabled('u1')).toBe(true); });
  it('user-<id> адресно', () => { process.env[KEY] = 'user-u1'; expect(isV2GoalHabitsEnabled('u1')).toBe(true); expect(isV2GoalHabitsEnabled('u2')).toBe(false); });
});
```

- [ ] **Step 2: Flag impl**

В `src/lib/feature-flags.ts` добавь (копия формы isV2BirthdayEnabled):
```ts
export function isV2GoalHabitsEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_GOAL_HABITS;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```
Run: `cd packages/server && npx vitest run src/lib/feature-flags.test.ts -t isV2GoalHabitsEnabled` → PASS.

- [ ] **Step 3: Pure types test (red)**

Create `src/services/goal-habits/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeStall, pickWorstStall, type GoalHabitHealth } from './types.js';

const row = (over: Partial<GoalHabitHealth>): GoalHabitHealth => ({
  goalId: 'g', goalText: 'Быть в форме', linkedHabitCount: 2, daysSinceLastCompletion: 0, ...over,
});

describe('computeStall', () => {
  it('≥3 дней без отметок при наличии привычек → stall', () => {
    const out = computeStall([row({ daysSinceLastCompletion: 4 })], 3);
    expect(out).toHaveLength(1);
  });
  it('свежая отметка → не stall', () => {
    expect(computeStall([row({ daysSinceLastCompletion: 1 })], 3)).toHaveLength(0);
  });
  it('нет привычек к цели → не stall', () => {
    expect(computeStall([row({ linkedHabitCount: 0, daysSinceLastCompletion: 10 })], 3)).toHaveLength(0);
  });
});

describe('pickWorstStall', () => {
  it('берёт максимум daysSince', () => {
    const w = pickWorstStall([row({ goalId: 'a', daysSinceLastCompletion: 4 }), row({ goalId: 'b', daysSinceLastCompletion: 9 })]);
    expect(w?.goalId).toBe('b');
  });
  it('пусто → null', () => { expect(pickWorstStall([])).toBeNull(); });
});
```

- [ ] **Step 4: Pure types impl**

Create `src/services/goal-habits/types.ts`:
```ts
export interface GoalHabitHealth {
  goalId: string;
  goalText: string;
  linkedHabitCount: number;
  daysSinceLastCompletion: number; // 9999 если ни разу не отмечали
}

/** Цели, чьи привязанные привычки буксуют ≥ thresholdDays. */
export function computeStall(rows: GoalHabitHealth[], thresholdDays = 3): GoalHabitHealth[] {
  return rows.filter((r) => r.linkedHabitCount >= 1 && r.daysSinceLastCompletion >= thresholdDays);
}

/** Самая буксующая цель (макс daysSince) или null. */
export function pickWorstStall(stalling: GoalHabitHealth[]): GoalHabitHealth | null {
  if (stalling.length === 0) return null;
  return [...stalling].sort((a, b) => b.daysSinceLastCompletion - a.daysSinceLastCompletion)[0];
}
```
Run: `cd packages/server && npx vitest run src/services/goal-habits/types.test.ts` → PASS.

- [ ] **Step 5: Read-only gatherer `health.ts` + `index.ts`**

Create `src/services/goal-habits/health.ts`:
```ts
import { prisma } from '../../lib/prisma.js';
import type { GoalHabitHealth } from './types.js';

const DAY_MS = 86_400_000;

/**
 * Здоровье целей через их привычки. READ-ONLY. Для каждой YearlyGoal текущего
 * года с привязанными активными привычками — давность последней отметки HabitLog.
 */
export async function buildGoalHabitHealth(userId: string, now: Date = new Date()): Promise<GoalHabitHealth[]> {
  const year = now.getUTCFullYear();
  const goals = await prisma.yearlyGoal.findMany({
    where: { userId, year },
    select: {
      id: true,
      goalText: true,
      habits: { where: { active: true }, select: { id: true } },
    },
  });
  const out: GoalHabitHealth[] = [];
  for (const g of goals) {
    const habitIds = g.habits.map((h) => h.id);
    if (habitIds.length === 0) continue;
    const last = await prisma.habitLog.findFirst({
      where: { userId, habitId: { in: habitIds }, completed: true },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    const daysSince = last
      ? Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - last.date.getTime()) / DAY_MS)
      : 9999;
    out.push({
      goalId: g.id,
      goalText: g.goalText,
      linkedHabitCount: habitIds.length,
      daysSinceLastCompletion: Math.max(0, daysSince),
    });
  }
  return out;
}
```

Create `src/services/goal-habits/index.ts`:
```ts
export * from './types.js';
export { buildGoalHabitHealth } from './health.js';
```
Run: `cd packages/server && npx tsc --noEmit` → чисто.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts packages/server/src/services/goal-habits/
git commit -F - <<'EOF'
feat(goal-habits): flag + computeStall/pickWorstStall + buildGoalHabitHealth (read-only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Текст-связка + детектор + enrichment (флаг-gated)

**Files:** Modify `src/tools/complete-habit.ts`, `src/services/v2-proactivity-engine.ts` (+ test), `src/services/v2-enrichment.ts`

- [ ] **Step 1: Text-link in complete_habit (flag-gated, best-effort)**

В `src/tools/complete-habit.ts`, замени финальный `return { message: ..., habitId }` на:
```ts
  let suffix = '';
  try {
    const { isV2GoalHabitsEnabled } = await import('../lib/feature-flags.js');
    if (habit.goalId && isV2GoalHabitsEnabled(userId)) {
      const [goal, streak] = await Promise.all([
        prisma.yearlyGoal.findUnique({ where: { id: habit.goalId }, select: { goalText: true } }),
        import('../services/streak-service.js').then((m) => m.calculateStreak(userId)),
      ]);
      if (goal) suffix = ` — это к цели «${goal.goalText}», серия ${streak} дней`;
    }
  } catch { /* best-effort: связка не должна ломать отметку */ }
  return { message: `Привычка "${habit.name}" отмечена ✅${suffix}`, habitId: habit.id };
```
Run: `cd packages/server && npx tsc --noEmit` → чисто.

- [ ] **Step 2: Detector wiring — engine (union+TEMPLATES+score)**

В `src/services/v2-proactivity-engine.ts`:
1. В `NudgeSource` union после `| 'memorial_upcoming'` добавь:
   ```ts
     | 'memorial_upcoming'
     | 'goal_habits_stall';
   ```
2. В `TEMPLATES` после `memorial_upcoming` добавь:
   ```ts
     goal_habits_stall: {
       gentle: 'Цель «{{goalText}}» проседает — привычки к ней не отмечались {{days}} дн. Вернёмся?',
       supportive: 'Заметил: к цели «{{goalText}}» привычки буксуют ({{days}} дн). Маленький шаг сегодня?',
     },
   ```
3. В `scoreSignificance` после кейса `memorial_upcoming` добавь:
   ```ts
     case 'goal_habits_stall': {
       // Привычки к цели буксуют — стабильно значимо (≥0.6 floor gate3).
       return 0.65;
     }
   ```

- [ ] **Step 3: Verify tsc after union/TEMPLATES/score**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто (total Record + switch согласованы).

- [ ] **Step 4: detectGoalHabitStall + register**

В `src/services/v2-proactivity-engine.ts`:
1. Добавь импорт рядом с прочими gather-импортами:
   ```ts
   import { buildGoalHabitHealth, computeStall, pickWorstStall } from './goal-habits/index.js';
   ```
2. Сразу после функции `detectMemorial` (после её `}`) добавь:
   ```ts
   /**
    * Привычка↔цель (interconnection): цель, чьи привязанные привычки буксуют
    * ≥3 дней → нудж «цель проседает». Чинит захардкоженный goalsBehind:0
    * реальным числом. READ-ONLY. Флаг-гейт ранний (off=identical).
    */
   async function detectGoalHabitStall(userId: string): Promise<NudgeCandidate[]> {
     try {
       const { isV2GoalHabitsEnabled } = await import('../lib/feature-flags.js');
       if (!isV2GoalHabitsEnabled(userId)) return [];
       const health = await buildGoalHabitHealth(userId, new Date());
       const worst = pickWorstStall(computeStall(health, 3));
       if (!worst) return [];
       const cand: NudgeCandidate = {
         source: 'goal_habits_stall',
         significance: 0,
         payload: {
           goalText: worst.goalText,
           days: worst.daysSinceLastCompletion,
           habitCount: worst.linkedHabitCount,
         },
         toneHint: 'gentle',
       };
       cand.significance = scoreSignificance(cand);
       return [cand];
     } catch (err) {
       console.warn('[v2-proactivity] detectGoalHabitStall failed:', err);
       return [];
     }
   }
   ```
3. В `detectCandidates` Promise.allSettled после `detectMemorial(userId),` добавь:
   ```ts
         detectGoalHabitStall(userId),
   ```

- [ ] **Step 5: Exhaustiveness test update**

В `src/services/v2-proactivity-engine.test.ts`, тест `'covers all known sources'` — добавь `'goal_habits_stall'` в отсортированный список.

Run: `cd packages/server && npx vitest run src/services/v2-proactivity-engine.test.ts && npx tsc --noEmit`
Expected: PASS; tsc чисто.

- [ ] **Step 6: Enrichment врезка goalHabits (позиционно последним)**

В `src/services/v2-enrichment.ts`:
1. Импорт:
   ```ts
   import { buildGoalHabitHealth, computeStall, pickWorstStall } from './goal-habits/index.js';
   ```
   И убедись `isV2GoalHabitsEnabled` в import из `../lib/feature-flags.js`.
2. В `V2EnrichmentData` после `memorials: string | null;` добавь:
   ```ts
     /** Привычка↔цель (interconnection): «Цель X: привычки буксуют» или null. */
     goalHabits: string | null;
   ```
3. Добавь pure-рендер рядом с прочими format*:
   ```ts
   export function formatGoalHabitSection(text: string | null): string {
     if (!text) return '';
     return `Цель под риском (привычки): ${text}`;
   }
   ```
4. В `buildV2EnrichmentBlock` после `if (data.memorials) lines.push(data.memorials);` добавь:
   ```ts
     const gh = formatGoalHabitSection(data.goalHabits ?? null);
     if (gh) lines.push(gh);
   ```
5. В gather Promise.all — деструктуризация `..., memorials, goalHabits]`; в массив ПОСЛЕДНИМ:
   ```ts
         isV2GoalHabitsEnabled(userId)
           ? withTimeout(
               buildGoalHabitHealth(userId).then((h) => {
                 const w = pickWorstStall(computeStall(h, 3));
                 return w ? `«${w.goalText}» — ${w.daysSinceLastCompletion} дн без отметок` : null;
               }),
               CROSS_DOMAIN_BUDGET_MS,
               null,
             ).catch(() => null)
           : Promise.resolve(null),
   ```
   В объект data после `memorials,` добавь `goalHabits,`.

Run: `cd packages/server && npx tsc --noEmit && npx vitest run src/services/v2-enrichment.test.ts`
Expected: tsc чисто; enrichment-тесты зелёные. Перепроверь глазами позиционность массив↔деструктуризация (goalHabits последним в обоих).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/tools/complete-habit.ts packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts packages/server/src/services/v2-enrichment.ts
git commit -F - <<'EOF'
feat(goal-habits): text-link + detectGoalHabitStall + enrichment (flag-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Поведенческий + структурный тесты + verify

**Files:** Create `src/tools/complete-habit.it.test.ts`, `src/services/goal-habits/goal-habits-wiring.test.ts`

- [ ] **Step 1: Behavioral .it test**

Create `src/tools/complete-habit.it.test.ts`:
```ts
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { completeHabitTool } from './complete-habit.js';
import { buildGoalHabitHealth } from '../services/goal-habits/index.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_GOAL_HABITS = 'all'; });

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'H', passwordHash: 'x' } });
  return u.id;
}

describe('complete_habit честность + кросс-домен (тест-БД)', () => {
  it('морфология: «зарядку» → реальная запись HabitLog', async () => {
    const userId = await seedUser(`hb-a-${Date.now()}@a.test`);
    const h = await prisma.habit.create({ data: { userId, name: 'Зарядка', category: 'health', frequency: 'daily' } });
    await completeHabitTool.handler({ name: 'зарядку' } as never, { userId } as never);
    const logs = await prisma.habitLog.count({ where: { userId, habitId: h.id, completed: true } });
    expect(logs).toBe(1);
  });

  it('несуществующая привычка → THROW (не фейковый успех)', async () => {
    const userId = await seedUser(`hb-b-${Date.now()}@a.test`);
    await prisma.habit.create({ data: { userId, name: 'Чтение', category: 'personal', frequency: 'daily' } });
    await expect(
      completeHabitTool.handler({ name: 'плавание' } as never, { userId } as never),
    ).rejects.toThrow(/Не нашёл/);
  });

  it('привычка к цели → message содержит «к цели»', async () => {
    const userId = await seedUser(`hb-c-${Date.now()}@a.test`);
    const goal = await prisma.yearlyGoal.create({ data: { userId, year: new Date().getUTCFullYear(), area: 'health', goalText: 'Быть в форме' } });
    await prisma.habit.create({ data: { userId, name: 'Зарядка', category: 'health', frequency: 'daily', goalId: goal.id } });
    const res = (await completeHabitTool.handler({ name: 'зарядка' } as never, { userId } as never)) as { message: string };
    expect(res.message).toContain('к цели');
  });

  it('buildGoalHabitHealth ловит буксующую цель, игнорит свежую', async () => {
    const userId = await seedUser(`hb-d-${Date.now()}@a.test`);
    const goal = await prisma.yearlyGoal.create({ data: { userId, year: new Date().getUTCFullYear(), area: 'health', goalText: 'Форма' } });
    await prisma.habit.create({ data: { userId, name: 'Бег', category: 'health', frequency: 'daily', goalId: goal.id } });
    const health = await buildGoalHabitHealth(userId, new Date());
    expect(health).toHaveLength(1);
    expect(health[0].daysSinceLastCompletion).toBeGreaterThanOrEqual(3); // ни одной отметки → 9999
  });

  it('cross-user: B не видит цели A', async () => {
    const a = await seedUser(`hb-e1-${Date.now()}@a.test`);
    const b = await seedUser(`hb-e2-${Date.now()}@a.test`);
    const g = await prisma.yearlyGoal.create({ data: { userId: a, year: new Date().getUTCFullYear(), area: 'health', goalText: 'X' } });
    await prisma.habit.create({ data: { userId: a, name: 'Бег', category: 'health', frequency: 'daily', goalId: g.id } });
    expect(await buildGoalHabitHealth(b, new Date())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run behavioral**

Run: `cd packages/server && npm run test:db:up && npx vitest run src/tools/complete-habit.it.test.ts --project integration`
Expected: PASS (5 тестов).

- [ ] **Step 3: Structural wiring test**

Create `src/services/goal-habits/goal-habits-wiring.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ENGINE = readFileSync(join(__dirname, '..', 'v2-proactivity-engine.ts'), 'utf8');
const ENRICH = readFileSync(join(__dirname, '..', 'v2-enrichment.ts'), 'utf8');
const FLAGS = readFileSync(join(__dirname, '..', '..', 'lib', 'feature-flags.ts'), 'utf8');
const CH = readFileSync(join(__dirname, '..', '..', 'tools', 'complete-habit.ts'), 'utf8');
const HEALTH = readFileSync(join(__dirname, 'health.ts'), 'utf8');

describe('goal-habits wiring (structural)', () => {
  it('флаг isV2GoalHabitsEnabled', () => {
    expect(FLAGS).toMatch(/export function isV2GoalHabitsEnabled/);
    expect(FLAGS).toMatch(/FEATURE_V2_GOAL_HABITS/);
  });
  it('goal_habits_stall в engine union+TEMPLATES+score+detectCandidates', () => {
    expect(ENGINE).toMatch(/'goal_habits_stall'/);
    expect(ENGINE).toMatch(/goal_habits_stall:\s*{/);
    expect(ENGINE).toMatch(/case 'goal_habits_stall':/);
    expect(ENGINE).toMatch(/detectGoalHabitStall\(userId\)/);
  });
  it('detectGoalHabitStall ранний флаг-гейт', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('async function detectGoalHabitStall'));
    expect(fn).toMatch(/if\s*\(!isV2GoalHabitsEnabled\(userId\)\)\s*return\s*\[\]/);
  });
  it('ЧЕСТНОСТЬ: complete-habit.ts бросает на промахе, нет тихого notFound-return', () => {
    expect(CH).toMatch(/throw new Error\(buildNotFoundMessage/);
    expect(CH).not.toMatch(/return\s*{\s*message:\s*'Привычка не найдена'/);
  });
  it('enrichment врезка goalHabits за флагом', () => {
    expect(ENRICH).toMatch(/goalHabits:\s*string\s*\|\s*null/);
    expect(ENRICH).toMatch(/isV2GoalHabitsEnabled\(userId\)/);
    expect(ENRICH).toMatch(/if\s*\(gh\)/);
  });
  it('money-safety: health.ts (goal-habits) без prisma write', () => {
    expect(HEALTH).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|updateMany|deleteMany|createMany)/);
  });
});
```

- [ ] **Step 4: Run structural + full suite + tsc**

Run: `cd packages/server && npx vitest run src/services/goal-habits/goal-habits-wiring.test.ts && npx tsc --noEmit && npx vitest run`
Expected: structural PASS (6); tsc чисто; вся unit-сюита зелёная (~2494 + новые).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/tools/complete-habit.it.test.ts packages/server/src/services/goal-habits/goal-habits-wiring.test.ts
git commit -F - <<'EOF'
test(habit): behavioral honesty/cross-domain + structural goal-habits wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Independent review**

Dispatch независимое ревью (pr-review-toolkit:code-reviewer) на дифф фичи. Фокус: (1) честность — throw на промахе реально даёт is_error (claude-agent.ts:255-272); тихого notFound-return больше нет; (2) off=байт-идентично для кросс-домена (флаг-гейт detectGoalHabitStall + enrichment ветка + text-link suffix только при флаге); (3) matchHabit не угадывает при неоднозначности (тие→null); (4) авто-восстановление HabitLog (честная запись → 7 читателей); (5) позиционность enrichment Promise.all (goalHabits последним); (6) money-safety (ноль write в goal-habits). Исправь замечания, перепрогони сюиту.

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:**
- Честность complete_habit (throw) → Task 2. ✓
- Честность complete_multiple_habits → Task 3. ✓
- Умный матч matchHabit + normalize → Task 1. ✓
- Флаг isV2GoalHabitsEnabled → Task 4. ✓
- buildGoalHabitHealth + computeStall/pickWorstStall → Task 4. ✓
- Текст-связка (флаг) → Task 5 Step 1. ✓
- detectGoalHabitStall + union/TEMPLATES/score/register/exhaustiveness → Task 5. ✓
- enrichment врезка (флаг, позиционно) → Task 5 Step 6. ✓
- Тесты pure/behavioral/structural + честность-гард + money-safety → Tasks 1,4,6. ✓

**2. Placeholder scan:** Нет TBD/TODO. Все шаги с кодом содержат код. «убедись isV2GoalHabitsEnabled в import» — интеграция в существующий import-список, не плейсхолдер.

**3. Type consistency:** `matchHabit(query, HabitRef[]) → HabitRef|null`; `GoalHabitHealth{goalId,goalText,linkedHabitCount,daysSinceLastCompletion}`; `computeStall(rows,threshold)→[]`, `pickWorstStall([])→worst|null`; `buildGoalHabitHealth(userId,now)→GoalHabitHealth[]`. payload детектора (`goalText`,`days`,`habitCount`) совпадает с плейсхолдерами TEMPLATES (`{{goalText}}`,`{{days}}`). Поле `goalHabits:string|null` согласовано в типе/деструктуризации/массиве/data/push. scoreSignificance возвращает number для goal_habits_stall (switch без default — exhaustiveness форсирован).
