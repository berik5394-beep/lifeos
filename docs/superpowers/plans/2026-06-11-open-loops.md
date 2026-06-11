# Open-loops «что не закрыто сейчас» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Снимок незакрытого СЕЙЧАС (просрочки+привычки-сегодня+pending) → блок-осознание в промпт + проактивный нудж при завале. READ-ONLY, антифаб, off=байт-идентично.

**Architecture:** `gatherOpenLoops` (read-only) → enrichment-блок + proactivity-детектор `open_loop_pileup`, оба за `FEATURE_V2_OPEN_LOOPS`.

**Спека:** `docs/superpowers/specs/2026-06-11-open-loops-design.md`.

**Tech:** Fastify+Prisma6+Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`. MAIN worktree `/Users/berikkurmangoliev/Desktop/LifeOS` (branch=main). Коммит-на-шаг trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. push/deploy/флаг — по слову Berik.

**Риск:** read-only (0 записей). Антифаб: счётчики реальные из БД. TZ-care (HabitLog-сегодня). Дедуп нуджа.

---

### Task 1: Flag `isV2OpenLoopsEnabled`
**Files:** `src/lib/feature-flags.ts` (+`.test.ts`)
- [ ] **S1** тест (рядом с `isV2GoalHabitsEnabled`):
```ts
import { isV2OpenLoopsEnabled } from './feature-flags.js';
describe('isV2OpenLoopsEnabled', () => {
  const KEY = 'FEATURE_V2_OPEN_LOOPS'; const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });
  it('all→true', () => { process.env[KEY]='all'; expect(isV2OpenLoopsEnabled('u')).toBe(true); });
  it('unset/none/empty→false', () => { delete process.env[KEY]; expect(isV2OpenLoopsEnabled('u')).toBe(false); process.env[KEY]='none'; expect(isV2OpenLoopsEnabled('u')).toBe(false); process.env[KEY]=''; expect(isV2OpenLoopsEnabled('u')).toBe(false); });
  it('csv', () => { process.env[KEY]='user-abc'; expect(isV2OpenLoopsEnabled('abc')).toBe(true); expect(isV2OpenLoopsEnabled('z')).toBe(false); });
});
```
- [ ] **S2** FAIL: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/lib/feature-flags.test.ts`
- [ ] **S3** impl (рядом с `isV2GoalHabitsEnabled`):
```ts
/**
 * Open-loops: снимок незакрытого СЕЙЧАС (просрочки/привычки/pending) в промпт +
 * проактивный нудж при завале. READ-ONLY. OFF → блок не добавляется + детектор []
 * → байт-идентично.
 */
export function isV2OpenLoopsEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_OPEN_LOOPS, userId);
}
```
- [ ] **S4** PASS+tsc: `… && npx vitest run --project unit src/lib/feature-flags.test.ts && npx tsc --noEmit`
- [ ] **S5** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -m "$(cat <<'EOF'
feat(crossdomain): isV2OpenLoopsEnabled flag (off=identical)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `open-loops.ts` — gather + format + threshold
**Files:** Create `src/services/open-loops.ts` + `src/services/open-loops.test.ts`
- [ ] **S1** тест `open-loops.test.ts` (юнит — format+threshold чистые; gather проверяется в it):
```ts
import { describe, it, expect } from 'vitest';
import {
  formatOpenLoopsSection, shouldNudgeOpenLoops,
  OPEN_LOOP_OVERDUE_THRESHOLD, OPEN_LOOP_TOTAL_THRESHOLD, type OpenLoops,
} from './open-loops.js';

const base: OpenLoops = { overdueCount: 0, overdueTitles: [], habitsActive: 0, habitsUnchecked: 0, uncheckedHabitNames: [], pendingText: null };

describe('formatOpenLoopsSection', () => {
  it('всё закрыто → null', () => { expect(formatOpenLoopsSection(base)).toBeNull(); });
  it('просрочки+привычки+pending → строка', () => {
    const s = formatOpenLoopsSection({ ...base, overdueCount: 3, overdueTitles: ['отчёт', 'позвонить'], habitsActive: 4, habitsUnchecked: 2, uncheckedHabitNames: ['зарядка'], pendingText: 'подтвердить расход' });
    expect(s).toContain('просрочено 3'); expect(s).toContain('отчёт');
    expect(s).toContain('привычки 2/4'); expect(s).toContain('ждёт подтверждение');
  });
  it('просрочек больше чем имён → «…»', () => {
    const s = formatOpenLoopsSection({ ...base, overdueCount: 5, overdueTitles: ['a', 'b', 'c'] });
    expect(s).toContain('…');
  });
});
describe('shouldNudgeOpenLoops', () => {
  it('≥4 просрочки → true', () => { expect(shouldNudgeOpenLoops({ ...base, overdueCount: OPEN_LOOP_OVERDUE_THRESHOLD })).toBe(true); });
  it('сумма≥6 → true', () => { expect(shouldNudgeOpenLoops({ ...base, overdueCount: 3, habitsUnchecked: 3 })).toBe(true); });
  it('1-2 петли → false', () => { expect(shouldNudgeOpenLoops({ ...base, overdueCount: 2, habitsUnchecked: 1 })).toBe(false); });
  it('пороги экспортируются', () => { expect(OPEN_LOOP_OVERDUE_THRESHOLD).toBe(4); expect(OPEN_LOOP_TOTAL_THRESHOLD).toBe(6); });
});
```
- [ ] **S2** FAIL: `… && npx vitest run --project unit src/services/open-loops.test.ts`
- [ ] **S3** impl `open-loops.ts` (полный код из спеки §«Юнит A» — `OpenLoops` interface, `gatherOpenLoops`, `formatOpenLoopsSection`, `OPEN_LOOP_OVERDUE_THRESHOLD=4`, `OPEN_LOOP_TOTAL_THRESHOLD=6`, `shouldNudgeOpenLoops`). Импорты: `prisma` из `'../lib/prisma.js'`, `countOverduePending`/`listOverduePending` из `'./task-overdue.js'`.
- [ ] **S4** PASS+tsc: `… && npx vitest run --project unit src/services/open-loops.test.ts && npx tsc --noEmit`
- [ ] **S5** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/open-loops.ts packages/server/src/services/open-loops.test.ts && git commit -m "$(cat <<'EOF'
feat(crossdomain): open-loops gather + format + threshold (read-only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Блок-осознание в `v2-enrichment.ts`
**Files:** Modify `src/services/v2-enrichment.ts`; Create `src/services/open-loops-wiring.test.ts`
- [ ] **S1** создать `open-loops-wiring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const enr = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf8');

describe('open-loops — Part 1 enrichment', () => {
  it('флаг-ветка + gatherOpenLoops + поле openLoops + push', () => {
    expect(enr).toMatch(/isV2OpenLoopsEnabled\(/);
    expect(enr).toMatch(/gatherOpenLoops\(/);
    expect(enr).toMatch(/openLoops/);
    expect(enr).toMatch(/data\.openLoops/);
  });
});
```
- [ ] **S2** FAIL: `… && npx vitest run --project unit src/services/open-loops-wiring.test.ts`
- [ ] **S3** impl (спека §«Юнит B»):
  3a. Импорты вверху: `isV2OpenLoopsEnabled` из `'../lib/feature-flags.js'`; `gatherOpenLoops, formatOpenLoopsSection` из `'./open-loops.js'`.
  3b. В `V2EnrichmentData` добавить `openLoops: string | null;` (рядом с `recentActivity`).
  3c. В `fetchV2EnrichmentData` Promise.all добавить ветку (НАЙДИ, как сосед получает «сегодня по таймзоне юзера» = `todayStart` — там уже считается для других read'ов / countOverduePending-стиль; переиспользуй ТУ ЖЕ переменную, НЕ создавай вторую TZ-логику):
```ts
isV2OpenLoopsEnabled(userId)
  ? withTimeout(
      gatherOpenLoops(userId, todayStart).then((l) => formatOpenLoopsSection(l)),
      CROSS_DOMAIN_BUDGET_MS, null,
    ).catch(() => null)
  : Promise.resolve(null),
```
  добавить `openLoops` в destructure массива результатов + в возвращаемый объект (тем же позиционным порядком, как остальные — массив↔destructure строго совпадают).
  3d. В `buildV2EnrichmentBlock`: `if (data.openLoops) lines.push(data.openLoops);` (рядом с `data.recentActivity`).
  ВНИМАНИЕ: если в `fetchV2EnrichmentData` НЕТ готового `todayStart` по таймзоне — сверь, как его берёт `buildScheduleConflict` (он тоже про «сегодня»), и используй тот же хелпер. off-ветка `Promise.resolve(null)` → `openLoops:null` → не пушится → байт-идентично.
- [ ] **S4** целевой+ПОЛНЫЙ unit+tsc: `… && npx vitest run --project unit src/services/open-loops-wiring.test.ts && npm test && npx tsc --noEmit` — полный зелёный. Бриттл фикс-окно структ-теста из-за +строк → сообщи, не маскируй.
- [ ] **S5** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/v2-enrichment.ts packages/server/src/services/open-loops-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(crossdomain): open-loops awareness block in enrichment behind flag (Part 1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Проактивный нудж в `v2-proactivity-engine.ts`
**Files:** Modify `src/services/v2-proactivity-engine.ts`; дополнить `open-loops-wiring.test.ts`
- [ ] **S1** добавить в `open-loops-wiring.test.ts`:
```ts
describe('open-loops — Part 2 proactivity', () => {
  const eng = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf8');
  it('source+template+score+детектор с ранним флаг-гейтом', () => {
    expect(eng).toMatch(/'open_loop_pileup'/);
    expect(eng).toMatch(/open_loop_pileup:\s*\{/);          // TEMPLATES
    expect(eng).toMatch(/detectOpenLoopPileup/);
    expect(eng).toMatch(/isV2OpenLoopsEnabled\(/);          // ранний гейт
    expect(eng).toMatch(/shouldNudgeOpenLoops\(/);
  });
});
```
- [ ] **S2** FAIL: `… && npx vitest run --project unit src/services/open-loops-wiring.test.ts`
- [ ] **S3** impl (спека §«Юнит C» — ОТКРОЙ `detectGoalHabitsStall` (:730-745) и сверь ТОЧНУЮ форму `NudgeCandidate` + поле дедупа/scopeKey + откуда детектор берёт `todayStart`/now + как зарегистрирован в оркестраторе детекторов):
  3a. `NudgeSource` union (:19) — добавить `| 'open_loop_pileup'`.
  3b. `TEMPLATES` (:217) — `open_loop_pileup: { gentle: 'Накопилось: {{overdue}} просрочек, {{habits}} привычек не отмечено. Разгрести вместе?' }`.
  3c. `scoreSignificance` (:68) — `case 'open_loop_pileup': return 0.6;`.
  3d. Импорты: `isV2OpenLoopsEnabled` (`../lib/feature-flags.js`), `gatherOpenLoops, shouldNudgeOpenLoops` (`./open-loops.js`).
  3e. Детектор `detectOpenLoopPileup(userId, todayStart)` (зеркало detectGoalHabitsStall): ранний `if(!isV2OpenLoopsEnabled(userId)) return []` → `gatherOpenLoops(...).catch(()=>null)` → `if(!l||!shouldNudgeOpenLoops(l)) return []` → candidate `{source:'open_loop_pileup', payload:{overdue,habits}, toneHint:'gentle', + scopeKey 'time:open_loops' дедуп как у соседей}`.
  3f. Зарегистрировать вызов `detectOpenLoopPileup` рядом с `detectGoalHabitsStall` в оркестраторе (тот же `todayStart`/now источник).
- [ ] **S4** целевой+ПОЛНЫЙ unit+tsc: `… && npx vitest run --project unit src/services/open-loops-wiring.test.ts && npm test && npx tsc --noEmit` — tsc проверит exhaustiveness `Record<NudgeSource,...>` (новый source ОБЯЗАН быть в TEMPLATES, иначе красное).
- [ ] **S5** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/open-loops-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(crossdomain): open_loop_pileup proactivity nudge behind flag (Part 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Integration tests
**Files:** Create `src/services/open-loops.it.test.ts`
> Образец harness — `mem-graph.it.test.ts` (own PrismaClient, mkUser). Создавать задачи/привычки/логи напрямую через prisma. `todayStart` в тесте = UTC-instant начала локального дня (как считает прод).
- [ ] **S1** `npm run test:db:up`, затем `open-loops.it.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { gatherOpenLoops, shouldNudgeOpenLoops } from './open-loops.js';

const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });
async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({ data: { email: `it-loops-${tag}@it.local`, name: 'IT', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}
// начало сегодняшнего дня (UTC-instant), грубо — полночь UTC; для теста достаточно
const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
const yesterday = new Date(todayStart.getTime() - 86_400_000);

describe('open-loops — gather реальные счётчики', () => {
  it('3 просрочки + 4 привычки (2 отмечены сегодня) → overdue=3, unchecked=2', async () => {
    const uid = await mkUser(`g-${Date.now()}`);
    for (let i = 0; i < 3; i++) {
      await prisma.task.create({ data: { userId: uid, title: `задача ${i}`, date: yesterday, completed: false } });
    }
    const hs = [];
    for (let i = 0; i < 4; i++) {
      hs.push(await prisma.habit.create({ data: { userId: uid, name: `привычка ${i}`, active: true } }));
    }
    // 2 привычки отмечены СЕГОДНЯ
    await prisma.habitLog.create({ data: { userId: uid, habitId: hs[0].id, date: todayStart, completed: true } });
    await prisma.habitLog.create({ data: { userId: uid, habitId: hs[1].id, date: todayStart, completed: true } });
    const l = await gatherOpenLoops(uid, todayStart);
    expect(l.overdueCount).toBe(3);
    expect(l.habitsActive).toBe(4);
    expect(l.habitsUnchecked).toBe(2);
    expect(l.overdueTitles.length).toBeGreaterThan(0);
    // TZ-страховка: отмеченная сегодня привычка НЕ в unchecked
    expect(l.uncheckedHabitNames).not.toContain(hs[0].name);
  });
  it('PendingAction → pendingText непустой; нет → null', async () => {
    const uid = await mkUser(`p-${Date.now()}`);
    let l = await gatherOpenLoops(uid, todayStart);
    expect(l.pendingText).toBeNull();
    await prisma.pendingAction.create({ data: { userId: uid, action: 'add_expense', inputJson: {}, confirmationText: 'подтвердить расход 3000' } });
    l = await gatherOpenLoops(uid, todayStart);
    expect(l.pendingText).toContain('подтвердить');
  });
  it('cross-user: чужие задачи/привычки не считаются', async () => {
    const u1 = await mkUser(`x1-${Date.now()}`);
    const u2 = await mkUser(`x2-${Date.now()}`);
    await prisma.task.create({ data: { userId: u2, title: 'чужая', date: yesterday, completed: false } });
    const l = await gatherOpenLoops(u1, todayStart);
    expect(l.overdueCount).toBe(0);
  });
});
```
Замечания: сверь обязательные поля `Task`/`Habit`/`HabitLog`/`PendingAction` create (если требуются доп. поля — `category`/`priority`/`time` у Task и т.п. — добавь валидные). Если `date @db.Date` хранит иначе и `habitLog` не матчится диапазоном — это РЕАЛЬНЫЙ TZ-баг прод-логики gather → Phase-1 debug, чини gather (не тест). cross-user/счётчики — суть.
- [ ] **S2** run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm run test:db:up && npx vitest run --project integration src/services/open-loops.it.test.ts` — зелёное.
- [ ] **S3** commit:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/open-loops.it.test.ts && git commit -m "$(cat <<'EOF'
test(crossdomain): open-loops it — real counts, TZ habit-today, cross-user

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full verify + independent review
- [ ] **S1** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm test && npx tsc --noEmit` — ~2690+ unit зелёных.
- [ ] **S2** `npm run test:it` целевые open-loops + соседи (leak-чек).
- [ ] **S3 OFF-проверка** — diff: enrichment off-ветка `Promise.resolve(null)`→openLoops null→не push; детектор ранний `[]`; 0 записей (read-only).
- [ ] **S4 независимое ревью** (code-reviewer opus). Фокус: off=байт-идентично обе врезки; READ-ONLY; антифаб (счётчики/пункты реальные из БД); TZ-корректность HabitLog-сегодня (привычка отмеченная сегодня не в unchecked); дедуп нуджа (scopeKey ≤1/день); exhaustiveness NudgeSource; нет `any`/ESM/`vi.mock`.
- [ ] **S5** fix findings + commit.
- [ ] **S6 СТОП** — доложить Berik. Не пушить. Предложить push+deploy+`FEATURE_V2_OPEN_LOOPS=all`.

---

## Self-Review
- **Покрытие спеки:** флаг (T1), gather/format/threshold (T2), enrichment (T3), proactivity (T4), it (T5), verify (T6). Все юниты.
- **Заглушки:** код полный; «сверь todayStart-источник / NudgeCandidate-форму / обязательные create-поля» — явная сверка с реальностью (символы существуют), не выдумка.
- **Типы:** `gatherOpenLoops(userId,todayStart:Date)→Promise<OpenLoops>`; `formatOpenLoopsSection(l)→string|null`; `shouldNudgeOpenLoops(l)→boolean`; `isV2OpenLoopsEnabled(userId)`.
- **off=identical:** enrichment Promise.resolve(null)→openLoops null→не push; детектор early []. Структурный тест проверяет наличие врезок.
- **TZ-риск:** диапазон [todayStart, +1д) + it-тест на «отмечена сегодня → не unchecked».

## Execution Handoff
Subagent-Driven. push/deploy/флаг — по слову Berik.
