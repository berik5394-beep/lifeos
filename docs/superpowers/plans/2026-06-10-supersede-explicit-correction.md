# F2 Explicit-Correction Supersede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Явная коррекция («бросил кофе») инвалидирует старую противоречащую память (обратимо) за флагом `FEATURE_V2_SUPERSEDE`, off=байт-идентично.

**Architecture:** `extractFromChat` (флаг) эмитит `supersedesTopic`; `captureInBackground` после writeMemory ищет ЕДИНСТВЕННУЮ сильную same-type память по топику и зовёт `invalidateEvent`. Читатель чтит `invalidAt` (F3).

**Спека:** `docs/superpowers/specs/2026-06-10-supersede-explicit-correction-design.md`.

**Tech:** Fastify+Prisma6+Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`. MAIN worktree `/Users/berikkurmangoliev/Desktop/LifeOS` (проверь `git -C … rev-parse --abbrev-ref HEAD`→`main`). Коммит-на-шаг trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. push/deploy/флаг — по слову Berik.

**⚠️ Риск-принцип:** баг = спрятать правду. Single-match-или-скип; обратимо (invalidAt).

---

### Task 1: Flag `isV2SupersedeEnabled`
**Files:** `src/lib/feature-flags.ts` (+ `.test.ts`)
- [ ] **S1 failing test** — в `feature-flags.test.ts` (рядом с `isV2MemGraphEnabled`):
```ts
import { isV2SupersedeEnabled } from './feature-flags.js';
describe('isV2SupersedeEnabled', () => {
  const KEY = 'FEATURE_V2_SUPERSEDE'; const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });
  it('all→true', () => { process.env[KEY] = 'all'; expect(isV2SupersedeEnabled('u')).toBe(true); });
  it('unset/none/empty→false', () => { delete process.env[KEY]; expect(isV2SupersedeEnabled('u')).toBe(false); process.env[KEY]='none'; expect(isV2SupersedeEnabled('u')).toBe(false); process.env[KEY]=''; expect(isV2SupersedeEnabled('u')).toBe(false); });
  it('csv', () => { process.env[KEY]='user-abc'; expect(isV2SupersedeEnabled('abc')).toBe(true); expect(isV2SupersedeEnabled('z')).toBe(false); });
});
```
- [ ] **S2 run FAIL** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/lib/feature-flags.test.ts`
- [ ] **S3 impl** — рядом с `isV2MemGraphEnabled`:
```ts
/**
 * F2 явная коррекция: при ЯВНОЙ отмене факта инвалидируем старую противоречащую
 * память (обратимо). OFF → детект выключен + шаг инвалидации выключен → identical.
 */
export function isV2SupersedeEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_SUPERSEDE, userId);
}
```
- [ ] **S4 run PASS + tsc** `… && npx vitest run --project unit src/lib/feature-flags.test.ts && npx tsc --noEmit`
- [ ] **S5 commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): isV2SupersedeEnabled flag (F2, off=identical)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `extractFromChat` — supersede detection
**Files:** `src/services/dictation-service.ts`; `src/services/mem-supersede-wiring.test.ts` (create)
- [ ] **S1 failing test** — создать `mem-supersede-wiring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dict = readFileSync(join(process.cwd(), 'src/services/dictation-service.ts'), 'utf8');

describe('F2 — extractFromChat supersede detection', () => {
  it('ExtractedMemory имеет supersedesTopic?', () => {
    expect(dict).toMatch(/supersedesTopic\?\s*:\s*string/);
  });
  it('extractFromChat принимает opts.detectSupersede', () => {
    expect(dict).toMatch(/detectSupersede\?\s*:\s*boolean/);
  });
  it('промпт supersede за флагом + правило «сомнение → НЕ добавляй»', () => {
    expect(dict).toContain('supersedesTopic');
    expect(dict).toMatch(/Сомнение.*НЕ добавляй|ЯВНОМ сигнале/);
  });
});
```
- [ ] **S2 run FAIL** `… && npx vitest run --project unit src/services/mem-supersede-wiring.test.ts`
- [ ] **S3 impl**
  - В `interface ExtractedMemory` (dictation-service.ts) добавить:
  ```ts
    /** F2: если ЯВНАЯ коррекция прежнего факта — короткий топик для ретайра
     *  старой памяти («кофе», «город», «работа в X»). Иначе отсутствует. */
    supersedesTopic?: string;
  ```
  - В `extractFromChat` сигнатуру дополнить 3-м параметром `opts?: { detectSupersede?: boolean }`.
  - В теле, ПЕРЕД формированием финального `systemPrompt`, собрать блок и добавить его к промпту ТОЛЬКО при `opts?.detectSupersede`. Конкретно: после существующего `const systemPrompt = \`…\`;` добавить:
  ```ts
  const supersedeBlock = opts?.detectSupersede
    ? `\n\nЯВНАЯ КОРРЕКЦИЯ (supersedesTopic): если пользователь ПРЯМО отменяет/меняет прежний факт о себе — глаголами «бросил / больше не / уже не / перестал / развёлся / переехал / раньше… теперь» — у соответствующей memory добавь поле "supersedesTopic": короткий ТОПИК (1-2 слова: «кофе», «город проживания», «работа в X») для поиска старой записи, НЕ полную фразу. Только при ЯВНОМ сигнале отмены. Сомнение / обычное утверждение → НЕ добавляй supersedesTopic.`
    : '';
  ```
  и в `anthropic.messages.create({ … system: systemPrompt + supersedeBlock, … })`.
  (Если структура `extractFromChat` не позволяет — минимально: `const fullPrompt = systemPrompt + (opts?.detectSupersede ? supersedeBlock : '')` и передать `system: fullPrompt`. Парсер уже мапит `parsed.memories` — опц. `supersedesTopic` пройдёт.)
  OFF (`detectSupersede` ложно/нет) → `supersedeBlock=''` → промпт байт-идентичен прежнему.
- [ ] **S4 run PASS + tsc** `… && npx vitest run --project unit src/services/mem-supersede-wiring.test.ts && npx tsc --noEmit`
- [ ] **S5 commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/dictation-service.ts packages/server/src/services/mem-supersede-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): extractFromChat emits supersedesTopic on explicit correction (F2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `supersedeByTopic` + threshold
**Files:** `src/services/episodic-memory.ts`; дополнить `mem-supersede-wiring.test.ts`
- [ ] **S1 failing test** — добавить в `mem-supersede-wiring.test.ts`:
```ts
describe('F2 — supersedeByTopic', () => {
  const epi = readFileSync(join(process.cwd(), 'src/services/episodic-memory.ts'), 'utf8');
  it('экспортирует supersedeByTopic', () => { expect(epi).toMatch(/export async function supersedeByTopic\(/); });
  it('single-match-или-скип (strong.length !== 1 → null)', () => { expect(epi).toMatch(/strong\.length !== 1/); });
  it('зовёт invalidateEvent + лог SUPERSEDE', () => { expect(epi).toMatch(/invalidateEvent\(/); expect(epi).toContain('SUPERSEDE'); });
  it('константа SUPERSEDE_MIN_RANK', () => { expect(epi).toMatch(/SUPERSEDE_MIN_RANK\s*=/); });
});
```
- [ ] **S2 run FAIL** `… && npx vitest run --project unit src/services/mem-supersede-wiring.test.ts`
- [ ] **S3 impl** — в `episodic-memory.ts` (рядом с `invalidateEvent`, использует `prisma` + `invalidateEvent` из этого файла):
```ts
/** F2 floor: топик-матч обычно одно-токенный (≈0.06). Главная защита —
 *  единственный-сильный-матч; порог лишь отсекает near-zero шум. КАЛИБРУЕТСЯ (Task 5). */
const SUPERSEDE_MIN_RANK = 0.03;

/**
 * F2 явная коррекция: найти ЕДИНСТВЕННУЮ сильную same-type не-инвалидированную
 * память по топику и инвалидировать (обратимо). 0 / >1 / слабый → null (НЕ прячем).
 */
export async function supersedeByTopic(
  userId: string,
  type: string,
  topic: string,
  excludeId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; rank: number }>>`
    SELECT m.id,
      ts_rank(to_tsvector('russian', coalesce(m.content, '')), plainto_tsquery('russian', ${topic})) AS rank
    FROM "Memory" m
    WHERE m."userId" = ${userId} AND m.type = ${type} AND m.id <> ${excludeId}
      AND m."invalidAt" IS NULL
      AND to_tsvector('russian', coalesce(m.content, '')) @@ plainto_tsquery('russian', ${topic})
    ORDER BY rank DESC
    LIMIT 3;`;
  const strong = rows.filter((r) => r.rank >= SUPERSEDE_MIN_RANK);
  if (strong.length !== 1) return null;
  await invalidateEvent(strong[0].id);
  console.warn(`[memory] SUPERSEDE type=${type} topic="${topic}" invalidated=${strong[0].id} (user=${userId})`);
  return strong[0].id;
}
```
- [ ] **S4 run PASS + tsc** `… && npx vitest run --project unit src/services/mem-supersede-wiring.test.ts && npx tsc --noEmit`
- [ ] **S5 commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/episodic-memory.ts packages/server/src/services/mem-supersede-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): supersedeByTopic single-match invalidation (F2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: wire into `captureInBackground` (CRITICAL prod chat path)
**Files:** `src/services/jarvis-orchestrator.ts`; дополнить `mem-supersede-wiring.test.ts`
- [ ] **S1 failing test** — добавить:
```ts
describe('F2 — captureInBackground wiring', () => {
  const orch = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf8');
  it('передаёт detectSupersede в extractFromChat', () => { expect(orch).toMatch(/extractFromChat\([^)]*detectSupersede/s); });
  it('supersede-шаг за флагом + supersedesTopic', () => {
    expect(orch).toMatch(/isV2SupersedeEnabled\(userId\)/);
    expect(orch).toMatch(/supersedeByTopic\(/);
    expect(orch).toMatch(/m\.supersedesTopic/);
  });
});
```
- [ ] **S2 run FAIL** `… && npx vitest run --project unit src/services/mem-supersede-wiring.test.ts`
- [ ] **S3 impl**
  - Импорты: `isV2SupersedeEnabled` к импорту из `'../lib/feature-flags.js'`; `supersedeByTopic` к импорту из `'./episodic-memory.js'` (там уже `writeMemory`); `extractFromChat` уже импортирован.
  - Вызов `extractFromChat(text, user?.name || 'друг')` (внутри `captureInBackground`, в ветке `isV2MemQualityEnabled ? extractFromChat(...)`) → добавить 3-й аргумент: `extractFromChat(text, user?.name || 'друг', { detectSupersede: isV2SupersedeEnabled(userId) })`.
  - Цикл записи памяти (≈:196-208) — захватить результат + supersede-шаг. Заменить:
  ```ts
  for (const m of extracted.memories) {
    await writeMemory(userId, { type: m.type, content: m.content, details: m.details ?? null, source: 'chat', tags: m.tags, importance: m.importance });
    memories++;
  }
  ```
  на:
  ```ts
  for (const m of extracted.memories) {
    const r = await writeMemory(userId, { type: m.type, content: m.content, details: m.details ?? null, source: 'chat', tags: m.tags, importance: m.importance });
    memories++;
    if (isV2SupersedeEnabled(userId) && m.supersedesTopic && r.action !== 'skipped') {
      await supersedeByTopic(userId, m.type, m.supersedesTopic, r.id).catch(() => null);
    }
  }
  ```
  OFF → `m.supersedesTopic` не эмитится (промпт off) И гейт `isV2SupersedeEnabled` ложен → DB идентично.
- [ ] **S4 run целевой + ПОЛНЫЙ unit + tsc** `… && npx vitest run --project unit src/services/mem-supersede-wiring.test.ts && npm test && npx tsc --noEmit` — полный suite зелёный.
- [ ] **S5 commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/jarvis-orchestrator.ts packages/server/src/services/mem-supersede-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): wire supersedeByTopic into captureInBackground behind flag (F2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Integration tests + threshold calibration
**Files:** `src/services/mem-supersede.it.test.ts` (create)
- [ ] **S1 calibrate** — измерить `ts_rank` на тест-БД (throwaway tsx, как делали для дедупа; УДАЛИТЬ после). Кейсы: `'кофе'` vs `'люблю кофе'`, `'кофе'` vs `'обожаю кофе по утрам'`, `'город'` vs `'живу в Алматы'`. Цель: подтвердить, что легит топик-матч ≥ `SUPERSEDE_MIN_RANK` (0.03). Если измеренный топик-матч НИЖЕ 0.03 — опустить порог (но >0); если есть near-zero шум выше — обсудить. Зафиксировать измеренные числа в комментарии к `SUPERSEDE_MIN_RANK`.
- [ ] **S2 it tests** — `npm run test:db:up` затем создать `mem-supersede.it.test.ts` (образец harness — `mem-graph.it.test.ts`: own PrismaClient, mkUser, restore флага):
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { writeMemory, supersedeByTopic } from './episodic-memory.js';
import { getRelevantMemories } from './memory-service.js';

const prisma = new PrismaClient();
const PREV = process.env.FEATURE_V2_FORGET;
afterAll(async () => { if (PREV === undefined) delete process.env.FEATURE_V2_FORGET; else process.env.FEATURE_V2_FORGET = PREV; await prisma.$disconnect(); });
async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({ data: { email: `it-supers-${tag}@it.local`, name: 'IT', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

describe('F2 — supersedeByTopic invalidates single match', () => {
  it('коррекция инвалидирует старый факт; recall (FORGET) его не отдаёт', async () => {
    process.env.FEATURE_V2_FORGET = 'all';
    const uid = await mkUser(`one-${Date.now()}`);
    const old = await writeMemory(uid, { type: 'preference', content: 'люблю кофе', importance: 6 });
    const neu = await writeMemory(uid, { type: 'preference', content: 'бросил кофе', importance: 6 });
    const invalidated = await supersedeByTopic(uid, 'preference', 'кофе', neu.id);
    expect(invalidated).toBe(old.id);
    const row = await prisma.memory.findUnique({ where: { id: old.id } });
    expect(row!.invalidAt).not.toBeNull();
    const recall = await getRelevantMemories(uid, 'кофе', 20);
    expect(recall.some((r) => r.id === old.id)).toBe(false); // вне recall
  });
});

describe('F2 — неоднозначность → скип (не прячем не ту)', () => {
  it('два кофе-факта → supersedeByTopic null, обе живы', async () => {
    const uid = await mkUser(`amb-${Date.now()}`);
    const a = await writeMemory(uid, { type: 'preference', content: 'люблю кофе', importance: 6 });
    const b = await writeMemory(uid, { type: 'preference', content: 'кофе с молоком вкусный', importance: 6 });
    const neu = await writeMemory(uid, { type: 'preference', content: 'бросил кофе', importance: 6 });
    const invalidated = await supersedeByTopic(uid, 'preference', 'кофе', neu.id);
    expect(invalidated).toBeNull();
    const ra = await prisma.memory.findUnique({ where: { id: a.id } });
    const rb = await prisma.memory.findUnique({ where: { id: b.id } });
    expect(ra!.invalidAt).toBeNull(); expect(rb!.invalidAt).toBeNull();
  });
});

describe('F2 — cross-user изоляция', () => {
  it('не трогает чужую память', async () => {
    const u1 = await mkUser(`x1-${Date.now()}`);
    await writeMemory(u1, { type: 'preference', content: 'люблю кофе', importance: 6 });
    const out = await supersedeByTopic('someone-else-xyz', 'preference', 'кофе', 'no-id');
    expect(out).toBeNull();
  });
});
```
> Замечания: дедуп STABLE_TYPES — `preference` дедупится; «люблю кофе» и «бросил кофе» по plainto('бросил кофе') НЕ матчатся (разные токены кроме коф… на самом деле `@@` требует ВСЕ токены нового в старом — «бросил кофе» против «люблю кофе»: старая не имеет «брос» → не дедупится → 2 строки). Проверь по факту, что `neu.id` ≠ `old.id` (новая — отдельная строка). Если дедуп всё же слил — подбери content так, чтобы новый факт был отдельной строкой, сохраняя топик «кофе».
- [ ] **S3 run** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm run test:db:up && npx vitest run --project integration src/services/mem-supersede.it.test.ts` — 3 PASS. Красное → Phase-1 debug (тест/сетап/калибровка, не прод-логику без root-cause).
- [ ] **S4 commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/mem-supersede.it.test.ts packages/server/src/services/episodic-memory.ts && git commit -m "$(cat <<'EOF'
test(memory): F2 supersede it — single-match invalidate, ambiguity skip, cross-user

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full verify + independent review
- [ ] **S1** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm test && npx tsc --noEmit` — ~2652+ unit зелёных.
- [ ] **S2** `npm run test:it` — зелёно (вкл. новый it).
- [ ] **S3 OFF-идентичность** — diff: extractFromChat off → `supersedeBlock=''`; captureInBackground supersede-шаг за `isV2SupersedeEnabled`. Перечитать.
- [ ] **S4 независимое ревью** (code-reviewer субагент). Фокус: off=байт-идентично; **single-match-или-скип реально гарантирует «не прячем не ту»**; обратимость (invalidAt не delete); промпт консервативен («сомнение → НЕ»); supersede best-effort вне критич. пути; cross-user; нет `any`/ESM/`vi.mock`; threshold откалиброван (не угадан).
- [ ] **S5 fix findings + commit** (если есть).
- [ ] **S6 СТОП** — доложить Berik. Не пушить. Предложить push+deploy+`FEATURE_V2_SUPERSEDE=all` по слову.

---

## Self-Review
- **Покрытие спеки:** флаг (T1), детект (T2), инвалидация (T3), врезка (T4), it+калибровка (T5), verify (T6). Все юниты покрыты.
- **Заглушки:** код полный; команды точные; «свериться с образцом» (it-harness, дедуп-поведение content) — явная сверка с реальностью, не выдуманные символы.
- **Типы:** `supersedesTopic?:string` на `ExtractedMemory`; `opts?:{detectSupersede?:boolean}`; `supersedeByTopic(userId,type,topic,excludeId)→string|null`; `isV2SupersedeEnabled(userId)`.
- **Риск-гард:** single-match (`strong.length !== 1 → null`) + строгий floor + обратимость + лог. Скип при неоднозначности.

## Execution Handoff
Subagent-Driven (как раньше): свежий субагент на задачу, ревью между. push/deploy/флаг — по слову Berik.
