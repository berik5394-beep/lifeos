# v2 Phase B3 — Cross-Session Learning (Feedback Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бот пассивно учится из реакции пользователя на свои ответы и сам корректирует манеру — через тот же B1 axes store.

**Architecture:** Каждое входящее сообщение в background-ветке `v2-capture` проходит feedback-пайплайн: вычисляем implicit-флаги (mood-drop из `MoodSnapshot`, re-ask через Voyage cosine), отдаём их + последний ответ бота + текст юзера в Claude haiku classifier, который возвращает axis-сигналы. Сигналы пишутся в B1 `AxisSignal(source='feedback')` (reuse EWMA), B2 traits следуют детерминированно. Каждая распознанная реакция логируется в новую `CorrectionLog` для прозрачности в `/axes`.

**Tech Stack:** TypeScript strict, Prisma 6.19 + Postgres, Anthropic haiku, Voyage embeddings (`embedQuery`), vitest (structural readFileSync+grep, zero vi.mock), feature flag `isV2FeedbackEnabled`.

**Spec:** `docs/superpowers/specs/2026-05-31-v2-phase-b3-cross-session-learning-design.md` (approved by Berik 2026-05-31).

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `CorrectionLog` model + `User.correctionLogs` reverse-relation |
| `prisma/migrations/manual/2026-05-31-correction-log.sql` | idempotent migration (CREATE TABLE IF NOT EXISTS + FK guard) |
| `src/services/user-axes/types.ts` | add `'feedback'` to `AxisSignalSource` (additive) |
| `src/services/feedback/types.ts` | feedback types + 4 pure helpers |
| `src/services/feedback/classify-feedback.ts` | Claude haiku reaction classifier |
| `src/services/feedback/detect-mood-drop.ts` | implicit signal #1 (MoodSnapshot Δ) |
| `src/services/feedback/detect-reask.ts` | implicit signal #2 (Voyage cosine) |
| `src/services/feedback/postgres-impl.ts` | `applyFeedback` + `recentCorrections` |
| `src/services/feedback/index.ts` | `getFeedbackStore()` singleton + re-exports |
| `src/lib/feature-flags.ts` | `isV2FeedbackEnabled` |
| `src/services/v2-capture.ts` | new feedback parallel branch + `fetchBotLastMsg` |
| `src/services/telegram-bot.ts` | `/axes` recentCorrections tail |
| `src/__integration__/v2-feedback-flow.test.ts` | structural integration |

**Convention notes (match B1/B2 exactly):**
- All feedback I/O is **best-effort** — never throws (mirrors `v2-capture` discipline).
- Feature flag values use the `user-${userId}` form (NB: env value for Berik = `user-cmp6n0jf90000pf017gv1kukz`).
- Commit per step with heredoc message + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Run from `packages/server`: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server`.
- Commands: `npx tsc --noEmit` (typecheck), `npx vitest run <path>` (single), `npx vitest run` (full).

---

## Task A1: AxisSignalSource += 'feedback' + CorrectionLog model + idempotent migration

**Files:**
- Modify: `packages/server/src/services/user-axes/types.ts:57-61`
- Modify: `packages/server/prisma/schema.prisma` (add model + reverse relation)
- Create: `packages/server/prisma/migrations/manual/2026-05-31-correction-log.sql`
- Test: `packages/server/src/services/feedback/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/feedback/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
const TYPES = readFileSync(
  join(process.cwd(), 'src/services/user-axes/types.ts'), 'utf-8');
const MIG = readFileSync(
  join(process.cwd(), 'prisma/migrations/manual/2026-05-31-correction-log.sql'),
  'utf-8');

describe('B3 schema — AxisSignalSource', () => {
  it("adds 'feedback' to the source union", () => {
    expect(TYPES).toMatch(/'feedback'/);
  });
});

describe('B3 schema — CorrectionLog model', () => {
  it('declares the model with required fields', () => {
    expect(SCHEMA).toMatch(/model CorrectionLog \{/);
    for (const f of ['signalType', 'valence', 'dimension', 'appliedSignals',
                     'botExcerpt', 'userExcerpt', 'moodDelta', 'reaskSim']) {
      expect(SCHEMA).toContain(f);
    }
  });
  it('User has correctionLogs reverse relation', () => {
    expect(SCHEMA).toMatch(/correctionLogs\s+CorrectionLog\[\]/);
  });
});

describe('B3 schema — idempotent migration', () => {
  it('uses IF NOT EXISTS guards', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS "CorrectionLog"/);
    expect(MIG).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(MIG).toMatch(/DO \$\$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/feedback/schema.test.ts`
Expected: FAIL — migration file missing / model not found.

- [ ] **Step 3: Add `'feedback'` to AxisSignalSource**

In `src/services/user-axes/types.ts` replace the union (lines 57-61):
```ts
export type AxisSignalSource =
  | 'claude_classifier'
  | 'system_signal'
  | 'bootstrap'
  | 'manual'
  | 'feedback';
```

- [ ] **Step 4: Add CorrectionLog model + reverse relation**

In `prisma/schema.prisma`, add to `model User` (near other reverse relations, e.g. after `chatMessages`):
```prisma
  correctionLogs CorrectionLog[]
```
Add the model at the end of the file:
```prisma
model CorrectionLog {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id])
  userMsgId      String?
  botExcerpt     String
  userExcerpt    String
  signalType     String   // 'explicit' | 'mood_drop' | 're_ask'
  valence        String   // 'positive' | 'negative' | 'neutral'
  dimension      String   // 'tone' | 'content' | 'understanding' | 'style'
  appliedSignals Json
  styleNote      String?
  moodDelta      Float?
  reaskSim       Float?
  recordedAt     DateTime @default(now())

  @@index([userId, recordedAt])
}
```

- [ ] **Step 5: Write idempotent migration**

Create `prisma/migrations/manual/2026-05-31-correction-log.sql`:
```sql
-- v2 Phase B3 — CorrectionLog table (feedback-loop audit).
-- Idempotent: safe to re-run. Matches B1/B2 manual-migration pattern.

CREATE TABLE IF NOT EXISTS "CorrectionLog" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "userMsgId"      TEXT,
  "botExcerpt"     TEXT NOT NULL,
  "userExcerpt"    TEXT NOT NULL,
  "signalType"     TEXT NOT NULL,
  "valence"        TEXT NOT NULL,
  "dimension"      TEXT NOT NULL,
  "appliedSignals" JSONB NOT NULL,
  "styleNote"      TEXT,
  "moodDelta"      DOUBLE PRECISION,
  "reaskSim"       DOUBLE PRECISION,
  "recordedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CorrectionLog_userId_recordedAt_idx"
  ON "CorrectionLog" ("userId", "recordedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CorrectionLog_userId_fkey'
  ) THEN
    ALTER TABLE "CorrectionLog"
      ADD CONSTRAINT "CorrectionLog_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
```

- [ ] **Step 6: Apply migration locally + regenerate client**

Run:
```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d lifeos \
  < prisma/migrations/manual/2026-05-31-correction-log.sql
npx prisma generate
```
Expected: `CREATE TABLE` / `CREATE INDEX` / `DO` succeed (or NOTICE on re-run); client regenerates with `correctionLog` delegate.
(If the docker container name differs, find it via `docker ps` and substitute. The Dockerfile `migrate deploy` will auto-apply in prod — this local apply is for tsc + local tests.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/services/feedback/schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma \
  prisma/migrations/manual/2026-05-31-correction-log.sql \
  src/services/user-axes/types.ts \
  src/services/feedback/schema.test.ts
git commit -F - <<'EOF'
feat(v2-b3): CorrectionLog model + AxisSignalSource 'feedback' (A1)

Idempotent migration (CREATE TABLE IF NOT EXISTS + FK guard), reverse
relation on User. Adds 'feedback' source to B1 axis-signal union so
feedback-driven corrections are distinguishable in the AxisSignal log.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B1: feedback/types.ts + 4 pure helpers

**Files:**
- Create: `packages/server/src/services/feedback/types.ts`
- Test: `packages/server/src/services/feedback/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/feedback/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  isMoodDrop,
  looksLikeQuestion,
  parseFeedbackResponse,
  NO_REACTION,
} from './types.js';

describe('isMoodDrop', () => {
  it('true when valence falls more than threshold', () => {
    expect(isMoodDrop(0.4, -0.1)).toBe(true);   // Δ -0.5
  });
  it('false on small dip', () => {
    expect(isMoodDrop(0.2, 0.1)).toBe(false);   // Δ -0.1
  });
  it('false on rise', () => {
    expect(isMoodDrop(-0.3, 0.4)).toBe(false);
  });
  it('respects custom threshold', () => {
    expect(isMoodDrop(0.5, 0.4, 0.05)).toBe(true);
  });
});

describe('looksLikeQuestion', () => {
  it('true on trailing ?', () => {
    expect(looksLikeQuestion('и что мне делать?')).toBe(true);
  });
  it('true on interrogative lead word', () => {
    expect(looksLikeQuestion('почему так вышло')).toBe(true);
    expect(looksLikeQuestion('Можешь повторить')).toBe(true);
  });
  it('false on a plain statement', () => {
    expect(looksLikeQuestion('сделал зарядку')).toBe(false);
  });
  it('false on empty', () => {
    expect(looksLikeQuestion('   ')).toBe(false);
  });
});

describe('NO_REACTION', () => {
  it('is a safe non-reaction default', () => {
    expect(NO_REACTION.isReaction).toBe(false);
    expect(NO_REACTION.axisSignals).toEqual([]);
    expect(NO_REACTION.styleNote).toBeNull();
  });
});

describe('parseFeedbackResponse', () => {
  it('parses a valid reaction', () => {
    const r = parseFeedbackResponse(JSON.stringify({
      isReaction: true, valence: 'negative', dimension: 'tone',
      axisSignals: [{ axis: 'conflict_tolerance', delta: -0.1,
                      confidence: 0.8, excerpt: 'без нравоучений' }],
      styleNote: 'буду мягче',
    }));
    expect(r.isReaction).toBe(true);
    expect(r.valence).toBe('negative');
    expect(r.dimension).toBe('tone');
    expect(r.axisSignals).toHaveLength(1);
    expect(r.axisSignals[0].axis).toBe('conflict_tolerance');
    expect(r.styleNote).toBe('буду мягче');
  });
  it('strips markdown fences', () => {
    const r = parseFeedbackResponse(
      '```json\n{"isReaction":false,"valence":"neutral",' +
      '"dimension":"content","axisSignals":[],"styleNote":null}\n```');
    expect(r.isReaction).toBe(false);
  });
  it('drops invalid axes and clamps deltas', () => {
    const r = parseFeedbackResponse(JSON.stringify({
      isReaction: true, valence: 'negative', dimension: 'style',
      axisSignals: [
        { axis: 'nonsense', delta: 0.1, confidence: 0.5 },
        { axis: 'introspection_depth', delta: -9, confidence: 2 },
      ], styleNote: null,
    }));
    expect(r.axisSignals).toHaveLength(1);
    expect(r.axisSignals[0].delta).toBe(-1);       // clamped
    expect(r.axisSignals[0].confidence).toBe(1);   // clamped
  });
  it('coerces unknown valence/dimension to safe enums', () => {
    const r = parseFeedbackResponse(JSON.stringify({
      isReaction: true, valence: 'furious', dimension: 'vibes',
      axisSignals: [], styleNote: null,
    }));
    expect(r.valence).toBe('neutral');
    expect(r.dimension).toBe('content');
  });
  it('returns NO_REACTION on garbage', () => {
    expect(parseFeedbackResponse('not json').isReaction).toBe(false);
    expect(parseFeedbackResponse('').isReaction).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/feedback/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types.ts**

Create `packages/server/src/services/feedback/types.ts`:
```ts
/**
 * v2.0 Phase B3 — Cross-Session Learning (feedback loop) types + pure
 * helpers. Spec: docs/superpowers/specs/2026-05-31-v2-phase-b3-cross-session-learning-design.md
 *
 * Pure helpers (isMoodDrop, looksLikeQuestion, parseFeedbackResponse,
 * NO_REACTION) are exported for unit testing without DB/Claude/Voyage.
 *
 * Feedback NEVER edits B2 traits directly — it routes axis signals into
 * the B1 store (source='feedback'). traits = f(axes, depth) follows.
 */

import {
  AXIS_NAMES,
  type AxisName,
  type AxisSignalInput,
  clampDelta,
  clampConfidence,
} from '../user-axes/index.js';

export type FeedbackValence = 'positive' | 'negative' | 'neutral';
export type FeedbackDimension = 'tone' | 'content' | 'understanding' | 'style';
export type FeedbackSignalType = 'explicit' | 'mood_drop' | 're_ask';

export interface ImplicitFlags {
  moodDropped: boolean;
  moodDelta: number | null;
  isReAsk: boolean;
  reaskSim: number | null;
}

export interface FeedbackResult {
  isReaction: boolean;
  valence: FeedbackValence;
  dimension: FeedbackDimension;
  axisSignals: AxisSignalInput[];
  styleNote: string | null;
}

const VALID_AXES: ReadonlySet<string> = new Set(AXIS_NAMES);
const VALENCES: ReadonlySet<string> = new Set(['positive', 'negative', 'neutral']);
const DIMENSIONS: ReadonlySet<string> = new Set([
  'tone', 'content', 'understanding', 'style',
]);

/** Safe "not a reaction" default — returned on any error / non-reaction. */
export const NO_REACTION: FeedbackResult = {
  isReaction: false,
  valence: 'neutral',
  dimension: 'content',
  axisSignals: [],
  styleNote: null,
};

/** Did the user's mood fall by more than `threshold` (valence units)? */
export function isMoodDrop(before: number, after: number,
                           threshold = 0.25): boolean {
  if (Number.isNaN(before) || Number.isNaN(after)) return false;
  return (before - after) > threshold;
}

const Q_LEAD = /^(как|почему|зачем|что|когда|где|сколько|кто|какой|какая|какие|можешь|можно|а\s+если|разве|неужели)\b/i;

/** Cheap gate before paying for a Voyage embedding: is this a question? */
export function looksLikeQuestion(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length === 0) return false;
  if (t.endsWith('?')) return true;
  return Q_LEAD.test(t);
}

function coerceValence(v: unknown): FeedbackValence {
  return typeof v === 'string' && VALENCES.has(v)
    ? (v as FeedbackValence) : 'neutral';
}
function coerceDimension(d: unknown): FeedbackDimension {
  return typeof d === 'string' && DIMENSIONS.has(d)
    ? (d as FeedbackDimension) : 'content';
}

/** Defensive parser for the haiku classifier JSON. Never throws —
 *  any malformed input collapses to NO_REACTION. Mirrors B1
 *  parseAxisResponse (fence-strip, axis validation, clamp). */
export function parseFeedbackResponse(raw: string): FeedbackResult {
  if (!raw || !raw.trim()) return NO_REACTION;

  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn('[feedback:parse] JSON parse failed:',
      err instanceof Error ? err.message : err);
    return NO_REACTION;
  }
  if (!parsed || typeof parsed !== 'object') return NO_REACTION;
  const obj = parsed as Record<string, unknown>;

  const rawSignals = Array.isArray(obj.axisSignals) ? obj.axisSignals : [];
  const axisSignals: AxisSignalInput[] = [];
  for (const s of rawSignals) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r.axis !== 'string' || !VALID_AXES.has(r.axis)) continue;
    const confidence = clampConfidence(Number(r.confidence));
    if (confidence <= 0) continue;
    const out: AxisSignalInput = {
      axis: r.axis as AxisName,
      delta: clampDelta(Number(r.delta)),
      confidence,
    };
    if (typeof r.excerpt === 'string') out.excerpt = r.excerpt.slice(0, 200);
    axisSignals.push(out);
  }

  const styleNote =
    typeof obj.styleNote === 'string' && obj.styleNote.trim()
      ? obj.styleNote.trim().slice(0, 200) : null;

  return {
    isReaction: obj.isReaction === true,
    valence: coerceValence(obj.valence),
    dimension: coerceDimension(obj.dimension),
    axisSignals,
    styleNote,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/feedback/types.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/feedback/types.ts src/services/feedback/types.test.ts
git commit -F - <<'EOF'
feat(v2-b3): feedback types + 4 pure helpers (B1)

isMoodDrop, looksLikeQuestion (Voyage gate), parseFeedbackResponse
(defensive, fence-strip + axis-validate + clamp, never throws),
NO_REACTION fallback. axisSignals reuse B1 AxisSignalInput.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B2: classify-feedback.ts — Claude haiku reaction classifier

**Files:**
- Create: `packages/server/src/services/feedback/classify-feedback.ts`
- Test: `packages/server/src/services/feedback/classify-feedback.test.ts`

- [ ] **Step 1: Write the failing test (structural — no Claude call)**

Create `packages/server/src/services/feedback/classify-feedback.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/feedback/classify-feedback.ts'), 'utf-8');

describe('classify-feedback structure', () => {
  it('exports classifyFeedback', () => {
    expect(SRC).toMatch(/export async function classifyFeedback/);
  });
  it('uses haiku model', () => {
    expect(SRC).toMatch(/MODELS\.haiku/);
  });
  it('feeds bot message, user message and implicit flags into the prompt', () => {
    expect(SRC).toMatch(/\[БОТ\]/);
    expect(SRC).toMatch(/\[ЮЗЕР\]/);
    expect(SRC).toMatch(/moodDropped/);
    expect(SRC).toMatch(/isReAsk/);
  });
  it('parses via parseFeedbackResponse', () => {
    expect(SRC).toMatch(/parseFeedbackResponse/);
  });
  it('is best-effort — returns NO_REACTION on failure, never throws', () => {
    expect(SRC).toMatch(/NO_REACTION/);
    expect(SRC).toMatch(/catch/);
  });
  it('names the four axes in the system prompt', () => {
    for (const a of ['conflict_tolerance', 'introspection_depth',
                     'emotional_openness', 'self_discipline']) {
      expect(SRC).toContain(a);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/feedback/classify-feedback.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement classify-feedback.ts**

Create `packages/server/src/services/feedback/classify-feedback.ts`:
```ts
/**
 * v2.0 Phase B3 — Claude haiku classifier for USER reactions to bot replies.
 *
 * Best-effort: never throws. Any failure (429, network, parse) →
 * NO_REACTION. Cost ~$0.0001/call; only invoked when a previous bot
 * message exists. Mirrors user-axes/analyze-message.ts.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import {
  parseFeedbackResponse,
  NO_REACTION,
  type FeedbackResult,
  type ImplicitFlags,
} from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

const FEEDBACK_SYSTEM_PROMPT = `Ты — анализатор РЕАКЦИЙ пользователя на ответы
ассистента LifeOS. Тебе дают последний ответ бота и ответ пользователя на него.
Определи, является ли сообщение пользователя РЕАКЦИЕЙ на манеру/содержание
бота, и что эта реакция говорит о личности.

ОСИ (те же 4, что в профиле личности):
- conflict_tolerance: реакция на прямоту/давление.
  «без нравоучений», «мягче», «не дави» → DOWN.
  «скажи как есть», «не сюсюкай», «будь прямее» → UP.
- introspection_depth: аппетит к рефлексии.
  «не философствуй», «давай конкретику», «по делу» → DOWN.
  «помоги понять почему», «копнём глубже» → UP.
- emotional_openness: к эмоциональному тону.
  «спасибо, поддержал», «то что нужно было услышать» → UP (слабо).
  «без эмоций», «по факту» → DOWN.
- self_discipline: обычно НЕ трогается реакцией — omit если нет явного.

DIMENSION (что именно не/зашло):
- tone: манера (жёстко/мягко/эмоционально).
- content: что посоветовал (не то / не помогло).
- understanding: бот не понял сути (особенно при isReAsk=true).
- style: прямая команда стиля («будь короче», «не философствуй»).

ПРАВИЛА:
1. Только валидный JSON. Без markdown, без объяснений.
2. Если это НЕ реакция на бота (просто новая тема) → isReaction=false,
   axisSignals=[]. Не выдумывай.
3. positive реакция → слабые сигналы (confidence ≤0.5).
4. negative/коррекция → сигналы сильнее (бот явно промахнулся).
5. delta [-1,1]: сильная коррекция ~0.12, средняя ~0.06, слабая ~0.02.
6. styleNote — короткая фраза-перевод для пользователя, напр.
   "ты попросил мягче — буду бережнее", или null.
7. moodDropped/isReAsk — лишь подсказки. Если текст явно нейтрален и
   позитивен, не делай негативный вывод только из флага.

ФОРМАТ:
{
  "isReaction": true,
  "valence": "negative",
  "dimension": "tone",
  "axisSignals": [
    {"axis":"conflict_tolerance","delta":-0.10,"confidence":0.8,
     "excerpt":"без нравоучений"}
  ],
  "styleNote": "ты попросил мягче — буду бережнее"
}

Если не реакция: {"isReaction": false, "valence":"neutral",
"dimension":"content", "axisSignals": [], "styleNote": null}`;

export async function classifyFeedback(
  botLastMsg: string,
  userMsg: string,
  flags: ImplicitFlags,
): Promise<FeedbackResult> {
  const bot = (botLastMsg ?? '').trim();
  const user = (userMsg ?? '').trim();
  if (bot.length === 0 || user.length === 0) return NO_REACTION;

  const content =
    `[БОТ]: ${bot.slice(0, 1000)}\n` +
    `[ЮЗЕР]: ${user.slice(0, 1000)}\n` +
    `[СИГНАЛЫ]: moodDropped=${flags.moodDropped} isReAsk=${flags.isReAsk}`;

  try {
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 512,
      system: FEEDBACK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') return NO_REACTION;
    return parseFeedbackResponse(block.text);
  } catch (err) {
    console.warn('[feedback:classify] failed:',
      err instanceof Error ? err.message : err);
    return NO_REACTION;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/feedback/classify-feedback.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/feedback/classify-feedback.ts \
  src/services/feedback/classify-feedback.test.ts
git commit -F - <<'EOF'
feat(v2-b3): classifyFeedback haiku reaction classifier (B2)

Given (botLastMsg, userMsg, implicit flags) → FeedbackResult with axis
signals + styleNote. Best-effort: NO_REACTION on any failure. Implicit
flags are hints, not facts. Mirrors user-axes analyze-message pattern.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B3: detect-mood-drop.ts — implicit signal #1

**Files:**
- Create: `packages/server/src/services/feedback/detect-mood-drop.ts`
- Test: `packages/server/src/services/feedback/detect-mood-drop.test.ts`

**Design note:** Compares the two most recent `MoodSnapshot` rows for the
user (1-turn lag, per spec §6 — avoids a second Claude mood call). Returns
`{moodDropped, moodDelta}`. Best-effort: no data → `{false, null}`.

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/feedback/detect-mood-drop.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/feedback/detect-mood-drop.ts'), 'utf-8');

describe('detect-mood-drop structure', () => {
  it('exports detectMoodDrop', () => {
    expect(SRC).toMatch(/export async function detectMoodDrop/);
  });
  it('reads the two latest MoodSnapshot rows', () => {
    expect(SRC).toMatch(/moodSnapshot\.findMany/);
    expect(SRC).toMatch(/recordedAt:\s*'desc'/);
    expect(SRC).toMatch(/take:\s*2/);
  });
  it('uses isMoodDrop pure helper', () => {
    expect(SRC).toMatch(/isMoodDrop/);
  });
  it('is best-effort — returns false/null on failure', () => {
    expect(SRC).toMatch(/catch/);
    expect(SRC).toMatch(/moodDropped:\s*false/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/feedback/detect-mood-drop.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement detect-mood-drop.ts**

Create `packages/server/src/services/feedback/detect-mood-drop.ts`:
```ts
/**
 * v2.0 Phase B3 — Implicit feedback signal #1: mood drop.
 *
 * Compares the two most recent MoodSnapshot rows (1-turn lag, spec §6).
 * A significant valence fall right after a bot turn hints the bot's
 * approach didn't land — fed as a flag into classifyFeedback.
 *
 * Best-effort: any error or insufficient data → { moodDropped:false,
 * moodDelta:null }. Never throws.
 */

import { prisma } from '../../lib/prisma.js';
import { isMoodDrop } from './types.js';

export async function detectMoodDrop(
  userId: string,
): Promise<{ moodDropped: boolean; moodDelta: number | null }> {
  try {
    const snaps = await prisma.moodSnapshot.findMany({
      where: { userId },
      orderBy: { recordedAt: 'desc' },
      take: 2,
      select: { valence: true },
    });
    if (snaps.length < 2) return { moodDropped: false, moodDelta: null };
    const after = snaps[0].valence;
    const before = snaps[1].valence;
    return {
      moodDropped: isMoodDrop(before, after),
      moodDelta: after - before,
    };
  } catch (err) {
    console.warn('[feedback:mood-drop] failed:',
      err instanceof Error ? err.message : err);
    return { moodDropped: false, moodDelta: null };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/feedback/detect-mood-drop.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/feedback/detect-mood-drop.ts \
  src/services/feedback/detect-mood-drop.test.ts
git commit -F - <<'EOF'
feat(v2-b3): detectMoodDrop implicit signal (B3)

Compares two latest MoodSnapshot rows (1-turn lag) via isMoodDrop.
Best-effort; <2 snapshots or error → {false, null}. Feeds classifier.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B4: detect-reask.ts — implicit signal #2 (Voyage)

**Files:**
- Create: `packages/server/src/services/feedback/detect-reask.ts`
- Test: `packages/server/src/services/feedback/detect-reask.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/feedback/detect-reask.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/feedback/detect-reask.ts'), 'utf-8');

describe('detect-reask structure', () => {
  it('exports detectReAsk', () => {
    expect(SRC).toMatch(/export async function detectReAsk/);
  });
  it('gates on looksLikeQuestion + embeddingsEnabled before any Voyage call', () => {
    expect(SRC).toMatch(/looksLikeQuestion/);
    expect(SRC).toMatch(/embeddingsEnabled/);
  });
  it('uses embedQuery + cosineSimilarity', () => {
    expect(SRC).toMatch(/embedQuery/);
    expect(SRC).toMatch(/cosineSimilarity/);
  });
  it('reads recent user messages from ChatMessage', () => {
    expect(SRC).toMatch(/chatMessage\.findMany/);
    expect(SRC).toMatch(/role:\s*'user'/);
  });
  it('threshold 0.82 and best-effort false/null', () => {
    expect(SRC).toMatch(/0\.82/);
    expect(SRC).toMatch(/catch/);
    expect(SRC).toMatch(/isReAsk:\s*false/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/feedback/detect-reask.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement detect-reask.ts**

Create `packages/server/src/services/feedback/detect-reask.ts`:
```ts
/**
 * v2.0 Phase B3 — Implicit feedback signal #2: re-ask.
 *
 * If the user re-asks something semantically close to a recent question,
 * the bot's earlier answer likely missed. Embeds the current message and
 * compares (cosine) against recent user messages from the last 24h.
 *
 * Gated by looksLikeQuestion (cheap) + embeddingsEnabled — ~80% of
 * messages skip the Voyage call. Best-effort: error → { false, null }.
 */

import { prisma } from '../../lib/prisma.js';
import { embedQuery, embeddingsEnabled } from '../embeddings.js';
import { cosineSimilarity } from '../procedural-memory.js';
import { looksLikeQuestion } from './types.js';

const REASK_THRESHOLD = 0.82;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function detectReAsk(
  userId: string,
  text: string,
  currentMsgId: string,
): Promise<{ isReAsk: boolean; reaskSim: number | null }> {
  if (!looksLikeQuestion(text) || !embeddingsEnabled()) {
    return { isReAsk: false, reaskSim: null };
  }
  try {
    const since = new Date(Date.now() - DAY_MS);
    const recent = await prisma.chatMessage.findMany({
      where: {
        userId,
        role: 'user',
        createdAt: { gte: since },
        id: { not: currentMsgId },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true },
    });
    const prior = recent
      .map((m) => m.content?.trim())
      .filter((c): c is string => !!c && looksLikeQuestion(c));
    if (prior.length === 0) return { isReAsk: false, reaskSim: null };

    const cur = await embedQuery(text);
    if (!cur || cur.length === 0) return { isReAsk: false, reaskSim: null };

    let maxSim = -1;
    for (const q of prior) {
      const emb = await embedQuery(q);
      if (!emb || emb.length === 0) continue;
      const sim = cosineSimilarity(cur, emb);
      if (sim > maxSim) maxSim = sim;
    }
    if (maxSim < 0) return { isReAsk: false, reaskSim: null };
    return { isReAsk: maxSim >= REASK_THRESHOLD, reaskSim: maxSim };
  } catch (err) {
    console.warn('[feedback:re-ask] failed:',
      err instanceof Error ? err.message : err);
    return { isReAsk: false, reaskSim: null };
  }
}
```

NB: confirm `embedQuery` resolves to `Promise<number[]>` and
`embeddingsEnabled` is exported from `../embeddings.js` (verified in B1
work — `export const embedQuery`, `export function embeddingsEnabled`).
`cosineSimilarity` is exported from `../procedural-memory.js` (verified).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/feedback/detect-reask.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/feedback/detect-reask.ts \
  src/services/feedback/detect-reask.test.ts
git commit -F - <<'EOF'
feat(v2-b3): detectReAsk implicit signal via Voyage (B4)

Gated by looksLikeQuestion + embeddingsEnabled (skips ~80% of msgs).
Cosine of current question vs recent 24h user questions; ≥0.82 → re-ask.
Best-effort; error → {false, null}. Feeds classifier as a hint.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B5: postgres-impl.ts — applyFeedback + recentCorrections

**Files:**
- Create: `packages/server/src/services/feedback/postgres-impl.ts`
- Test: `packages/server/src/services/feedback/postgres-impl.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/feedback/postgres-impl.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/feedback/postgres-impl.ts'), 'utf-8');

describe('PostgresFeedback structure', () => {
  it('exports the class implementing FeedbackStore', () => {
    expect(SRC).toMatch(/export class PostgresFeedback implements FeedbackStore/);
  });
  it('applyFeedback routes axis signals into B1 with source=feedback', () => {
    expect(SRC).toMatch(/getUserAxesStore\(\)\.recordSignals/);
    expect(SRC).toMatch(/'feedback'/);
  });
  it('writes a CorrectionLog row', () => {
    expect(SRC).toMatch(/correctionLog\.create/);
  });
  it('recentCorrections reads ordered by recordedAt desc', () => {
    expect(SRC).toMatch(/correctionLog\.findMany/);
    expect(SRC).toMatch(/recordedAt:\s*'desc'/);
  });
  it('is best-effort — wraps in try/catch, never throws', () => {
    expect(SRC).toMatch(/catch/);
  });
  it('skips axis write when no signals (avoids empty EWMA churn)', () => {
    expect(SRC).toMatch(/axisSignals\.length/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/feedback/postgres-impl.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement postgres-impl.ts**

Create `packages/server/src/services/feedback/postgres-impl.ts`:
```ts
/**
 * v2.0 Phase B3 — PostgresFeedback. Applies a recognised reaction:
 *   1. routes axis signals into the B1 store (source='feedback') — reuse
 *      EWMA + persistence; B2 traits follow deterministically.
 *   2. writes a CorrectionLog row for transparency (/axes tail).
 *
 * Best-effort throughout — callers (v2-capture branch) need no try/catch.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getUserAxesStore } from '../user-axes/index.js';
import type {
  FeedbackResult,
  FeedbackSignalType,
  ImplicitFlags,
} from './types.js';

export interface RecentCorrection {
  styleNote: string | null;
  dimension: string;
  valence: string;
  signalType: string;
  recordedAt: Date;
}

export interface FeedbackStore {
  applyFeedback(
    userId: string,
    msgId: string | null,
    botExcerpt: string,
    userExcerpt: string,
    result: FeedbackResult,
    signalType: FeedbackSignalType,
    flags: ImplicitFlags,
  ): Promise<void>;

  recentCorrections(userId: string, limit?: number): Promise<RecentCorrection[]>;
}

export class PostgresFeedback implements FeedbackStore {
  async applyFeedback(
    userId: string,
    msgId: string | null,
    botExcerpt: string,
    userExcerpt: string,
    result: FeedbackResult,
    signalType: FeedbackSignalType,
    flags: ImplicitFlags,
  ): Promise<void> {
    // 1. Route axis signals into B1 (reuse EWMA). Skip if none — avoids
    //    needless UserAxes churn for understanding/content-only misses.
    if (result.axisSignals.length > 0) {
      try {
        await getUserAxesStore().recordSignals(
          userId, msgId, result.axisSignals, 'feedback',
        );
      } catch (err) {
        console.warn('[feedback:apply:axes] failed:',
          err instanceof Error ? err.message : err);
      }
    }

    // 2. Audit row for transparency. Snapshot text (not FK) — robust to
    //    ChatMessage retention purge.
    try {
      await prisma.correctionLog.create({
        data: {
          userId,
          userMsgId: msgId,
          botExcerpt: botExcerpt.slice(0, 280),
          userExcerpt: userExcerpt.slice(0, 280),
          signalType,
          valence: result.valence,
          dimension: result.dimension,
          appliedSignals: result.axisSignals as unknown as Prisma.InputJsonValue,
          styleNote: result.styleNote,
          moodDelta: flags.moodDelta,
          reaskSim: flags.reaskSim,
        },
      });
    } catch (err) {
      console.warn('[feedback:apply:log] failed:',
        err instanceof Error ? err.message : err);
    }
  }

  async recentCorrections(
    userId: string,
    limit = 5,
  ): Promise<RecentCorrection[]> {
    try {
      const rows = await prisma.correctionLog.findMany({
        where: { userId },
        orderBy: { recordedAt: 'desc' },
        take: limit,
        select: {
          styleNote: true, dimension: true, valence: true,
          signalType: true, recordedAt: true,
        },
      });
      return rows;
    } catch (err) {
      console.warn('[feedback:recent] failed:',
        err instanceof Error ? err.message : err);
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/feedback/postgres-impl.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (CorrectionLog delegate exists after A1 `prisma generate`).

- [ ] **Step 6: Commit**

```bash
git add src/services/feedback/postgres-impl.ts \
  src/services/feedback/postgres-impl.test.ts
git commit -F - <<'EOF'
feat(v2-b3): PostgresFeedback applyFeedback + recentCorrections (B5)

applyFeedback routes axis signals into B1 (source='feedback', reuse
EWMA) and writes a CorrectionLog snapshot row. Skips axis write when no
signals. recentCorrections powers the /axes transparency tail.
Best-effort throughout.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B6: feedback/index.ts — singleton + re-exports

**Files:**
- Create: `packages/server/src/services/feedback/index.ts`
- Test: `packages/server/src/services/feedback/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/feedback/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  getFeedbackStore,
  _resetFeedbackForTests,
  classifyFeedback,
  detectMoodDrop,
  detectReAsk,
  looksLikeQuestion,
  NO_REACTION,
} from './index.js';

describe('feedback/index', () => {
  it('getFeedbackStore returns a stable singleton', () => {
    _resetFeedbackForTests();
    const a = getFeedbackStore();
    const b = getFeedbackStore();
    expect(a).toBe(b);
    expect(typeof a.applyFeedback).toBe('function');
    expect(typeof a.recentCorrections).toBe('function');
  });
  it('reset yields a fresh instance', () => {
    const a = getFeedbackStore();
    _resetFeedbackForTests();
    const b = getFeedbackStore();
    expect(a).not.toBe(b);
  });
  it('re-exports the public surface', () => {
    expect(typeof classifyFeedback).toBe('function');
    expect(typeof detectMoodDrop).toBe('function');
    expect(typeof detectReAsk).toBe('function');
    expect(typeof looksLikeQuestion).toBe('function');
    expect(NO_REACTION.isReaction).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/feedback/index.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement index.ts**

Create `packages/server/src/services/feedback/index.ts`:
```ts
/**
 * v2.0 Phase B3 — Feedback store public entry point.
 * Lazy singleton + test reset. Mirrors user-axes/index.ts.
 */

export {
  type FeedbackValence,
  type FeedbackDimension,
  type FeedbackSignalType,
  type FeedbackResult,
  type ImplicitFlags,
  NO_REACTION,
  isMoodDrop,
  looksLikeQuestion,
  parseFeedbackResponse,
} from './types.js';

export { classifyFeedback } from './classify-feedback.js';
export { detectMoodDrop } from './detect-mood-drop.js';
export { detectReAsk } from './detect-reask.js';
export {
  PostgresFeedback,
  type FeedbackStore,
  type RecentCorrection,
} from './postgres-impl.js';

import { PostgresFeedback } from './postgres-impl.js';
import type { FeedbackStore } from './postgres-impl.js';

let _instance: FeedbackStore | null = null;

export function getFeedbackStore(): FeedbackStore {
  if (!_instance) _instance = new PostgresFeedback();
  return _instance;
}

export function _resetFeedbackForTests(): void {
  _instance = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/feedback/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/feedback/index.ts src/services/feedback/index.test.ts
git commit -F - <<'EOF'
feat(v2-b3): feedback/index singleton + re-exports (B6)

getFeedbackStore() lazy singleton + _resetFeedbackForTests. Re-exports
the public surface (classify/detect*/helpers). Mirrors user-axes/index.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task C1: isV2FeedbackEnabled flag + v2-capture feedback branch + fetchBotLastMsg

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts` (add function)
- Modify: `packages/server/src/services/v2-capture.ts` (imports + branch)
- Test: `packages/server/src/services/feedback/wiring.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/feedback/wiring.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isV2FeedbackEnabled } from '../../lib/feature-flags.js';

const CAP = readFileSync(join(process.cwd(), 'src/services/v2-capture.ts'),
  'utf-8');

describe('isV2FeedbackEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_FEEDBACK; });
  it('disabled when unset', () => {
    delete process.env.FEATURE_V2_FEEDBACK;
    expect(isV2FeedbackEnabled('u1')).toBe(false);
  });
  it('all → enabled', () => {
    process.env.FEATURE_V2_FEEDBACK = 'all';
    expect(isV2FeedbackEnabled('u1')).toBe(true);
  });
  it('comma list matches user- prefix', () => {
    process.env.FEATURE_V2_FEEDBACK = 'user-u1,user-u2';
    expect(isV2FeedbackEnabled('u1')).toBe(true);
    expect(isV2FeedbackEnabled('u3')).toBe(false);
  });
});

describe('v2-capture feedback branch', () => {
  it('is gated by isV2FeedbackEnabled', () => {
    expect(CAP).toMatch(/isV2FeedbackEnabled/);
  });
  it('fetches bot last message and runs the pipeline', () => {
    expect(CAP).toMatch(/role:\s*'assistant'/);
    expect(CAP).toMatch(/classifyFeedback/);
    expect(CAP).toMatch(/detectMoodDrop/);
    expect(CAP).toMatch(/detectReAsk/);
    expect(CAP).toMatch(/applyFeedback/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/feedback/wiring.test.ts`
Expected: FAIL — `isV2FeedbackEnabled` not exported / branch absent.

- [ ] **Step 3: Add the feature flag**

In `src/lib/feature-flags.ts`, append after `isV2IdentityEnabled`:
```ts
/**
 * v2 Phase B3 — Per-user gate for the cross-session feedback loop.
 * Same shape as isV2AxesEnabled: "all"/"true", "none"/"false"/unset,
 * or comma list "user-X,user-Y".
 */
export function isV2FeedbackEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_FEEDBACK;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 4: Add imports to v2-capture.ts**

In `src/services/v2-capture.ts`, after the existing axes import (line 18-19), add:
```ts
import {
  classifyFeedback,
  detectMoodDrop,
  detectReAsk,
  getFeedbackStore,
  type FeedbackSignalType,
} from './feedback/index.js';
import { isV2AxesEnabled, isV2FeedbackEnabled } from '../lib/feature-flags.js';
```
(Replace the existing `import { isV2AxesEnabled } from '../lib/feature-flags.js';`
line so both flags come from one import.)

- [ ] **Step 5: Add the feedback branch**

In `src/services/v2-capture.ts`, inside the `Promise.allSettled([...])`
array (after the existing B1 axes IIFE branch, before the closing `])`),
add a new branch:
```ts
      // v2 Phase B3 — feedback loop (best-effort). Learns from the user's
      // reaction to the bot's previous reply; corrections flow into B1
      // axes (source='feedback'), B2 traits follow deterministically.
      (async () => {
        if (!isV2FeedbackEnabled(userId)) return;
        try {
          const botLast = await prisma.chatMessage.findFirst({
            where: { userId, role: 'assistant' },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
          });
          if (!botLast?.content) return; // nothing to react to yet

          const [mood, reask] = await Promise.all([
            detectMoodDrop(userId),
            detectReAsk(userId, text, msgId),
          ]);
          const flags = { ...mood, ...reask };

          const result = await classifyFeedback(botLast.content, text, flags);
          if (!result.isReaction) return;

          const signalType: FeedbackSignalType =
            result.dimension === 'style' ? 'explicit'
            : mood.moodDropped ? 'mood_drop'
            : reask.isReAsk ? 're_ask'
            : 'explicit';

          await getFeedbackStore().applyFeedback(
            userId, msgId,
            botLast.content, text,
            result, signalType, flags,
          );
        } catch (err) {
          console.warn('[v2-capture:feedback] failed:', err);
        }
      })(),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/services/feedback/wiring.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/feature-flags.ts src/services/v2-capture.ts \
  src/services/feedback/wiring.test.ts
git commit -F - <<'EOF'
feat(v2-b3): wire feedback branch into v2-capture + flag (C1)

isV2FeedbackEnabled gate. New best-effort parallel branch fetches the
bot's last reply, computes implicit flags (mood-drop + re-ask), runs the
haiku classifier, and applies recognised reactions. Never blocks reply
or legacy capture.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task D1: /axes recentCorrections tail (transparency)

**Files:**
- Modify: `packages/server/src/services/telegram-bot.ts` (the `/axes` formatter, ~line 400-425)
- Test: `packages/server/src/services/feedback/transparency.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/feedback/transparency.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BOT = readFileSync(join(process.cwd(), 'src/services/telegram-bot.ts'),
  'utf-8');

describe('/axes transparency tail', () => {
  it('imports the feedback store', () => {
    expect(BOT).toMatch(/getFeedbackStore/);
  });
  it('renders recent corrections', () => {
    expect(BOT).toMatch(/recentCorrections/);
    expect(BOT).toMatch(/Недавние коррекции/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/feedback/transparency.test.ts`
Expected: FAIL — no corrections tail yet.

- [ ] **Step 3: Add import**

In `src/services/telegram-bot.ts`, near the existing user-axes imports
(line 9-11), add:
```ts
import { getFeedbackStore } from './feedback/index.js';
```

- [ ] **Step 4: Render the tail in the /axes formatter**

In `src/services/telegram-bot.ts`, in the function that builds the `/axes`
reply, after the `Всего сигналов: ${axes.signalCount}` push (~line 423),
append:
```ts
  // v2 B3 — recent feedback corrections (transparency). Hidden if none.
  try {
    const corrections = await getFeedbackStore().recentCorrections(userId, 5);
    const withNote = corrections.filter((c) => c.styleNote);
    if (withNote.length > 0) {
      lines.push('');
      lines.push('🔧 Недавние коррекции:');
      for (const c of withNote) {
        lines.push(`• ${c.styleNote}`);
      }
    }
  } catch (err) {
    console.warn('[telegram:axes:corrections] failed:', err);
  }
```
(If the `/axes` handler builds its reply differently — e.g. via a helper
returning a string — append the same block before the final return,
pushing onto the same `lines` array. The handler already has `userId`
and a `lines: string[]` accumulator per the B1 implementation.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/feedback/transparency.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/services/telegram-bot.ts \
  src/services/feedback/transparency.test.ts
git commit -F - <<'EOF'
feat(v2-b3): /axes recent-corrections transparency tail (D1)

Appends "🔧 Недавние коррекции" with human-readable styleNotes so the
user sees the bot actually listened to their reactions. Hidden when
there are no corrections. Best-effort.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task E1: Integration test + final verify + progress tracker

**Files:**
- Create: `packages/server/src/__integration__/v2-feedback-flow.test.ts`
- Modify: `docs/plan/v2-memory-proactivity-scope.md` (mark B3 done)

- [ ] **Step 1: Write the integration test (structural)**

Create `packages/server/src/__integration__/v2-feedback-flow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CAP = readFileSync(join(process.cwd(), 'src/services/v2-capture.ts'),
  'utf-8');
const BOT = readFileSync(join(process.cwd(), 'src/services/telegram-bot.ts'),
  'utf-8');
const IMPL = readFileSync(
  join(process.cwd(), 'src/services/feedback/postgres-impl.ts'), 'utf-8');

describe('v2 feedback flow — inbound capture', () => {
  it('feedback branch gated + full pipeline wired', () => {
    expect(CAP).toContain('isV2FeedbackEnabled');
    expect(CAP).toContain('classifyFeedback');
    expect(CAP).toContain('applyFeedback');
  });
});

describe('v2 feedback flow — corrections route through B1 axes', () => {
  it('applyFeedback records signals with source feedback (not B2 traits)', () => {
    expect(IMPL).toMatch(/recordSignals\([^)]*'feedback'/s);
    expect(IMPL).not.toMatch(/refreshTraits|BotIdentity/);
  });
});

describe('v2 feedback flow — transparency', () => {
  it('/axes renders recent corrections', () => {
    expect(BOT).toContain('recentCorrections');
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run src/__integration__/v2-feedback-flow.test.ts`
Expected: PASS.

- [ ] **Step 3: Full suite + typecheck**

Run:
```bash
npx tsc --noEmit && npx vitest run
```
Expected: tsc clean; all tests green (baseline 1618 + ~B3 additions).
FK errors in stderr from best-effort DB writes are intentional/ignored
(same as B1/B2).

- [ ] **Step 4: Update progress tracker**

In `docs/plan/v2-memory-proactivity-scope.md`, mark Phase B3 done
(mirror the B1/B2 "DONE" entries): add a B3 line under Phase B noting
passive feedback loop shipped, all 3 signals, corrections via B1 axes,
CorrectionLog table, flag `isV2FeedbackEnabled`, files under
`src/services/feedback/`.

- [ ] **Step 5: Commit**

```bash
git add src/__integration__/v2-feedback-flow.test.ts \
  docs/plan/v2-memory-proactivity-scope.md
git commit -F - <<'EOF'
test(v2-b3): feedback-flow integration + progress tracker (E1)

Structural integration: feedback branch gated + wired in v2-capture;
corrections route through B1 axes (source='feedback'), never touch B2
traits directly; /axes renders the corrections tail. Marks B3 done.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Rollout (AFTER all tasks green — requires explicit Berik approval per step)

> Discipline lock: local commits only above. Push + deploy + flag changes
> are SEPARATE actions, each needing Berik's explicit "push"/"deploy"/"включай".

1. **Push** (on "push"): `git push origin main`.
2. **Deploy**: Railway Dockerfile runs `prisma migrate deploy` → CorrectionLog
   auto-created. Verify service Online + table exists in prod DB.
3. **Enable flag**: set Railway env `FEATURE_V2_FEEDBACK=user-cmp6n0jf90000pf017gv1kukz`
   (Berik's **Telegram-bound** userId — NB DUAL ACCOUNT gotcha; do NOT use
   the email-bound id). Redeploy/restart to pick up env.
4. **SMOKE in real Telegram** (Berik):
   - Send a normal message, let the bot reply.
   - React: «без нравоучений, можно помягче».
   - Send `/axes` → expect a "🔧 Недавние коррекции" line like
     «ты попросил мягче — буду бережнее», and `conflict_tolerance`
     nudged down vs prior.
   - Re-ask the same question twice → confirm a re_ask correction logged
     (visible only if it yields an axis signal/styleNote).
5. **Aydana / `all`** — later, optional.

---

## Self-Review (checklist run against the spec)

**Spec coverage:**
- §3.1 единый принцип «всё через axes» → B5 applyFeedback `recordSignals('feedback')` ✓
- §3.2 не трогаем traits напрямую → E1 integration asserts `not refreshTraits/BotIdentity` ✓
- §3.3 стиль-команды = axis-сигналы → B2 prompt rules + parse ✓
- §4.1 source 'feedback' → A1 ✓
- §4.2 CorrectionLog → A1 model+migration, B5 writes ✓
- §5.1 pure helpers → B1 ✓
- §5.2 classifier → B2 ✓
- §5.3 mood-drop → B3 ✓
- §5.4 re-ask Voyage → B4 ✓
- §5.5 apply+recent → B5 ✓
- §5.6 singleton → B6 ✓
- §6 wiring + fetchBotLastMsg + 1-turn lag → C1 ✓
- §7 flag → C1 ✓
- §8 /axes transparency → D1 ✓
- §10 testing strategy (pure unit + structural + integration, zero vi.mock) → all tasks ✓
- §11 rollout (explicit approval per step, Telegram userId) → Rollout section ✓

**Placeholder scan:** none — every code step has full content.

**Type consistency:** `FeedbackResult`/`ImplicitFlags`/`FeedbackSignalType`
defined in B1 (types.ts), reused verbatim in B2/B5/C1. `AxisSignalInput`
reused from B1 user-axes. `recordSignals(userId, msgId, signals, 'feedback')`
matches B1 signature (4 args). `correctionLog.create` matches A1 model
fields exactly (botExcerpt/userExcerpt/appliedSignals/moodDelta/reaskSim).
`embedQuery`/`embeddingsEnabled`/`cosineSimilarity` import paths verified
against B1 codebase.

**Total:** 10 tasks (A1, B1-B6, C1, D1, E1). Mirrors B1/B2 granularity.
```
