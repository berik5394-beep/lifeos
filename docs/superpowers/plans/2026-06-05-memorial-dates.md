# Памятные даты (Memorial Dates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бот проактивно и бережно напоминает о днях памяти близких («Завтра день памяти — Папа. Если нужно, я рядом. 🤍») за день и в сам день, читая `death_date` из памяти.

**Architecture:** Зеркало уже-задеплоенной фичи ДР (birthday). Реюз `parseBirthday`/`daysUntilBirthday`/`whenLabel`/`upcomingBirthdays` без изменений. Новое: `pickDeathDate` (терпимое чтение ключа) + `formatMemorialSection` (pure), `listMemorials`/`buildUpcomingMemorials`/`buildMemorialSection` (read-only гейтер), детектор `detectMemorial` (`source='memorial_upcoming'`, тон всегда supportive через детерминированный шаблон), enrichment-секция. READ-ONLY, флаг реюз `isV2BirthdayEnabled`, off=байт-идентично.

**Tech Stack:** Fastify + Prisma 6 + Postgres, TypeScript strict (no `any`), ESM (`.js`), vitest, zero `vi.mock`.

**ВАЖНО (урок ДР):** фича ДР прошла зелёной, но упала в проде (LLM-аргументы). Поэтому ОБЯЗАТЕЛЕН поведенческий tone-safety тест + реальная прод-проверка после деплоя (Task 5).

**Rollout:** Коммит на шаг (heredoc, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). push/deploy — по слову Berik. Флаг `FEATURE_V2_BIRTHDAY` уже `=all` — env НЕ трогать. `npx tsc --noEmit` (из `packages/server`) чисто каждый шаг.

---

## File Structure
- Modify `src/services/birthday/types.ts` — `pickDeathDate` + `formatMemorialSection` (pure).
- Modify `src/services/birthday/types.test.ts` — юнит обоих.
- Modify `src/services/birthday/birthday.ts` — `listMemorials`/`buildUpcomingMemorials`/`buildMemorialSection` (read-only).
- Modify `src/services/birthday/index.ts` — экспорт 3 функций.
- Modify `src/services/v2-proactivity-engine.ts` — union + TEMPLATES + scoreSignificance + import + `detectMemorial` + register.
- Modify `src/services/v2-proactivity-engine.test.ts` — exhaustiveness + tone-safety поведенческий.
- Modify `src/services/v2-enrichment.ts` — поле `memorials` + gather + push.
- Modify `src/services/birthday/birthday.it.test.ts` — поведенческий мемориала.
- Modify `src/services/birthday/birthday-wiring.test.ts` — структурный мемориала.

---

## Task 1: Pure helpers — `pickDeathDate` + `formatMemorialSection`

**Files:**
- Modify: `src/services/birthday/types.ts`
- Test: `src/services/birthday/types.test.ts`

- [ ] **Step 1: Write the failing test**

Добавь в КОНЕЦ `src/services/birthday/types.test.ts` (импорты `pickDeathDate`, `formatMemorialSection` допиши в существующий import-список из `./types.js`):

```ts
describe('pickDeathDate', () => {
  it('берёт death_date', () => {
    expect(pickDeathDate({ death_date: '10 августа 2021', role: 'отец' })).toBe('10 августа 2021');
  });
  it('альт-ключ deathDate', () => {
    expect(pickDeathDate({ deathDate: '5.02.2020' })).toBe('5.02.2020');
  });
  it('альт-ключ died', () => {
    expect(pickDeathDate({ died: '2019-03-01' })).toBe('2019-03-01');
  });
  it('приоритет death_date над прочими', () => {
    expect(pickDeathDate({ deathDate: 'x', death_date: 'y' })).toBe('y');
  });
  it('нет ключа смерти → undefined', () => {
    expect(pickDeathDate({ birthday: '21 мая' })).toBeUndefined();
    expect(pickDeathDate({})).toBeUndefined();
  });
  it('null значение игнорируется', () => {
    expect(pickDeathDate({ death_date: null, died: '1.1.2000' })).toBe('1.1.2000');
  });
});

describe('formatMemorialSection', () => {
  it('пусто → null', () => {
    expect(formatMemorialSection([])).toBeNull();
  });
  it('форматирует строку (без возраста)', () => {
    const rows = [
      { entityId: 'e1', name: 'Папа', importance: 9, daysUntil: 1, age: 4 },
      { entityId: 'e2', name: 'Бабушка', importance: 7, daysUntil: 5, age: null },
    ];
    expect(formatMemorialSection(rows)).toBe('День памяти: Папа — завтра; Бабушка — через 5 дн.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/services/birthday/types.test.ts -t "pickDeathDate"`
Expected: FAIL — `pickDeathDate is not a function`.

- [ ] **Step 3: Write minimal implementation**

В `src/services/birthday/types.ts`, в КОНЕЦ файла, добавь:

```ts
// Память: capture-extractor пишет имя ключа свободно — читаем терпимо.
const DEATH_DATE_KEYS = ['death_date', 'deathDate', 'died', 'date_of_death', 'memorial_date'];

export function pickDeathDate(attrs: Record<string, unknown>): unknown {
  for (const k of DEATH_DATE_KEYS) {
    const v = attrs[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export function formatMemorialSection(rows: UpcomingBirthday[]): string | null {
  if (!rows || rows.length === 0) return null;
  const parts = rows.map((r) => `${r.name} — ${whenLabel(r.daysUntil)}`);
  return `День памяти: ${parts.join('; ')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/services/birthday/types.test.ts`
Expected: PASS (все группы, включая старые). Затем `npx tsc --noEmit` — чисто.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/birthday/types.ts packages/server/src/services/birthday/types.test.ts
git commit -F - <<'EOF'
feat(memorial): pure helpers pickDeathDate + formatMemorialSection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Read-only гейтер — `listMemorials` / `buildUpcomingMemorials` / `buildMemorialSection`

**Files:**
- Modify: `src/services/birthday/birthday.ts`
- Modify: `src/services/birthday/index.ts`

(Поведение проверяется в Task 5 на тест-БД; тут код + tsc.)

- [ ] **Step 1: Add implementation to `birthday.ts`**

В `src/services/birthday/birthday.ts`:
1. Расширь импорт из `./types.js` — добавь `pickDeathDate`, `formatMemorialSection`:
   ```ts
   import {
     parseBirthday,
     upcomingBirthdays,
     formatBirthdaySection,
     pickDeathDate,
     formatMemorialSection,
     type PersonBirthdayRow,
     type UpcomingBirthday,
   } from './types.js';
   ```
2. В КОНЕЦ файла добавь:
   ```ts
   /**
    * Память дней памяти — read-only. Читает person-сущности с любым ключом
    * даты смерти (capture-extractor пишет имя ключа свободно). Никаких записей.
    */
   export async function listMemorials(userId: string): Promise<PersonBirthdayRow[]> {
     const rows = await prisma.entity.findMany({
       where: { userId, type: 'person' },
       select: { id: true, name: true, importance: true, attributes: true },
     });
     const out: PersonBirthdayRow[] = [];
     for (const r of rows) {
       const attrs = (r.attributes ?? {}) as Record<string, unknown>;
       const bday = parseBirthday(pickDeathDate(attrs));
       if (!bday) continue;
       out.push({ entityId: r.id, name: r.name, importance: r.importance, birthday: bday });
     }
     return out;
   }

   /** Ближайшие дни памяти в окне windowDays (для детектора и enrichment). */
   export async function buildUpcomingMemorials(
     userId: string,
     now: Date,
     windowDays: number,
   ): Promise<UpcomingBirthday[]> {
     const persons = await listMemorials(userId);
     return upcomingBirthdays(persons, now, windowDays);
   }

   /** Enrichment-секция «День памяти: …» (окно 7 дней) или null. */
   export async function buildMemorialSection(userId: string): Promise<string | null> {
     const rows = await buildUpcomingMemorials(userId, new Date(), 7);
     return formatMemorialSection(rows);
   }
   ```

- [ ] **Step 2: Export from `index.ts`**

В `src/services/birthday/index.ts` дополни строку экспорта функций:
```ts
export {
  listPersonBirthdays,
  buildUpcomingBirthdays,
  buildBirthdaySection,
  listMemorials,
  buildUpcomingMemorials,
  buildMemorialSection,
} from './birthday.js';
```

- [ ] **Step 3: Verify tsc**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/birthday/birthday.ts packages/server/src/services/birthday/index.ts
git commit -F - <<'EOF'
feat(memorial): read-only gatherer listMemorials/upcoming/section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Детектор `detectMemorial`

**Files:**
- Modify: `src/services/v2-proactivity-engine.ts`
- Modify: `src/services/v2-proactivity-engine.test.ts`

Порядок: union → TEMPLATES → scoreSignificance заставят tsc ругаться, пока не добавишь все три (total Record + switch без default) — это страховка exhaustiveness.

- [ ] **Step 1: Add to `NudgeSource` union**

В `src/services/v2-proactivity-engine.ts` после `| 'birthday_upcoming';` сделай:
```ts
  | 'birthday_upcoming'
  | 'memorial_upcoming';
```

- [ ] **Step 2: Add `TEMPLATES` entry**

В объект `TEMPLATES` после `birthday_upcoming` добавь (ТОЛЬКО тёплые тона, без celebratory):
```ts
  memorial_upcoming: {
    gentle: '{{whenLabel}} день памяти — {{name}}. Если нужно, я рядом. 🤍',
    supportive: '{{whenLabel}} день памяти — {{name}}. Береги себя сегодня.',
  },
```

- [ ] **Step 3: Add `scoreSignificance` case**

В `switch (c.source)` функции `scoreSignificance` после кейса `birthday_upcoming` добавь:
```ts
    case 'memorial_upcoming': {
      // День памяти — стабильно значим (≥0.6 floor gate3, чтобы доходил).
      return 0.7;
    }
```

- [ ] **Step 4: Verify tsc passes after 1-3**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто (union+TEMPLATES+score согласованы).

- [ ] **Step 5: Extend birthday import + write `detectMemorial`**

1. Расширь существующий импорт (строка ~235) — добавь `buildUpcomingMemorials`:
   ```ts
   import { buildUpcomingBirthdays, buildUpcomingMemorials, whenLabel, ageSuffix } from './birthday/index.js';
   ```
2. Сразу ПОСЛЕ функции `detectBirthday` (после её закрывающей `}`) добавь:
   ```ts
   /**
    * День памяти (мост #2): человек с death_date сегодня/завтра → бережный
    * нудж. READ-ONLY. Флаг-гейт ранний (off=identical). Тон всегда supportive —
    * generateNudge берёт фиксированный шаблон (без стиль-rewrite), токсичный
    * стиль недостижим.
    */
   async function detectMemorial(userId: string): Promise<NudgeCandidate[]> {
     try {
       const { isV2BirthdayEnabled } = await import('../lib/feature-flags.js');
       if (!isV2BirthdayEnabled(userId)) return [];
       const rows = await buildUpcomingMemorials(userId, new Date(), 1); // окно: сегодня + завтра
       const out: NudgeCandidate[] = [];
       for (const r of rows) {
         const cand: NudgeCandidate = {
           source: 'memorial_upcoming',
           significance: 0,
           entityId: r.entityId,
           payload: {
             name: r.name,
             daysUntil: r.daysUntil,
             whenLabel: whenLabel(r.daysUntil),
           },
           toneHint: 'supportive',
         };
         cand.significance = scoreSignificance(cand);
         out.push(cand);
       }
       return out;
     } catch (err) {
       console.warn('[v2-proactivity] detectMemorial failed:', err);
       return [];
     }
   }
   ```

- [ ] **Step 6: Register in `detectCandidates`**

В `Promise.allSettled([ ... ])` внутри `detectCandidates` после строки `detectBirthday(userId),` добавь:
```ts
      detectMemorial(userId),
```

- [ ] **Step 7: Update exhaustiveness test (red → green)**

В `src/services/v2-proactivity-engine.test.ts`, тест `'covers all known sources'` — в отсортированный список TEMPLATES-ключей добавь `'memorial_upcoming'`:
```ts
        'mood_shift',
        'memorial_upcoming',
        'obligation_due',
```
(вставь так, чтобы массив остался валидным; `.sort()` в тесте нормализует порядок — достаточно чтобы элемент присутствовал.)

- [ ] **Step 8: Run engine tests + tsc**

Run: `cd packages/server && npx vitest run src/services/v2-proactivity-engine.test.ts && npx tsc --noEmit`
Expected: PASS (включая 'covers all known sources'); tsc чисто.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -F - <<'EOF'
feat(memorial): detectMemorial proactivity detector (supportive, window 1d)

union + TEMPLATES (warm only) + scoreSignificance + register + exhaustiveness.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Enrichment-врезка `memorials`

**Files:**
- Modify: `src/services/v2-enrichment.ts`

**КРИТИЧНО:** позиционное соответствие массива `Promise.all` и деструктуризации — `memorials` ДОЛЖЕН быть последним и там, и там (тот же риск, что был с `birthdays`).

- [ ] **Step 1: Add import**

Рядом с `import { buildBirthdaySection } from './birthday/index.js';` дополни:
```ts
import { buildBirthdaySection, buildMemorialSection } from './birthday/index.js';
```
(если `buildBirthdaySection` импортируется отдельной строкой — объедини в одну.)

- [ ] **Step 2: Add field to `V2EnrichmentData`**

После `birthdays: string | null;` добавь:
```ts
  /** Память дней памяти (мост #2): «День памяти: …» или null. */
  memorials: string | null;
```

- [ ] **Step 3: Push in `buildV2EnrichmentBlock`**

После строки `if (data.birthdays) lines.push(data.birthdays);` добавь:
```ts
  if (data.memorials) lines.push(data.memorials);
```

- [ ] **Step 4: Gather in the Promise.all**

В функции-гейтере (`const [identity, ..., decisions, birthdays] = await Promise.all([...])`):
1. Деструктуризация — добавь `memorials` ПОСЛЕ `birthdays`:
   `..., decisions, birthdays, memorials] = await Promise.all([`
2. В КОНЕЦ массива (после элемента `birthdays`) добавь элемент:
   ```ts
         isV2BirthdayEnabled(userId)
           ? withTimeout(buildMemorialSection(userId), CROSS_DOMAIN_BUDGET_MS, null).catch(() => null)
           : Promise.resolve(null),
   ```
3. В объект `data` после `birthdays,` добавь `memorials,`.

- [ ] **Step 5: Verify tsc + enrichment tests**

Run: `cd packages/server && npx tsc --noEmit && npx vitest run src/services/v2-enrichment.test.ts`
Expected: tsc чисто; enrichment-тесты зелёные. Перепроверь глазами, что `memorials` стоит последним в массиве И в деструктуризации (позиции совпадают).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/v2-enrichment.ts
git commit -F - <<'EOF'
feat(memorial): enrichment section «День памяти» (flag-gated, window 7d)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Поведенческий + tone-safety + структурный тесты + verify

**Files:**
- Modify: `src/services/birthday/birthday.it.test.ts`
- Modify: `src/services/v2-proactivity-engine.test.ts`
- Modify: `src/services/birthday/birthday-wiring.test.ts`

- [ ] **Step 1: Behavioral memorial test (тест-БД)**

В `src/services/birthday/birthday.it.test.ts` допиши импорт `buildUpcomingMemorials` в существующий import из `./index.js`, и добавь блок:

```ts
describe('memorial: день памяти (тест-БД)', () => {
  it('buildUpcomingMemorials читает death_date и ловит за день', async () => {
    const userId = await seedUser(`mem-a-${Date.now()}@a.test`);
    await getEntityGraph().upsertEntity(userId, {
      type: 'person', name: 'Папа',
      attributes: { death_date: '10 августа 2021', relationship: 'отец' } as never,
      importance: 9,
    });
    const win1 = await buildUpcomingMemorials(userId, new Date('2026-08-09T00:00:00Z'), 1);
    expect(win1.map((r) => r.name)).toEqual(['Папа']);
    expect(win1[0].daysUntil).toBe(1);
  });

  it('альт-ключ deathDate тоже читается', async () => {
    const userId = await seedUser(`mem-b-${Date.now()}@a.test`);
    await getEntityGraph().upsertEntity(userId, {
      type: 'person', name: 'Бабушка',
      attributes: { deathDate: '10 августа 2018' } as never, importance: 6,
    });
    const win1 = await buildUpcomingMemorials(userId, new Date('2026-08-09T00:00:00Z'), 1);
    expect(win1.map((r) => r.name)).toEqual(['Бабушка']);
  });

  it('дальняя дата вне окна 7; cross-user изоляция', async () => {
    const a = await seedUser(`mem-c1-${Date.now()}@a.test`);
    const b = await seedUser(`mem-c2-${Date.now()}@a.test`);
    await getEntityGraph().upsertEntity(a, {
      type: 'person', name: 'Папа',
      attributes: { death_date: '10 августа 2021' } as never, importance: 9,
    });
    // now=июнь → 10 авг далеко (>7)
    expect(await buildUpcomingMemorials(a, new Date('2026-06-05T00:00:00Z'), 7)).toEqual([]);
    // user B не видит memorial из A
    expect(await buildUpcomingMemorials(b, new Date('2026-08-09T00:00:00Z'), 1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run behavioral (needs test DB)**

Run: `cd packages/server && npm run test:db:up && npx vitest run src/services/birthday/birthday.it.test.ts --project integration`
Expected: PASS (старые birthday-кейсы + 3 новых memorial).

- [ ] **Step 3: Tone-safety behavioral test**

В `src/services/v2-proactivity-engine.test.ts` добавь импорт класса (в существующий import из `./v2-proactivity-engine.js`): `V2ProactivityEngine`. Затем блок:

```ts
describe('memorial tone-safety (generateNudge детерминирован, без стиля)', () => {
  it('supportive memorial → дословный тёплый шаблон (haiku/стиль не вызываются)', async () => {
    const engine = new V2ProactivityEngine();
    const msg = await engine.generateNudge('u1', {
      source: 'memorial_upcoming',
      significance: 0.7,
      entityId: 'e1',
      payload: { name: 'Папа', daysUntil: 1, whenLabel: 'завтра' },
      toneHint: 'supportive',
    });
    expect(msg).toBe('завтра день памяти — Папа. Береги себя сегодня.');
  });
});
```

- [ ] **Step 4: Run tone test**

Run: `cd packages/server && npx vitest run src/services/v2-proactivity-engine.test.ts -t "tone-safety"`
Expected: PASS (template-path возвращает interpolate, без I/O).

- [ ] **Step 5: Structural memorial test**

В `src/services/birthday/birthday-wiring.test.ts` добавь блок (переменные `ENGINE`, `ENRICH` уже определены в файле через readFileSync):

```ts
describe('memorial wiring (structural)', () => {
  it('memorial_upcoming в NudgeSource + TEMPLATES + score + detectCandidates', () => {
    expect(ENGINE).toMatch(/'memorial_upcoming'/);
    expect(ENGINE).toMatch(/memorial_upcoming:\s*{/);
    expect(ENGINE).toMatch(/case 'memorial_upcoming':/);
    expect(ENGINE).toMatch(/detectMemorial\(userId\)/);
  });
  it('detectMemorial имеет ранний флаг-гейт (off=identical)', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('async function detectMemorial'));
    expect(fn).toMatch(/if\s*\(!isV2BirthdayEnabled\(userId\)\)\s*return\s*\[\]/);
  });
  it('тон мемориала тёплый: нет поздравлений/celebratory, есть память/рядом/береги', () => {
    const block = ENGINE.slice(ENGINE.indexOf('memorial_upcoming:'), ENGINE.indexOf('memorial_upcoming:') + 300);
    expect(block).not.toMatch(/поздравишь|celebratory/i);
    expect(block).toMatch(/память/);
    expect(block).toMatch(/рядом|береги/);
  });
  it('enrichment-врезка memorials за флагом', () => {
    expect(ENRICH).toMatch(/memorials:\s*string\s*\|\s*null/);
    expect(ENRICH).toMatch(/buildMemorialSection\(userId\)/);
    expect(ENRICH).toMatch(/if\s*\(data\.memorials\)/);
  });
  it('money-safety: birthday.ts (memorial-чтение) без prisma write', () => {
    // GATHER уже прочитан в birthday-wiring; повторно не объявляем.
    expect(GATHER).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|updateMany|deleteMany|createMany)/);
  });
});
```

> Примечание: если константы `ENGINE`/`ENRICH`/`GATHER` ещё не объявлены в этом файле — добавь их рядом с прочими `readFileSync` в шапке (ENGINE = v2-proactivity-engine.ts, ENRICH = v2-enrichment.ts, GATHER = birthday.ts). В версии файла из birthday-фичи `ENGINE`, `ENRICH`, `GATHER` уже есть — переиспользуй.

- [ ] **Step 6: Full suite + tsc**

Run: `cd packages/server && npx tsc --noEmit && npx vitest run`
Expected: tsc чисто; вся unit-сюита зелёная (~2477 + новые). Integration отдельно (`npm run test:it`).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/birthday/birthday.it.test.ts packages/server/src/services/v2-proactivity-engine.test.ts packages/server/src/services/birthday/birthday-wiring.test.ts
git commit -F - <<'EOF'
test(memorial): behavioral (.it) + tone-safety + structural wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 8: Independent review**

Дispatch независимое ревью (агент `pr-review-toolkit:code-reviewer`) на весь дифф фичи. Фокус: off=байт-идентично (флаг-гейт detectMemorial + enrichment ветка), money-safety (ноль write), tone-safety (supportive-шаблон детерминирован, токсичный стиль недостижим), позиционное соответствие enrichment Promise.all/деструктуризации, отсутствие дублирования с detectBirthday. Исправь замечания, перепрогони сюиту.

- [ ] **Step 9 (ПОСЛЕ деплоя, по слову Berik): реальная прод-проверка end-to-end**

Read-only диагностика (скрипт ВНУТРИ `packages/server`, `node --env-file=.env`, УДАЛИТЬ сразу, НЕ коммитить):
```js
import { PrismaClient } from '@prisma/client';
import { buildUpcomingMemorials } from './dist/services/birthday/index.js';
// если dist нет — реплицируй: findMany Папы, pickDeathDate, parseBirthday, daysUntilBirthday(new Date('2026-08-09'))
const rows = await buildUpcomingMemorials('cmp6n0jf90000pf017gv1kukz', new Date('2026-08-09'), 1);
console.log(rows); // ожидаем [{name:'Папа', daysUntil:1, ...}]
```
Ожидаемо: вернёт Папу с daysUntil=1 — доказывает end-to-end на реальных данных ДО 9 августа (настоящий путь, не только unit).

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:**
- pickDeathDate (multi-key) + formatMemorialSection → Task 1. ✓
- listMemorials/buildUpcomingMemorials/buildMemorialSection (read-only) → Task 2. ✓
- detectMemorial + union/TEMPLATES(warm)/score/register/exhaustiveness → Task 3. ✓
- enrichment врезка (позиционно) → Task 4. ✓
- tone-safety поведенческий + структурный + money-safety + behavioral .it → Task 5. ✓
- реальная прод-проверка → Task 5 Step 9. ✓
- флаг реюз isV2BirthdayEnabled, off=identical → Task 3 (ранний гейт) + Task 4 (флаг-ветка). ✓

**2. Placeholder scan:** Нет TBD/TODO. Все шаги с кодом содержат код. «Досверь grep'ом» — только про существующие константы ENGINE/ENRICH/GATHER в birthday-wiring (интеграция в чужой тест-файл), не плейсхолдер логики.

**3. Type consistency:** `pickDeathDate(attrs):unknown`, `formatMemorialSection(rows:UpcomingBirthday[]):string|null`, `listMemorials→PersonBirthdayRow[]`, `buildUpcomingMemorials(userId,now,windowDays)→UpcomingBirthday[]`. payload-ключи детектора (`name`,`daysUntil`,`whenLabel`) совпадают с плейсхолдерами TEMPLATES (`{{name}}`,`{{whenLabel}}`) — `interpolate` подставляет по ключам. Поле `memorials:string|null` согласовано в типе, деструктуризации, массиве, data, push. scoreSignificance возвращает number для memorial_upcoming (switch без default — exhaustiveness форсирован).
