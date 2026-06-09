# Memory Tier-2 «Качество факт-памяти» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Починить весь конвейер факт-памяти — честный ввод (T4 консервативный чат-экстрактор + T3 диктовка через writeMemory), бережное обновление (T5 sparse-guard на details), значимое чтение (E2 ранжирование) — за одним флагом `FEATURE_V2_MEM_QUALITY`, off=байт-идентично.

**Architecture:** 4 точечных изменения в существующем конвейере памяти. Чистые хелперы (flag, mergeDetails, rankBySignificance) — первыми (юнит без БД), затем врезки за флагом в 4 точках, затем интеграция. Память best-effort — сбой никогда не роняет ответ.

**Tech Stack:** Fastify + Prisma6 + Postgres(+pgvector), ESM (`.js`-суффиксы), TS strict (no `any`), vitest (`npm test` = `vitest run --project unit`; `npm run test:it` = integration на тест-БД :5433), zero `vi.mock`, `createAnthropic()`.

**Спека (источник истины):** `docs/superpowers/specs/2026-06-09-memory-tier2-quality-design.md`.

**ВАЖНО — рабочее дерево:** все команды выполняются в **MAIN worktree** `/Users/berikkurmangoliev/Desktop/LifeOS` (ветка `main`). Проверка перед стартом: `git -C /Users/berikkurmangoliev/Desktop/LifeOS rev-parse --abbrev-ref HEAD` → должно быть `main`. Коммит-на-шаг; `push`/`deploy`/флаг — ТОЛЬКО по слову Berik.

---

## File Structure

| Файл | Ответственность | Создать/Изменить |
|------|-----------------|------------------|
| `packages/server/src/lib/feature-flags.ts` | `isV2MemQualityEnabled` | Изменить |
| `packages/server/src/lib/feature-flags.test.ts` | unit флага | Изменить |
| `packages/server/src/services/memory-service.ts` | `mergeDetails` pure (T5) | Изменить |
| `packages/server/src/services/memory-service.test.ts` | unit `mergeDetails` | Изменить |
| `packages/server/src/services/episodic-memory.ts` | `rankBySignificance` + `significantMemories` (E2); T5 врезка (:194) | Изменить |
| `packages/server/src/services/episodic-memory.test.ts` | unit `rankBySignificance` | Изменить |
| `packages/server/src/services/dictation-service.ts` | `extractFromChat` (T4); T3 врезка (writeMemory) | Изменить |
| `packages/server/src/services/jarvis-orchestrator.ts` | T4 врезка в `captureInBackground` **(CRITICAL прод-путь)** | Изменить |
| `packages/server/src/services/v2-enrichment.ts` | E2 врезка (:423) | Изменить |
| `packages/server/src/services/memory-tier2-wiring.test.ts` | структурный гард 4 врезок + промпт extractFromChat | Создать |
| `packages/server/src/services/memory-tier2.it.test.ts` | интеграция T3/T5/E2 + cross-user | Создать |

Порядок задач: чистые хелперы (1-4) → врезки за флагом (5-8) → интеграция (9) → verify+review (10).

---

### Task 1: Feature flag `isV2MemQualityEnabled`

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Test: `packages/server/src/lib/feature-flags.test.ts`

- [ ] **Step 1: Write the failing test** — добавить в `feature-flags.test.ts` (рядом с тестами `isV2AntiFabEnabled`):

```ts
import { isV2MemQualityEnabled } from './feature-flags.js';

describe('isV2MemQualityEnabled', () => {
  const KEY = 'FEATURE_V2_MEM_QUALITY';
  const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });

  it('all → true для любого юзера', () => {
    process.env[KEY] = 'all';
    expect(isV2MemQualityEnabled('user-x')).toBe(true);
  });
  it('unset/none/empty → false', () => {
    delete process.env[KEY];
    expect(isV2MemQualityEnabled('user-x')).toBe(false);
    process.env[KEY] = 'none';
    expect(isV2MemQualityEnabled('user-x')).toBe(false);
    process.env[KEY] = '';
    expect(isV2MemQualityEnabled('user-x')).toBe(false);
  });
  it('csv user-<id> → true только для совпадения', () => {
    process.env[KEY] = 'user-abc,user-def';
    expect(isV2MemQualityEnabled('abc')).toBe(true);
    expect(isV2MemQualityEnabled('zzz')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/lib/feature-flags.test.ts`
Expected: FAIL — `isV2MemQualityEnabled is not a function` / import error.

- [ ] **Step 3: Write minimal implementation** — в `feature-flags.ts` рядом с `isV2AntiFabEnabled` (тот же `isEnabledForUser`-паттерн):

```ts
/**
 * Tier-2 «качество факт-памяти» (T4+T3+T5+E2): консервативный чат-экстрактор,
 * диктовка через writeMemory, sparse-guard на details, ранжирование чтения по
 * значимости. OFF → всё байт-идентично прежнему поведению.
 */
export function isV2MemQualityEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MEM_QUALITY, userId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/lib/feature-flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): isV2MemQualityEnabled flag (Tier-2, off=identical)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `mergeDetails` pure helper (T5)

**Files:**
- Modify: `packages/server/src/services/memory-service.ts` (рядом с `shouldOverwriteContent`)
- Test: `packages/server/src/services/memory-service.test.ts`

- [ ] **Step 1: Write the failing test** — добавить в `memory-service.test.ts`:

```ts
import { mergeDetails } from './memory-service.js';

describe('mergeDetails (T5 sparse-guard на details)', () => {
  it('оба null → null', () => { expect(mergeDetails(null, null)).toBeNull(); });
  it('new null → старый сохраняется', () => {
    expect(mergeDetails('Серик — брат, познакомились в школе', null)).toBe('Серик — брат, познакомились в школе');
  });
  it('old null → берём новый', () => {
    expect(mergeDetails(null, 'новые детали')).toBe('новые детали');
  });
  it('оба есть, новый беднее (<70% длины) → оставляем старый', () => {
    const rich = 'Серик Жумабаев — брат, познакомились в школе в 2005';
    expect(mergeDetails(rich, 'Серик')).toBe(rich);
  });
  it('оба есть, новый богаче → берём новый', () => {
    const poor = 'Серик';
    const rich = 'Серик Жумабаев — брат, познакомились в школе';
    expect(mergeDetails(poor, rich)).toBe(rich);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-service.test.ts`
Expected: FAIL — `mergeDetails is not a function`.

- [ ] **Step 3: Write minimal implementation** — в `memory-service.ts` сразу после `shouldOverwriteContent`:

```ts
/**
 * Guard против sparse-overwrite для details (T5): бедный новый details не
 * затирает богатый старый. Зеркалит shouldOverwriteContent.
 *  - оба пусты → null
 *  - один пуст → другой
 *  - оба есть → более богатый (shouldOverwriteContent); сомнение → старый
 */
export function mergeDetails(
  oldDetails: string | null,
  newDetails: string | null,
): string | null {
  if (!newDetails) return oldDetails;
  if (!oldDetails) return newDetails;
  return shouldOverwriteContent(oldDetails, newDetails) ? newDetails : oldDetails;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/memory-service.ts packages/server/src/services/memory-service.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): mergeDetails sparse-guard pure helper (T5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `rankBySignificance` pure helper (E2)

**Files:**
- Modify: `packages/server/src/services/episodic-memory.ts` (рядом с `recentEvents`)
- Test: `packages/server/src/services/episodic-memory.test.ts`

- [ ] **Step 1: Write the failing test** — добавить в `episodic-memory.test.ts`:

```ts
import { rankBySignificance } from './episodic-memory.js';

describe('rankBySignificance (E2)', () => {
  const now = new Date('2026-06-09T12:00:00Z');
  const row = (id: string, importance: number, ageDays: number) => ({
    id, type: 'fact', content: id,
    createdAt: new Date(now.getTime() - ageDays * 86_400_000), importance,
  });

  it('важное старое обходит свежий пустяк', () => {
    const fresh = row('fresh', 3, 0);   // 3 + 2 = 5
    const oldImp = row('oldImp', 9, 30); // 9 + 0 = 9
    const out = rankBySignificance([fresh, oldImp], 6, now);
    expect(out[0].id).toBe('oldImp');
  });
  it('тай-брейк по свежести при равном скоре', () => {
    const a = row('a', 5, 1);  // 5 + 2 = 7
    const b = row('b', 7, 30); // 7 + 0 = 7
    const out = rankBySignificance([b, a], 6, now);
    expect(out[0].id).toBe('a'); // равный скор 7 → свежее впереди
  });
  it('limit усечение', () => {
    const rows = [row('a', 5, 0), row('b', 5, 1), row('c', 5, 2)];
    expect(rankBySignificance(rows, 2, now)).toHaveLength(2);
  });
  it('пустой вход → пусто', () => {
    expect(rankBySignificance([], 6, now)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/episodic-memory.test.ts`
Expected: FAIL — `rankBySignificance is not a function`.

- [ ] **Step 3: Write minimal implementation** — в `episodic-memory.ts` над `recentEvents`:

```ts
export type RankableMemory = {
  id: string; type: string; content: string; createdAt: Date; importance: number;
};

/** Pure: скор = importance + recency-бонус (≤2дн +2, ≤7дн +1); desc, тай-брейк по свежести. */
export function rankBySignificance<T extends RankableMemory>(
  rows: T[],
  limit: number,
  now: Date,
): T[] {
  const score = (r: T): number => {
    const ageDays = (now.getTime() - r.createdAt.getTime()) / 86_400_000;
    const recencyBonus = ageDays <= 2 ? 2 : ageDays <= 7 ? 1 : 0;
    return r.importance + recencyBonus;
  };
  return [...rows]
    .sort((a, b) => score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, Math.max(1, limit));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/episodic-memory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/episodic-memory.ts packages/server/src/services/episodic-memory.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): rankBySignificance pure helper (E2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `extractFromChat` консервативный экстрактор (T4)

**Files:**
- Modify: `packages/server/src/services/dictation-service.ts` (рядом с `extractFromTranscript`)
- Test: `packages/server/src/services/memory-tier2-wiring.test.ts` (создать)

- [ ] **Step 1: Write the failing test** — создать `memory-tier2-wiring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('T4 extractFromChat — консервативный промпт', () => {
  const f = src('./dictation-service.ts');
  it('экспортирует extractFromChat', () => {
    expect(f).toMatch(/export async function extractFromChat\(/);
  });
  it('промпт требует точность > полноты и «не извлекай при сомнении»', () => {
    expect(f).toContain('точность важнее полноты');
    expect(f).toMatch(/Сомневаешься\s*—\s*НЕ извлекай|не извлекай/i);
  });
  it('эмоции из чата НЕ извлекаются', () => {
    expect(f).toMatch(/эмоции\/настроение.*НЕ извлекаем вообще/s);
  });
  it('возвращает только tasks+memories (Pick), без фейкового summary', () => {
    expect(f).toMatch(/Pick<DictationExtraction, 'tasks' \| 'memories'>/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts`
Expected: FAIL — `extractFromChat` не найдена в исходнике.

- [ ] **Step 3: Write minimal implementation** — в `dictation-service.ts` сразу после `extractFromTranscript`:

```ts
/** T4: консервативный чат-экстрактор. Чат ≠ диктофон — «не уверен → молчим». */
export async function extractFromChat(
  text: string,
  userName: string,
): Promise<Pick<DictationExtraction, 'tasks' | 'memories'>> {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];

  const systemPrompt = `Ты — фоновый экстрактор памяти ассистента ${userName}. Пользователь написал тебе сообщение в ЧАТЕ (обычная переписка, не диктофон, не монолог). Извлеки ТОЛЬКО то, что действительно стоит запомнить надолго, и верни строгий JSON.

Текущая дата: ${today}. "завтра" = ${tomorrow}.

ГЛАВНОЕ ПРАВИЛО: точность важнее полноты. Сомневаешься — НЕ извлекай. Лучше пустой массив, чем выдуманный факт. Не достраивай, не предполагай, не «читай между строк».

Верни ТОЛЬКО валидный JSON без markdown:
{
  "tasks": [ { "title": "...", "date": "YYYY-MM-DD", "time": "HH:MM|null", "category": "work|personal|health|finance|education|home", "priority": "low|medium|high|critical", "notes": "опц." } ],
  "memories": [ { "type": "fact|decision|event|person|place|preference", "content": "короткая суть", "details": "опц.", "tags": ["..."], "importance": 4-10 } ]
}

МОЖНО в memories (только явное, прямо сказанное пользователем):
- fact — конкретный факт, прямо названный («У мамы день рождения 15 марта»)
- decision — принятое решение («Решил уволиться», «Договорились в субботу»)
- event — конкретное прошедшее событие («Был на встрече с инвестором»)
- person — человек, явно названный по имени с контекстом («Познакомился с Айгерим, она дизайнер»)
- place — конкретное место с контекстом («Хорошее кафе на Розыбакиева»)
- preference — устойчивое предпочтение, прямо высказанное («Не люблю острое»)

НЕЛЬЗЯ (верни пусто):
- эмоции/настроение («устал», «тревожно», «отлично») — НЕ извлекаем вообще
- мимолётные реплики, вопросы, болтовню («ок», «спасибо», «не знаю»)
- неуверенное/гипотетическое («наверное», «может быть», «если получится»)
- то, что ты сам додумал из контекста

importance: 4-6 обычный факт, 7-10 важное (семья, здоровье, крупные решения). Мелочь (<4) НЕ пиши вообще.

tasks: только ЯВНОЕ дело, прямо озвученное («купить продукты», «позвонить врачу»). Вопрос «как мне начать бегать?» — НЕ задача. Сомнение → не создавай. Дата по умолчанию — сегодня.

Запоминать нечего → верни {"tasks": [], "memories": []}.`;

  const response = await anthropic.messages.create({
    model: MODELS.sonnet,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: text }],
  });
  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new AiModelError(new Error('Empty Claude response'));
  }
  // Тот же defensive-парсинг, что extractFromTranscript (:131-140). param=text → используем raw.
  let raw = content.text.trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Pick<DictationExtraction, 'tasks' | 'memories'>>;
    return { tasks: parsed.tasks ?? [], memories: parsed.memories ?? [] };
  } catch (err) {
    throw new AiModelError(err instanceof Error ? err : new Error(String(err)));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts && npx tsc --noEmit`
Expected: PASS + tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/dictation-service.ts packages/server/src/services/memory-tier2-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): extractFromChat conservative chat extractor (T4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: T4 врезка в `captureInBackground` (CRITICAL прод-путь)

**Files:**
- Modify: `packages/server/src/services/jarvis-orchestrator.ts:167`
- Test: `packages/server/src/services/memory-tier2-wiring.test.ts` (дополнить)

- [ ] **Step 1: Write the failing test** — добавить блок в `memory-tier2-wiring.test.ts`:

```ts
describe('T4 врезка — captureInBackground выбирает экстрактор по флагу', () => {
  const f = src('./jarvis-orchestrator.ts');
  it('флаг-тернар extractFromChat / extractFromTranscript', () => {
    expect(f).toMatch(/isV2MemQualityEnabled\(userId\)\s*\n?\s*\?\s*await extractFromChat\(/);
    expect(f).toMatch(/:\s*await extractFromTranscript\(/);
  });
  it('импортирует extractFromChat и isV2MemQualityEnabled', () => {
    expect(f).toMatch(/extractFromChat/);
    expect(f).toMatch(/isV2MemQualityEnabled/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts`
Expected: FAIL — тернара нет.

- [ ] **Step 3: Write minimal implementation**

3a. В `jarvis-orchestrator.ts` — добавить `extractFromChat` к существующему импорту из `./dictation-service.js` (где уже импортируется `extractFromTranscript`), и `isV2MemQualityEnabled` к импорту из `../lib/feature-flags.js` (добавить, если файла нет в импортах — добавить строку `import { isV2MemQualityEnabled } from '../lib/feature-flags.js';`).

3b. Заменить строку 167:

```ts
const extracted = await extractFromTranscript(text, user?.name || 'друг');
```

на:

```ts
const extracted = isV2MemQualityEnabled(userId)
  ? await extractFromChat(text, user?.name || 'друг')
  : await extractFromTranscript(text, user?.name || 'друг');
```

(OFF → `extractFromTranscript`, байт-идентично. Гейт `looksCaptureWorthy` на вызывающей стороне не трогаем.)

- [ ] **Step 4: Run test + full unit suite + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts && npm test && npx tsc --noEmit`
Expected: PASS; полный unit-suite зелёный (~2611+); tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/jarvis-orchestrator.ts packages/server/src/services/memory-tier2-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): wire extractFromChat into captureInBackground behind flag (T4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: T5 врезка `mergeDetails` в `writeMemory`

**Files:**
- Modify: `packages/server/src/services/episodic-memory.ts:194`
- Test: `packages/server/src/services/memory-tier2-wiring.test.ts` (дополнить)

- [ ] **Step 1: Write the failing test** — добавить в `memory-tier2-wiring.test.ts`:

```ts
describe('T5 врезка — details merge по флагу', () => {
  const f = src('./episodic-memory.ts');
  it('ON-ветка через mergeDetails, OFF-ветка details ?? existing.details', () => {
    expect(f).toMatch(/isV2MemQualityEnabled\(userId\)\s*\n?\s*\?\s*mergeDetails\(existing\.details, details\)/);
    expect(f).toMatch(/:\s*\(details \?\? existing\.details\)/);
  });
  it('импортирует mergeDetails', () => {
    expect(f).toMatch(/mergeDetails/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

3a. В `episodic-memory.ts` — к импорту из `./memory-service.js` (где уже `shouldOverwriteContent, computeExpiresAt`) добавить `mergeDetails`. Убедиться, что `isV2MemQualityEnabled` импортируется из `../lib/feature-flags.js` (добавить, если нет; рядом с `isV2ForgetEnabled`).

3b. Заменить строку 194:

```ts
const merged = details ?? existing.details;
```

на:

```ts
const merged = isV2MemQualityEnabled(userId)
  ? mergeDetails(existing.details, details)
  : (details ?? existing.details);
```

(OFF → `details ?? existing.details`, байт-идентично.)

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts && npx tsc --noEmit`
Expected: PASS + tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/episodic-memory.ts packages/server/src/services/memory-tier2-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): sparse-guard details on writeMemory dedup-update behind flag (T5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: T3 диктовка через `writeMemory`

**Files:**
- Modify: `packages/server/src/services/dictation-service.ts` (функция `processDictation`, $transaction ~184-244)
- Test: `packages/server/src/services/memory-tier2-wiring.test.ts` (дополнить)

- [ ] **Step 1: Write the failing test** — добавить в `memory-tier2-wiring.test.ts`:

```ts
describe('T3 врезка — диктовка память через writeMemory по флагу', () => {
  const f = src('./dictation-service.ts');
  it('ON-ветка зовёт writeMemory с source dictation', () => {
    expect(f).toMatch(/isV2MemQualityEnabled\(userId\)/);
    expect(f).toMatch(/writeMemory\(userId, \{[\s\S]*?source: 'dictation'/);
  });
  it('OFF-ветка сохраняет tx.memory.create', () => {
    expect(f).toMatch(/tx\.memory\.create\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts`
Expected: FAIL — нет `writeMemory(userId,` с dictation в этом файле.

- [ ] **Step 3: Write minimal implementation**

3a. Импорты в `dictation-service.ts`: добавить `import { writeMemory } from './episodic-memory.js';` и `import { isV2MemQualityEnabled } from '../lib/feature-flags.js';`.

3b. Обернуть существующий `const result = await prisma.$transaction(...)` (строки 184-235) и `return {...}` (237-244) во флаг-branch. ON-ветка (память вне tx через writeMemory), OFF-ветка — существующий код БЕЗ изменений:

```ts
if (isV2MemQualityEnabled(userId)) {
  // T3: сессия+задачи в tx (атомарно); память — ВНЕ tx через writeMemory (дедуп+embed+TTL).
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.dictationSession.create({
      data: {
        userId,
        transcript,
        summary: extracted.summary,
        spokenResponse: extracted.spokenResponse,
        tasksCreated: extracted.tasks.length,
        memoriesCreated: extracted.memories.length,
        durationSeconds: durationSeconds ?? null,
      },
    });
    const createdTasks = await Promise.all(
      extracted.tasks.map((t) =>
        tx.task.create({
          data: {
            userId,
            title: t.title.slice(0, 500),
            category: (t.category || 'personal').slice(0, 32),
            priority: (t.priority || 'medium').slice(0, 32),
            date: new Date((t.date || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'),
            time: t.time?.slice(0, 8) ?? null,
            notes: t.notes?.slice(0, 2000) ?? null,
          },
          select: { id: true, title: true, date: true, time: true, category: true },
        }),
      ),
    );
    return { session, createdTasks };
  });

  const createdMemories: Array<{ id: string; type: string; content: string; importance: number; tags: string[] }> = [];
  for (const m of extracted.memories) {
    const r = await writeMemory(userId, {
      type: m.type,
      content: m.content,
      details: m.details ?? null,
      source: 'dictation',
      sourceId: result.session.id,
      tags: m.tags,
      importance: m.importance ?? 5,
    });
    if (r.action !== 'skipped') {
      createdMemories.push({
        id: r.id,
        type: m.type,
        content: m.content.slice(0, 500),
        importance: m.importance ?? 5,
        tags: (m.tags || []).slice(0, 10).map((t) => t.slice(0, 32)),
      });
    }
  }

  return {
    sessionId: result.session.id,
    transcript,
    summary: extracted.summary,
    spokenResponse: extracted.spokenResponse,
    tasksCreated: result.createdTasks,
    memoriesCreated: createdMemories,
  };
}

// OFF: существующий путь (память в tx через tx.memory.create) — БЕЗ изменений.
const result = await prisma.$transaction(async (tx) => {
  // ...текущий код 185-234 как есть...
});
return {
  // ...текущий return 237-244 как есть...
};
```

> Примечание исполнителю: тело OFF-ветки — это в точности текущие строки 184-244 (скопировать без правок). ON-ветка добавляется ПЕРЕД ними. extractFromTranscript для диктовки сохраняется (это реальный диктофон; T4 меняет ТОЛЬКО чат-путь в orchestrator).

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts && npx tsc --noEmit`
Expected: PASS + tsc clean (нет недостижимого кода — ON-ветка возвращает раньше).

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/dictation-service.ts packages/server/src/services/memory-tier2-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): dictation memories via writeMemory behind flag (T3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: E2 `significantMemories` + врезка в `v2-enrichment`

**Files:**
- Modify: `packages/server/src/services/episodic-memory.ts` (добавить `significantMemories`)
- Modify: `packages/server/src/services/v2-enrichment.ts:423`
- Test: `packages/server/src/services/memory-tier2-wiring.test.ts` (дополнить)

- [ ] **Step 1: Write the failing test** — добавить в `memory-tier2-wiring.test.ts`:

```ts
describe('E2 врезка — значимость при чтении по флагу', () => {
  it('episodic-memory экспортирует significantMemories', () => {
    expect(src('./episodic-memory.ts')).toMatch(/export async function significantMemories\(/);
  });
  it('v2-enrichment выбирает significantMemories / recentEvents по флагу', () => {
    const f = src('./v2-enrichment.ts');
    expect(f).toMatch(/isV2MemQualityEnabled\(userId\)/);
    expect(f).toMatch(/significantMemories\(userId, 6\)/);
    expect(f).toMatch(/recentEvents\(userId, 6\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

3a. В `episodic-memory.ts` под `rankBySignificance` (использует `prisma`, уже импортирован в файле):

```ts
/**
 * E2: кандидаты = свежие ∪ высоко-важные (оба с invalidAt/expiry-фильтрами,
 * как recentEvents), дедуп по id, ранжирование по значимости → топ-limit.
 */
export async function significantMemories(
  userId: string,
  limit = 6,
): Promise<Array<{ type: string; content: string; createdAt: Date }>> {
  const now = new Date();
  const baseWhere = {
    userId,
    invalidAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  const sel = { id: true, type: true, content: true, createdAt: true, importance: true } as const;
  const [recent, important] = await Promise.all([
    prisma.memory.findMany({ where: baseWhere, orderBy: { createdAt: 'desc' }, take: 15, select: sel }),
    prisma.memory.findMany({ where: baseWhere, orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }], take: 10, select: sel }),
  ]);
  const byId = new Map<string, RankableMemory>();
  for (const r of [...recent, ...important]) byId.set(r.id, r);
  return rankBySignificance([...byId.values()], limit, now).map(
    ({ type, content, createdAt }) => ({ type, content, createdAt }),
  );
}
```

3b. В `v2-enrichment.ts` — добавить `significantMemories` к импорту из `./episodic-memory.js` (где уже `recentEvents`), и `isV2MemQualityEnabled` из `../lib/feature-flags.js` (если ещё нет). Заменить строку 423:

```ts
recentEvents(userId, 6).then((rows) => formatRecentActivitySection(rows) || null),
```

на:

```ts
(isV2MemQualityEnabled(userId)
  ? significantMemories(userId, 6)
  : recentEvents(userId, 6)
).then((rows) => formatRecentActivitySection(rows) || null),
```

(OFF → `recentEvents(userId, 6)`, байт-идентично. `recentEvents` не меняем.)

- [ ] **Step 4: Run test + full suite + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/memory-tier2-wiring.test.ts && npm test && npx tsc --noEmit`
Expected: PASS; полный unit зелёный; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/episodic-memory.ts packages/server/src/services/v2-enrichment.ts packages/server/src/services/memory-tier2-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): significance-ranked memory recall in enrichment behind flag (E2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Integration tests (T3/T5/E2 + cross-user)

**Files:**
- Test: `packages/server/src/services/memory-tier2.it.test.ts` (создать)

> Тест-БД: `npm run test:db:up` один раз перед прогоном. Образец паттернов — `forget-triad.it.test.ts` (создание юзера, прямые вызовы writeMemory, очистка).

- [ ] **Step 1: Write the failing tests** — создать `memory-tier2.it.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { writeMemory, significantMemories } from './episodic-memory.js';

const uid = 'it-memtier2-user';

beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: uid },
    update: {},
    create: { id: uid, email: `${uid}@it.local`, name: 'IT', passwordHash: 'x' },
  });
  await prisma.memory.deleteMany({ where: { userId: uid } });
});
afterAll(async () => {
  await prisma.memory.deleteMany({ where: { userId: uid } });
  await prisma.user.deleteMany({ where: { id: uid } });
});

describe('T5 — details не затирается бедным повтором', () => {
  it('богатый details сохраняется при sparse-повторе (через mergeDetails в writeMemory)', async () => {
    process.env.FEATURE_V2_MEM_QUALITY = 'all';
    const rich = 'Серик Жумабаев — брат, познакомились в школе в 2005';
    await writeMemory(uid, { type: 'person', content: 'Серик', details: rich, importance: 7 });
    await writeMemory(uid, { type: 'person', content: 'Серик', details: 'Серик', importance: 5 });
    const rows = await prisma.memory.findMany({ where: { userId: uid, type: 'person' } });
    expect(rows).toHaveLength(1); // дедуп
    expect(rows[0].details).toBe(rich); // бедный details НЕ затёр
  });
});

describe('E2 — significantMemories поднимает важное старое', () => {
  it('важная старая запись попадает в топ над свежими пустяками', async () => {
    await prisma.memory.deleteMany({ where: { userId: uid } });
    const old = new Date(Date.now() - 12 * 86_400_000);
    await prisma.memory.create({ data: { userId: uid, type: 'fact', content: 'ВАЖНОЕ-СТАРОЕ', importance: 9, createdAt: old } });
    for (let i = 0; i < 6; i++) {
      await prisma.memory.create({ data: { userId: uid, type: 'fact', content: `пустяк-${i}`, importance: 3 } });
    }
    const out = await significantMemories(uid, 6);
    expect(out.map((r) => r.content)).toContain('ВАЖНОЕ-СТАРОЕ');
  });
});

describe('cross-user — чужая память не видна', () => {
  it('significantMemories не возвращает чужие записи', async () => {
    const out = await significantMemories('someone-else-xyz', 6);
    expect(out.every((r) => r.content !== 'ВАЖНОЕ-СТАРОЕ')).toBe(true);
  });
});
```

> Примечание: точный импорт `prisma` — свериться с образцом `forget-triad.it.test.ts` (путь к singleton-клиенту). Если `mergeDetails` под флагом — тест ставит `FEATURE_V2_MEM_QUALITY='all'` до вызова.

- [ ] **Step 2: Run to verify they fail/pass appropriately**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm run test:db:up && npx vitest run --project integration src/services/memory-tier2.it.test.ts`
Expected: тесты исполняются на тест-БД; если что-то красное — чинить по сообщению (Phase 1 systematic-debugging), не угадывать.

- [ ] **Step 3: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/memory-tier2.it.test.ts && git commit -m "$(cat <<'EOF'
test(memory): Tier-2 integration — T5 details guard, E2 significance, cross-user

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Полный verify + независимое ревью

**Files:** нет правок кода (только при findings ревью).

- [ ] **Step 1: Full unit suite + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm test && npx tsc --noEmit`
Expected: ~2611+ unit зелёных, tsc clean.

- [ ] **Step 2: Integration suite**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm run test:it`
Expected: зелёно (включая новый it-файл).

- [ ] **Step 3: OFF-идентичность вручную** — подтвердить, что без `FEATURE_V2_MEM_QUALITY` (unset) поведение прежнее: 4 врезки имеют OFF-ветку, точно совпадающую с прежним кодом (`extractFromTranscript`; `details ?? existing.details`; `tx.memory.create`; `recentEvents(userId,6)`). Структурный тест это уже фиксирует — перечитать diff глазами.

- [ ] **Step 4: Независимое ревью** — запустить code-review субагента. Фокус:
  - off=байт-идентично во всех 4 точках (OFF-ветка == прежний код);
  - память НЕ на критическом пути ответа (extractFromChat в fire-and-forget; writeMemory глотает ошибки; ранжирование чисто-в-JS);
  - контракт ответа диктовки сохранён (`memoriesCreated` той же формы);
  - консервативность промпта extractFromChat (нет emotion, «не уверен → пусто»);
  - нет `any`, ESM `.js`-суффиксы, нет `vi.mock`.

- [ ] **Step 5: Исправить findings (если есть) + финальный commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add -A && git commit -m "$(cat <<'EOF'
chore(memory): Tier-2 review fixes + final verify

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: СТОП — доложить Berik.** Не пушить/не деплоить/не флипать флаг. Предложить: push + deploy + `FEATURE_V2_MEM_QUALITY=all` по его слову (ship→flag=all).

---

## Self-Review (выполнено при написании плана)

- **Покрытие спеки:** T4 (Task 4+5), T3 (Task 7), T5 (Task 2+6), E2 (Task 3+8), флаг (Task 1), тесты (Task 9), verify+review (Task 10). Все юниты спеки покрыты.
- **Заглушки:** код полный в каждом шаге; команды точные; 2 «свериться с образцом» (prisma-импорт в it-тесте; путь structural-теста) помечены явно как сверка с существующим файлом, не выдуманные символы.
- **Согласованность типов:** `isV2MemQualityEnabled(userId)` везде; `mergeDetails(string|null,string|null)`; `RankableMemory`/`rankBySignificance<T>`; `significantMemories→{type,content,createdAt}[]` совпадает с `recentEvents` и входом `formatRecentActivitySection`; `Pick<DictationExtraction,'tasks'|'memories'>` совпадает с использованием `extracted.tasks/.memories` в captureInBackground.
- **Порядок:** чистые хелперы (нет БД) → врезки (флаг) → интеграция → verify. Каждый шаг компилируется и коммитится самостоятельно.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-memory-tier2-quality.md`. Две опции исполнения:

**1. Subagent-Driven (рекомендую)** — свежий субагент на задачу, two-stage review между задачами, быстрая итерация.

**2. Inline Execution** — исполняю задачи в этой сессии (executing-plans), батч с чекпойнтами.

Какой подход?
