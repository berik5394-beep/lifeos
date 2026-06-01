# Vision-Finance + Larger Text + Inline Proactivity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the LifeOS AI-friend three server-side abilities — (A) read a receipt/bank-screenshot photo and propose an expense/income with one-tap confirm, (C) process much longer user text, (D) gently suggest capturing a latent intent inline in long narratives.

**Architecture:** All server-only. A reuses the existing vision pattern (`vision.ts` Claude-vision + `extractJSON`) and the money-safe confirm flow (`setPendingAction` → confirm-FSM in `handleMessage` → `runConfirmedAction` → existing `add_expense`/`add_income` registry tools). C is a single SSOT constant. D is a flag-gated system-prompt block reusing existing `create_task`/`suggest_goal`. No migration. Testable now via the Telegram bot (a new `bot.on('photo')`).

**Tech Stack:** Fastify, Prisma, TypeScript strict, ESM NodeNext (`.js` imports), vitest (zero vi.mock, structural readFileSync+grep + pure unit), `createAnthropic()` (lib/anthropic.js, MODELS.sonnet), Telegraf.

**Scope:** Sub-projects A (server), C, D. **Non-Goals:** mobile camera/4K-resize (B), UI redesign/robot-everywhere, autonomous money writes, chunking.

**Rollout:** commit-per-step, local only. Push/deploy/flag ONLY on explicit Berik approval. SMOKE = send the bot a receipt photo → reply «да» → verify a real `Expense` row in DB (fact, not narration).

---

## File Structure

- **Create** `packages/server/src/services/finance-vision.ts` — finance photo understanding. `FinanceVisionResult` type, `parseFinanceResponse` (pure defensive parser), `analyzeFinancePhoto` (Claude vision, never throws), `buildFinancePending` (pure: result → confirm-action mapping).
- **Create** `packages/server/src/services/finance-vision.test.ts` — pure unit (parse + buildFinancePending) + structural (analyzeFinancePhoto uses createAnthropic+VISION model, never throws).
- **Modify** `packages/server/src/routes/vision.ts` — add `POST /vision/analyze-finance`.
- **Create** `packages/server/src/routes/vision-finance.test.ts` — structural (route registered, preHandlers, returns parsed + confirmText).
- **Modify** `packages/server/src/lib/feature-flags.ts` — `isV2InlineNudgeEnabled`.
- **Modify** `packages/server/src/ai/jarvis-prompt.ts` — `INLINE_NUDGE_BLOCK` + `opts.inlineNudge`.
- **Modify** `packages/server/src/services/jarvis-orchestrator.ts` — `MAX_USER_TEXT` SSOT const, replace `slice(0, 4000)`, pass `inlineNudge` flag into `buildJarvisPrompt`.
- **Create** `packages/server/src/services/inline-nudge.test.ts` — structural (flag + prompt block wired).
- **Modify** `packages/server/src/services/telegram-bot.ts` — add `bot.on('photo')` → finance branch (sets PendingAction), no hijack of other flows.
- **Create** `packages/server/src/services/telegram-photo-finance.test.ts` — structural (photo handler → analyzeFinancePhoto → setPendingAction).

All commands run from `packages/server`.

---

## Task 1: C — MAX_USER_TEXT SSOT constant (warm-up, low risk)

**Files:**
- Modify: `packages/server/src/services/jarvis-orchestrator.ts` (the two `slice(0, 4000)` sites ~lines 236, 240)
- Test: `packages/server/src/services/jarvis-orchestrator-reliability.test.ts` (append — file already exists)

- [ ] **Step 1: Write the failing test** — append to `jarvis-orchestrator-reliability.test.ts`:

```ts
describe('jarvis-orchestrator — C larger text window (AUDIT/spec 2026-06-01)', () => {
  it('uses MAX_USER_TEXT SSOT constant (16000), not a 4000 hardcode', () => {
    expect(SRC).toMatch(/const MAX_USER_TEXT = 16000/);
    expect(SRC).toMatch(/slice\(0, MAX_USER_TEXT\)/);
    // старого хардкода 4000 в persist-срезах не осталось
    expect(SRC).not.toMatch(/\.slice\(0, 4000\)/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/jarvis-orchestrator-reliability.test.ts`
Expected: FAIL (MAX_USER_TEXT not defined; `.slice(0, 4000)` still present).

- [ ] **Step 3: Implement** — in `jarvis-orchestrator.ts`, near the top-level consts (after imports, before `runConfirmedAction`), add:

```ts
// C (spec 2026-06-01): сколько символов сообщения храним/обрабатываем.
// Раньше 4000 обрезало длинный рассказ. 16000 покрывает «рассказ»;
// чанкинг гигантских — позже (YAGNI). Стоимость токенов ограничена
// дневным AI-лимитом (security.aiDailyLimiter).
const MAX_USER_TEXT = 16000;
```

Then replace BOTH persist slices (the `content: userText.slice(0, 4000)` and `content: assistantText.slice(0, 4000)` inside `saveTurn`/message-persist, ~lines 236 and 240):

```ts
        { userId, role: 'user', content: userText.slice(0, MAX_USER_TEXT), crisis },
```
```ts
          content: assistantText.slice(0, MAX_USER_TEXT),
```

- [ ] **Step 4: Check the extraction input path** — run:

```bash
grep -rn "slice(0, 4000)\|slice(0,4000)" src/services/jarvis-orchestrator.ts src/services/dictation-service.ts src/services/v2-capture.ts
```
If any remaining hit truncates the user text fed to extraction on the hot path, replace it with `MAX_USER_TEXT` too (export/import the const as needed). If none, continue. (Expected: none beyond the two already changed.)

- [ ] **Step 5: Run → PASS + tsc**

Run: `npx vitest run src/services/jarvis-orchestrator-reliability.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/jarvis-orchestrator.ts src/services/jarvis-orchestrator-reliability.test.ts
git commit -F - <<'EOF'
feat(C): MAX_USER_TEXT=16000 — process longer user narratives

Spec 2026-06-01. Raise the chat persist/process cap from a 4000 hardcode
to a named SSOT constant 16000 so long stories aren't truncated. Cost
bounded by the daily AI limit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: D — isV2InlineNudgeEnabled feature flag

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Test: `packages/server/src/services/inline-nudge.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `inline-nudge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FLAGS = readFileSync(join(process.cwd(), 'src/lib/feature-flags.ts'), 'utf8');

describe('D — inline-nudge feature flag', () => {
  it('exports isV2InlineNudgeEnabled using FEATURE_V2_INLINE_NUDGE', () => {
    expect(FLAGS).toMatch(/export function isV2InlineNudgeEnabled/);
    expect(FLAGS).toMatch(/FEATURE_V2_INLINE_NUDGE/);
    expect(FLAGS).toMatch(/isEnabledForUser\(process\.env\.FEATURE_V2_INLINE_NUDGE, userId\)/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/inline-nudge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `feature-flags.ts`, after a sibling like `isV2HermesEnabled`, add:

```ts
/**
 * D (spec 2026-06-01): inline-проактивность из длинного текста.
 * Off → байт-в-байт сегодняшнее поведение. Env FEATURE_V2_INLINE_NUDGE
 * в форме "all"/"true" / "none"/unset / "user-X,user-Y".
 */
export function isV2InlineNudgeEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_INLINE_NUDGE, userId);
}
```

- [ ] **Step 4: Run → PASS + tsc**

Run: `npx vitest run src/services/inline-nudge.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feature-flags.ts src/services/inline-nudge.test.ts
git commit -F - <<'EOF'
feat(D): isV2InlineNudgeEnabled flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: D — INLINE_NUDGE_BLOCK in the system prompt

**Files:**
- Modify: `packages/server/src/ai/jarvis-prompt.ts` (`buildJarvisPrompt` ~line 217; `parts` assembly ~line 228)
- Modify: `packages/server/src/services/jarvis-orchestrator.ts` (the `buildJarvisPrompt(gathered.context, {...})` call ~line 872)
- Test: append to `packages/server/src/services/inline-nudge.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```ts
describe('D — inline nudge prompt block', () => {
  const PROMPT = readFileSync(join(process.cwd(), 'src/ai/jarvis-prompt.ts'), 'utf8');
  const ORCH = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf8');
  it('jarvis-prompt has INLINE_NUDGE_BLOCK gated by opts.inlineNudge', () => {
    expect(PROMPT).toMatch(/INLINE_NUDGE_BLOCK/);
    expect(PROMPT).toMatch(/opts\.inlineNudge/);
  });
  it('orchestrator passes inlineNudge: isV2InlineNudgeEnabled(userId)', () => {
    expect(ORCH).toMatch(/inlineNudge:\s*isV2InlineNudgeEnabled\(userId\)/);
    expect(ORCH).toMatch(/isV2InlineNudgeEnabled/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/inline-nudge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement jarvis-prompt.ts** — add the block constant near the top (after imports):

```ts
// D (spec 2026-06-01): inline-подсказка из длинного рассказа. ОДНО мягкое
// предложение оформить скрытое намерение в задачу/цель, вопросом, легко
// проигнорировать. На «да» сработают обычные create_task/suggest_goal
// (через подтверждение). Добавляется ТОЛЬКО за флагом (см. orchestrator).
export const INLINE_NUDGE_BLOCK =
  '\n\nПРОАКТИВНОСТЬ ИЗ ТЕКСТА: если сообщение — длинный рассказ и в нём есть ' +
  'скрытое НАМЕРЕНИЕ или возможность (свидание, звонок, идея, дело, цель), ' +
  'в КОНЦЕ ответа задай ОДИН мягкий вопрос-предложение оформить это в задачу ' +
  'или цель (напр. «…кстати, давай пригласим её — поставить в задачу?»). ' +
  'Строго ОДНО предложение, не настаивай, легко проигнорировать. Если явного ' +
  'намерения нет — НЕ предлагай ничего.';
```

In `buildJarvisPrompt`, extend the opts type to include `inlineNudge?: boolean` and append the block to `parts` when true. Change the parts assembly (~line 228) from:

```ts
  const parts = [core(ctx.userName, getTimeOfDay()), styleBlock];
```
to:
```ts
  const parts = [core(ctx.userName, getTimeOfDay()), styleBlock];
  if (opts.inlineNudge) parts.push(INLINE_NUDGE_BLOCK);
```
(If `buildJarvisPrompt`'s `opts` is a typed interface, add `inlineNudge?: boolean;` to it; if inline-typed, add `inlineNudge?: boolean` to that inline type.)

- [ ] **Step 4: Implement orchestrator wiring** — ensure `isV2InlineNudgeEnabled` is imported from `../lib/feature-flags.js` (the file already imports other flags from there). In the `buildJarvisPrompt(gathered.context, { ... })` call (~line 872), add to the opts object:

```ts
      inlineNudge: isV2InlineNudgeEnabled(userId),
```

- [ ] **Step 5: Run → PASS + tsc + full suite**

Run: `npx vitest run src/services/inline-nudge.test.ts && npx tsc --noEmit && npx vitest run`
Expected: PASS, tsc clean, full suite green (baseline ~1846 now, +diff).

- [ ] **Step 6: Commit**

```bash
git add src/ai/jarvis-prompt.ts src/services/jarvis-orchestrator.ts src/services/inline-nudge.test.ts
git commit -F - <<'EOF'
feat(D): inline opportunity nudge in system prompt (flag-gated)

Spec 2026-06-01. Behind isV2InlineNudgeEnabled, append a one-suggestion
prompt block so the bot gently offers to capture a latent intent from a
long narrative. Flag off = byte-identical. On "yes" the existing
create_task/suggest_goal confirm tools handle it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: A — finance-vision types + parseFinanceResponse (pure)

**Files:**
- Create: `packages/server/src/services/finance-vision.ts`
- Create: `packages/server/src/services/finance-vision.test.ts`

- [ ] **Step 1: Write the failing test** — create `finance-vision.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFinanceResponse, buildFinancePending } from './finance-vision.js';

describe('parseFinanceResponse — defensive', () => {
  it('expense from a clean JSON', () => {
    const r = parseFinanceResponse('{"direction":"expense","amount":3000,"category":"food","merchant":"Magnum","date":"2026-06-01","confidence":0.9}');
    expect(r.direction).toBe('expense');
    expect(r.amount).toBe(3000);
    expect(r.merchant).toBe('Magnum');
  });
  it('income', () => {
    const r = parseFinanceResponse('```json\n{"direction":"income","amount":350000,"merchant":"Зарплата","confidence":0.8}\n```');
    expect(r.direction).toBe('income');
    expect(r.amount).toBe(350000);
  });
  it('garbage JSON → unknown, amount null', () => {
    const r = parseFinanceResponse('не вижу чека, извините');
    expect(r.direction).toBe('unknown');
    expect(r.amount).toBeNull();
  });
  it('direction present but no amount → unknown', () => {
    const r = parseFinanceResponse('{"direction":"expense","amount":0}');
    expect(r.direction).toBe('unknown');
    expect(r.amount).toBeNull();
  });
});

describe('buildFinancePending — pure mapping', () => {
  it('expense → add_expense action + confirm text', () => {
    const p = buildFinancePending({ direction: 'expense', amount: 3000, category: 'food', merchant: 'Magnum', confidence: 0.9 });
    expect(p?.action).toBe('add_expense');
    expect(p?.input).toMatchObject({ amount: 3000 });
    expect(p?.confirmationText).toMatch(/Записать расход 3000/);
  });
  it('income → add_income action', () => {
    const p = buildFinancePending({ direction: 'income', amount: 350000, merchant: 'Зарплата', confidence: 0.8 });
    expect(p?.action).toBe('add_income');
    expect(p?.input).toMatchObject({ amount: 350000, source: 'Зарплата' });
  });
  it('unknown → null (no pending)', () => {
    expect(buildFinancePending({ direction: 'unknown', amount: null, confidence: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/finance-vision.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `finance-vision.ts` with the types + the two pure functions (analyzeFinancePhoto added in Task 5):

```ts
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';

/** Результат чтения финансового фото (чек / скрин банка / перевод). */
export interface FinanceVisionResult {
  direction: 'expense' | 'income' | 'unknown';
  amount: number | null;
  category?: string;
  merchant?: string;
  date?: string; // YYYY-MM-DD
  confidence: number;
}

/** Чистый defensive-парсер ответа модели. Никогда не бросает; кривой
 *  JSON / нет суммы / неизвестное направление → unknown (не выдумываем). */
export function parseFinanceResponse(text: string): FinanceVisionResult {
  const fallback: FinanceVisionResult = { direction: 'unknown', amount: null, confidence: 0 };
  let raw: unknown;
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const body = fence ? fence[1] : text;
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a === -1 || b === -1) return fallback;
    raw = JSON.parse(body.slice(a, b + 1));
  } catch {
    return fallback;
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const dirRaw = o.direction === 'expense' || o.direction === 'income' ? o.direction : 'unknown';
  const amt =
    typeof o.amount === 'number' && Number.isFinite(o.amount) && o.amount > 0 ? o.amount : null;
  // Без суммы ИЛИ без направления → unknown (записать нечего).
  const direction = dirRaw !== 'unknown' && amt !== null ? dirRaw : 'unknown';
  return {
    direction,
    amount: amt,
    category: typeof o.category === 'string' ? o.category.slice(0, 40) : undefined,
    merchant: typeof o.merchant === 'string' ? o.merchant.slice(0, 120) : undefined,
    date: typeof o.date === 'string' ? o.date.slice(0, 10) : undefined,
    confidence: typeof o.confidence === 'number' ? o.confidence : 0,
  };
}

/** Чистое отображение результата в подтверждаемое money-действие.
 *  null → нечего записывать (unknown). Сумма округляется до целых ₸. */
export function buildFinancePending(
  r: FinanceVisionResult,
): { action: 'add_expense' | 'add_income'; input: Record<string, unknown>; confirmationText: string } | null {
  if ((r.direction !== 'expense' && r.direction !== 'income') || r.amount === null || r.amount <= 0) {
    return null;
  }
  const amount = Math.round(r.amount);
  if (r.direction === 'expense') {
    const input: Record<string, unknown> = { amount };
    if (r.category) input.category = r.category;
    if (r.merchant) input.description = r.merchant;
    const text =
      `Записать расход ${amount} ₸` +
      (r.merchant ? ` · ${r.merchant}` : '') +
      (r.category ? ` · ${r.category}` : '') +
      '? Ответь «да» для записи или исправь суммой/категорией.';
    return { action: 'add_expense', input, confirmationText: text };
  }
  const input: Record<string, unknown> = { amount };
  if (r.merchant) input.source = r.merchant;
  const text =
    `Записать доход ${amount} ₸` +
    (r.merchant ? ` · ${r.merchant}` : '') +
    '? Ответь «да» для записи.';
  return { action: 'add_income', input, confirmationText: text };
}

const VISION_MODEL = MODELS.sonnet;
const anthropic = createAnthropic();

/** Best-effort: фото (base64) → FinanceVisionResult. Никогда не бросает
 *  (сбой/нет ключа → unknown). Реальный vision-вызов. */
export async function analyzeFinancePhoto(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
): Promise<FinanceVisionResult> {
  try {
    const resp = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 256,
      system:
        'На фото чек, скрин банковского уведомления или перевода. Определи ' +
        'операцию и верни ТОЛЬКО JSON: {"direction": "expense"|"income"|"unknown", ' +
        '"amount": число в тенге (без пробелов/символов), "category"?: string, ' +
        '"merchant"?: string (магазин/источник), "date"?: "YYYY-MM-DD", ' +
        '"confidence": 0..1}. СПИСАНИЕ/покупка → expense. ПОСТУПЛЕНИЕ/зачисление → ' +
        'income. Если не видно суммы или непонятно — direction="unknown". ' +
        'Категории расхода: food, transport, entertainment, clothing, health, home, other.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Прочитай операцию и верни JSON.' },
          ],
        },
      ],
    });
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return { direction: 'unknown', amount: null, confidence: 0 };
    return parseFinanceResponse(block.text);
  } catch (err) {
    console.warn('[finance-vision] analyze failed:', err instanceof Error ? err.message : err);
    return { direction: 'unknown', amount: null, confidence: 0 };
  }
}
```

- [ ] **Step 4: Run → PASS + tsc**

Run: `npx vitest run src/services/finance-vision.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Add a structural test for analyzeFinancePhoto** — append to `finance-vision.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const SRC = readFileSync(join(process.cwd(), 'src/services/finance-vision.ts'), 'utf8');
describe('analyzeFinancePhoto — structure', () => {
  it('uses createAnthropic + sonnet vision + image content block, never throws', () => {
    expect(SRC).toMatch(/createAnthropic\(\)/);
    expect(SRC).toMatch(/MODELS\.sonnet/);
    expect(SRC).toMatch(/type: 'image'/);
    expect(SRC).toMatch(/catch \(err\)/);
  });
});
```

- [ ] **Step 6: Run → PASS + commit**

Run: `npx vitest run src/services/finance-vision.test.ts && npx tsc --noEmit`

```bash
git add src/services/finance-vision.ts src/services/finance-vision.test.ts
git commit -F - <<'EOF'
feat(A): finance-vision — parse + map receipt photo to money action

Spec 2026-06-01. parseFinanceResponse (pure, defensive → unknown on
bad/garbage/no-amount), buildFinancePending (pure → add_expense/add_income
+ confirm text), analyzeFinancePhoto (Claude vision via createAnthropic,
never throws). Whole-tenge rounding. No write here — proposal only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: A — POST /vision/analyze-finance route

**Files:**
- Modify: `packages/server/src/routes/vision.ts` (add route; reuse `VISION_MODEL`, `extractJSON` patterns, `PHOTO_BODY_LIMIT`, `mediaTypeSchema`, `visionRateLimit`, `aiDailyLimiter`, `validate`)
- Create: `packages/server/src/routes/vision-finance.test.ts`

- [ ] **Step 1: Write the failing test** — create `vision-finance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const SRC = readFileSync(join(process.cwd(), 'src/routes/vision.ts'), 'utf8');

describe('vision — POST /vision/analyze-finance', () => {
  it('route registered with photo limit + ai limiter + auth', () => {
    expect(SRC).toMatch(/'\/vision\/analyze-finance'/);
    const i = SRC.indexOf("'/vision/analyze-finance'");
    const block = SRC.slice(i, i + 600);
    expect(block).toMatch(/bodyLimit: PHOTO_BODY_LIMIT/);
    expect(block).toMatch(/aiDailyLimiter/);
  });
  it('uses analyzeFinancePhoto + buildFinancePending', () => {
    expect(SRC).toMatch(/analyzeFinancePhoto/);
    expect(SRC).toMatch(/buildFinancePending/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/routes/vision-finance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — at the top of `vision.ts` add the import:

```ts
import { analyzeFinancePhoto, buildFinancePending } from '../services/finance-vision.js';
```

Add a zod schema near the other schemas (after `saveFoodSchema` is gone — near `analyzeScheduleSchema`):

```ts
const analyzeFinanceSchema = z.object({
  image: z.string().min(100, 'Image обязателен (base64)'),
  mediaType: mediaTypeSchema,
});
```

Inside `visionRoutes`, add the route (next to `/vision/analyze-schedule`):

```ts
  // ----- Analyze receipt / bank-screenshot → expense|income proposal -------
  app.post('/vision/analyze-finance', {
    bodyLimit: PHOTO_BODY_LIMIT,
    preHandler: [visionRateLimit, aiDailyLimiter, validate(analyzeFinanceSchema)],
  }, async (request, reply) => {
    try {
      const { image, mediaType } = request.body as { image: string; mediaType: typeof SUPPORTED_MEDIA_TYPES[number] };
      const result = await analyzeFinancePhoto(image, mediaType);
      const pending = buildFinancePending(result);
      // Возвращаем распознанное + готовую запись (если есть). НЕ пишем —
      // запись только после подтверждения (confirm-FSM / клиент).
      return reply.send({ result, pending });
    } catch (err) {
      app.log.error({ err }, 'Vision analyze-finance error');
      return reply.status(500).send({ message: 'Ошибка чтения фото' });
    }
  });
```

(Note `visionRateLimit` is the existing per-route limiter used by sibling routes; reuse the same identifier. If sibling routes use a differently-named const, match it.)

- [ ] **Step 4: Run → PASS + tsc**

Run: `npx vitest run src/routes/vision-finance.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/routes/vision.ts src/routes/vision-finance.test.ts
git commit -F - <<'EOF'
feat(A): POST /vision/analyze-finance — read receipt → proposal

Spec 2026-06-01. Photo → analyzeFinancePhoto → buildFinancePending;
returns {result, pending}. No write (confirm-gated downstream). Reuses
PHOTO_BODY_LIMIT + aiDailyLimiter + auth like sibling vision routes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: A — Telegram photo handler → money confirm (testable channel)

**Files:**
- Modify: `packages/server/src/services/telegram-bot.ts` (add `bot.on('photo')`; reuse `getFileLink` download pattern ~line 109, `findOrCreateUser`, `ctx.reply`, `setPendingAction`)
- Create: `packages/server/src/services/telegram-photo-finance.test.ts`

- [ ] **Step 1: Write the failing test** — create `telegram-photo-finance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const SRC = readFileSync(join(process.cwd(), 'src/services/telegram-bot.ts'), 'utf8');

describe('telegram — photo → finance confirm', () => {
  it("registers bot.on('photo')", () => {
    expect(SRC).toMatch(/bot\.on\(\s*['"]photo['"]/);
  });
  it('analyzes finance + sets a PendingAction (no hijack of non-finance)', () => {
    const i = SRC.indexOf("bot.on('photo'");
    const block = SRC.slice(i, i + 1400);
    expect(block).toMatch(/analyzeFinancePhoto/);
    expect(block).toMatch(/buildFinancePending/);
    expect(block).toMatch(/setPendingAction\(/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/telegram-photo-finance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — add imports at the top of `telegram-bot.ts`:

```ts
import { analyzeFinancePhoto, buildFinancePending } from './finance-vision.js';
import { setPendingAction } from './pending-actions.js';
```

Add the handler near the existing `bot.on('voice')` / `bot.on('text')` handlers. Read how the existing voice handler downloads a file via `bot.telegram.getFileLink(fileId)` (~line 109) and resolves `userId` via `findOrCreateUser(ctx)` — mirror that. Telegram sends `ctx.message.photo` as an array of sizes; take the largest:

```ts
  bot.on('photo', async (ctx) => {
    try {
      const userId = await findOrCreateUser(ctx);
      const sizes = ctx.message.photo;
      const fileId = sizes[sizes.length - 1].file_id; // самый крупный размер
      const link = await bot.telegram.getFileLink(fileId);
      const res = await fetch(link.toString());
      const buf = Buffer.from(await res.arrayBuffer());
      const base64 = buf.toString('base64');
      const result = await analyzeFinancePhoto(base64, 'image/jpeg');
      const pending = buildFinancePending(result);
      if (!pending) {
        // НЕ перехватываем — фото не финансовое/непонятное.
        await ctx.reply('Не разобрал сумму на фото. Если это расход/доход — напиши суммой, или пришли чётче.');
        return;
      }
      await setPendingAction(userId, pending.action, pending.input, pending.confirmationText);
      await ctx.reply(pending.confirmationText);
    } catch (err) {
      console.warn('[telegram] photo handler failed:', err instanceof Error ? err.message : err);
      await ctx.reply('Не смог обработать фото. Попробуй ещё раз?');
    }
  });
```

(Use the SAME `findOrCreateUser` helper the voice/text handlers use — match its exact name/signature from the file. If photos arrive as documents too, that's out of scope here.)

When the user then replies «да», the existing `bot.on('text')` → `handleMessage` → confirm-FSM (`peekPendingAction` → `readConfirmSignal` → `runConfirmedAction('add_expense'|'add_income', input)`) writes the real row. No new confirm code needed.

- [ ] **Step 4: Run → PASS + tsc + full suite**

Run: `npx vitest run src/services/telegram-photo-finance.test.ts && npx tsc --noEmit && npx vitest run`
Expected: PASS, tsc clean, full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/services/telegram-bot.ts src/services/telegram-photo-finance.test.ts
git commit -F - <<'EOF'
feat(A): Telegram photo → finance confirm via PendingAction

Spec 2026-06-01. bot.on('photo') → analyzeFinancePhoto → buildFinancePending
→ setPendingAction(add_expense|add_income) + send confirm text. User «да»
goes through the existing confirm-FSM → real Expense/Income row (money-safe,
no bypass). Non-finance photos fall through (no hijack).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Final verify + progress

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: tsc clean; all test files pass; suite count = baseline + new tests.

- [ ] **Step 2: Lint discipline still green**

Run: `npx vitest run src/lib/anthropic-discipline.test.ts src/lib/model-discipline.test.ts`
Expected: PASS (finance-vision uses createAnthropic + MODELS.sonnet, no raw constructors / hardcoded model names).

- [ ] **Step 3: Update the audit/feature tracker + memory** (note: server vision-finance + C + D done locally, awaiting push/deploy/flag approval). Commit docs.

- [ ] **Step 4: Report to Berik** — summarize; ask for push/deploy + which flags (`FEATURE_V2_INLINE_NUDGE=user-<berik>`); give the SMOKE script: send the bot a receipt photo → reply «да» → confirm a real `Expense` row appears (DB fact).

---

## Self-Review

**Spec coverage:** A (analyzeFinancePhoto + parse + buildFinancePending + route + Telegram confirm) ✓ Tasks 4-6. C (MAX_USER_TEXT) ✓ Task 1. D (flag + prompt block) ✓ Tasks 2-3. Money-safe confirm reuse ✓ (Task 6 uses existing FSM). Non-Goals (B/redesign/migration/auto-write) excluded ✓.

**Placeholder scan:** every code step has real code. The two "match the existing helper name" notes (findOrCreateUser, visionRateLimit) are explicit lookups, not vague TODOs — the engineer confirms the exact identifier in the file (both are already used by sibling handlers in the same files).

**Type consistency:** `FinanceVisionResult`, `parseFinanceResponse`, `buildFinancePending`, `analyzeFinancePhoto`, `isV2InlineNudgeEnabled`, `INLINE_NUDGE_BLOCK`, `MAX_USER_TEXT` used identically across tasks. `add_expense` input `{amount, category?, description?}` and `add_income` `{amount, source?}` match the real tool zod schemas. Confirm flow uses real `setPendingAction(userId, action, input, confirmationText)` + existing FSM.
