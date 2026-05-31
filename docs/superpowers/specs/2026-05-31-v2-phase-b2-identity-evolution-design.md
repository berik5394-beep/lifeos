# v2.0 Phase B2 — Identity Evolution (BOT axes / emergent persona)

> **Approved by Berik 2026-05-31.** Second sub-project of Phase B (after
> B1 USER axes shipped + prod-verified). Quality bar = «Умный Джарвис».
> Tactical decisions made by agent per «выбери сам» directive
> (2026-05-31). The ONE strategic UX fork — proactive self-aware growth
> comments — Berik chose: **YES, rare, via KAIROS 4-gate, max 1/month.**

---

## 0. Reading order

1. §1 Контекст — что и зачем, чем отличается от B1/B3
2. §2 Архитектура overview
3. §3 BOT traits definition (4 traits + relationshipDepth)
4. §4 Schema + API
5. §5 Computation (pure, no Claude)
6. §6 Tone enrichment в system prompt
7. §7 Growth narrative (Claude haiku)
8. §8 Proactive self-aware growth comment (KAIROS gate)
9. §9 /identity Telegram command
10. §10 Weekly cron snapshot + refresh
11. §11 Bootstrap for existing users
12. §12 Failure modes
13. §13 Test strategy
14. §14 Rollout (feature flag)
15. §15 Self-review checklist
16. §16 Out of scope

---

## 1. Контекст и цели

### 1.1 Где Phase A + B1 оставили gap

Phase A: бот имеет **static** `BotIdentity.style = friendly|strict|calm|toxic`.
`BotIdentity.traits = "{}"` — пустой placeholder, спец явно сказал «Phase B
будет storing accumulated traits (axis signals)».

B1: смоделировал **USER** личность (4 axes) → меняет **CONTENT** советов.
B1 explicitly deferred **TONE** adaptation в B2.

Что не покрыто: бот сам — это статичная маска. Два разных пользователя
получают тон от одного `style`. Бот не «растёт». Реальный друг **меняется
с тобой**: становится теплее, прямее, может шутить — по мере того как
отношения углубляются.

### 1.2 Что B2 меняет

B2 наполняет `BotIdentity.traits` четырьмя **continuous BOT traits** +
**relationshipDepth** scalar. Бот:
1. **Подстраивает тон** под личность юзера (warmth выше для emotional-open,
   directness ниже для low conflict-tolerance)
2. **Растёт со временем** — depth увеличивается с interaction → бот теплее,
   прямее, играивее
3. **Осознаёт свою эволюцию** — `/identity` показывает persona + growth
   narrative; редко (max 1/мес) сам проактивно упоминает рост

### 1.3 Чем B2 ≠ B1 ≠ B3

| | Моделирует | Меняет | Mechanism |
|---|---|---|---|
| B1 | USER личность | CONTENT | Claude classifier + EWMA |
| **B2** | **BOT персона** | **TONE + self-awareness** | Deterministic f(user axes, depth) + snapshots |
| B3 | Корректирующая feedback | Исправление ошибок | Feedback loop (thumbs/re-asks/mood) |

B2 deterministic — нет «обучения от реакций» (это B3). B2 = persona
которая **функция от user-match + relationship tenure**. Чистое
разделение.

### 1.4 Concrete behavior change

Берик (B1: low CT 0.35, mid EO 0.65), relationshipDepth растёт:

**Сейчас (depth 0.10, неделя):**
- warmth 0.52, directness 0.38, humor 0.25
- Бот: осторожный, мягкий, мало шутит, больше слушает

**Через месяц (depth 0.40):**
- warmth 0.62, directness 0.48, humor 0.40
- Бот: теплее, чуть прямее, иногда шутит, ссылается на историю

**`/identity` (через месяц):**
> «Месяц назад я была осторожнее. Сейчас чувствую что могу быть честнее —
> ты ценишь прямоту больше мягкости. Стала теплее: тебе важна поддержка,
> не только дела.»

### 1.5 Non-goals (scope boundary)

B2 НЕ делает:
- USER axes (это B1, done)
- Corrective feedback loop / learning from reactions (это B3)
- Auto-tool-creation (это B4)
- Bot NAME evolution (имя меняется через /setname, не auto)
- ML/RL trait inference — deterministic formula только
- Per-message Claude call for traits (traits = pure compute; Claude
  only for narrative)

### 1.6 Benchmark for B2 done

- ✅ `BotIdentity.traits` содержит 4 traits + relationshipDepth для Berik
- ✅ Тон бота в Telegram отличается при low vs high depth (наблюдаемо)
- ✅ `/identity` показывает persona + growth narrative
- ✅ Weekly snapshot пишет BotTraitSnapshot rows
- ✅ Proactive growth comment fires макс 1/месяц через KAIROS gate
- ✅ Bootstrap computed initial traits для Berik+Aydana
- ✅ Feature flag FEATURE_V2_IDENTITY — byte-identical when off
- ✅ 0 регрессий в 1529 тестах

---

## 2. Архитектурный overview

```
┌──────────────────────────────────────────────────────────────┐
│  INBOUND msg → orchestrator                                   │
│           ↓                                                   │
│  buildJarvisPrompt + v2 enrichment                            │
│           ↓                                                   │
│  ★ tone block (NEW B2): refreshTraitsIfStale →                │
│     getTraits → formatToneSection                             │
│     "Твоя персона: warmth 0.62, directness 0.48, humor 0.40,  │
│      depth 0.40 (~1 месяц). Говори в этом тоне."             │
│           ↓                                                   │
│  Claude API → response (tone-adapted)                         │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  refreshTraits (lazy on msg if stale >6h, OR weekly cron)     │
│    stats = {msgCount, daysSinceFirst, distinctEntities,       │
│             emotionalMoments}                                 │
│    depth = computeRelationshipDepth(stats)         [pure]     │
│    userAxes = getUserAxesStore().getAxes(userId)   [B1 reuse] │
│    traits = computeBotTraits(userAxes, depth)      [pure]     │
│    persist → BotIdentity.traits                               │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Weekly cron tick:                                            │
│    refreshTraits(userId)                                      │
│    → snapshot current traits → BotTraitSnapshot row           │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Proactivity tick (existing engine):                          │
│    NEW detector: detectIdentityGrowth                         │
│    → if depth shifted significantly since last comment        │
│       (≥0.15) AND ≥30 days since last identity comment        │
│    → candidate {source: 'identity_growth'}                    │
│    → 4-gate filter (DND, rate, significance, dedup)           │
│    → nudge: growth narrative (Claude haiku)                   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  /identity Telegram command:                                  │
│    getTraits + growthNarrative(oldest vs current snapshot)    │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Components

| File | Est lines | Purpose |
|---|---|---|
| `prisma/schema.prisma` (edit) | +20 | `BotTraitSnapshot` model + reverse relation |
| `prisma/migrations/<ts>_v2_bot_traits/migration.sql` | ~35 | Idempotent table + indexes |
| `services/bot-traits/types.ts` | ~120 | Interface + BotTraitName + pure helpers (sigmoid, logNorm, traitLabel, computeRelationshipDepth, computeBotTraits) |
| `services/bot-traits/postgres-impl.ts` | ~220 | refreshTraits, getTraits, snapshot, snapshotHistory |
| `services/bot-traits/index.ts` | ~25 | Singleton accessor + reset |
| `services/bot-traits/growth-narrative.ts` | ~150 | Claude haiku compare snapshots → narrative |
| `services/bot-traits/tone-section.ts` | ~90 | formatToneSection pure helper |
| `services/v2-enrichment.ts` (edit) | +30 | Integrate tone section under flag |
| `services/proactive-scheduler.ts` (edit) | +25 | Weekly trait snapshot cron |
| `services/v2-proactivity-engine.ts` (edit) | +60 | detectIdentityGrowth detector + nudge |
| `services/telegram-bot.ts` (edit) | +50 | /identity command |
| `services/jarvis-orchestrator.ts` (edit) | +20 | refreshTraitsIfStale hook |
| `lib/feature-flags.ts` (edit) | +20 | isV2IdentityEnabled |
| `scripts/bootstrap-traits.ts` | ~120 | One-time compute traits for existing users |
| Tests across all | ~950 | Pure unit + structural |

**Total estimate:** ~2200 lines code+tests.

### 2.2 Dependency on B1

B2 reuses B1's `getUserAxesStore().getAxes(userId)` for the userEO/userCT
inputs. **B1 must be deployed (it is).** If user has axes flag off →
B2 uses neutral 0.5 axes (graceful — traits still vary by depth).

---

## 3. BOT traits definition

4 traits + 1 depth scalar. All Float [0, 1]. Semantic labels mirror B1's
axisLabel buckets.

### 3.1 warmth (W)

How affectionate/caring vs neutral-professional the bot is.
- **Low (0.2):** деловой, по делу, минимум эмоциональных слов
- **High (0.8):** тёплый, заботливый, «обнимаю», эмоциональная поддержка
- **Driven by:** userEO (emotional-open юзер ценит тепло) + depth

### 3.2 directness (D)

How blunt vs diplomatic.
- **Low (0.2):** обходительный, смягчает, «может быть стоит»
- **High (0.8):** прямой, «вот что не так», без обиняков
- **Driven by:** userCT (high conflict-tolerance = право на честность) + depth
  (доверие зарабатывает право быть прямым)

### 3.3 humor (H)

Playful banter, callbacks, inside jokes.
- **Low (0.2):** серьёзный, без шуток
- **High (0.8):** играет, шутит, ссылается на shared moments
- **Driven by:** depth (юмор требует доверия) + small userEO

### 3.4 playfulness (P)

Energy / expressiveness of style.
- **Low (0.2):** спокойный, ровный, размеренный
- **High (0.8):** энергичный, expressive, emoji, восклицания
- **Driven by:** depth + userEO

### 3.5 relationshipDepth (depth)

Scalar [0, 1] growing with relationship tenure + richness. NOT a "trait"
shown as bot persona — it's the **driver** that makes traits grow over
time. Grows slowly (months to high).

Inputs:
- `messageCount` — total user+assistant msgs
- `daysSinceFirst` — days since first ChatMessage
- `distinctEntities` — count of Entity rows (richness of shared history)
- `emotionalMoments` — count of MoodSnapshot rows with |valence| > 0.4

### 3.6 Why 4 traits + depth, not more

- formality skipped — LifeOS is always «ты» (informal), no axis needed
- 4 traits cover the observable tone dimensions a friend varies
- depth is the time-axis that makes "evolution" real (vs B1's content
  which is timeless)

---

## 4. Schema + API

### 4.1 Prisma — extend traits JSON + new snapshot table

`BotIdentity.traits` (existing `Json @default("{}")`) now holds:

```json
{
  "warmth": 0.62,
  "directness": 0.48,
  "humor": 0.40,
  "playfulness": 0.45,
  "relationshipDepth": 0.40,
  "lastComputedAt": "2026-05-31T09:00:00Z"
}
```

No schema change to BotIdentity — just structured usage of existing JSON.

New table for snapshots (growth narrative needs history):

```prisma
model BotTraitSnapshot {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  // Snapshot of all 4 traits + depth at recordedAt
  warmth        Float
  directness    Float
  humor         Float
  playfulness   Float
  depth         Float
  recordedAt    DateTime @default(now())

  @@index([userId, recordedAt])
}
```

Add reverse relation on User: `botTraitSnapshots BotTraitSnapshot[]`.

### 4.2 API surface

```typescript
// services/bot-traits/types.ts

export type BotTraitName = 'warmth' | 'directness' | 'humor' | 'playfulness';

export const BOT_TRAIT_NAMES: readonly BotTraitName[] = [
  'warmth', 'directness', 'humor', 'playfulness',
] as const;

export interface BotTraits {
  warmth: number;
  directness: number;
  humor: number;
  playfulness: number;
  relationshipDepth: number;
  lastComputedAt: Date | null;
}

export interface RelationshipStats {
  messageCount: number;
  daysSinceFirst: number;
  distinctEntities: number;
  emotionalMoments: number;
}

export interface TraitSnapshot {
  warmth: number;
  directness: number;
  humor: number;
  playfulness: number;
  depth: number;
  recordedAt: Date;
}

export interface BotTraitsStore {
  /** Read current traits; compute defaults if BotIdentity.traits empty. */
  getTraits(userId: string): Promise<BotTraits>;

  /** Recompute traits from user axes + relationship stats, persist to
   *  BotIdentity.traits. Best-effort: never throws. */
  refreshTraits(userId: string): Promise<BotTraits>;

  /** Refresh only if lastComputedAt is older than staleMs (default 6h).
   *  Returns current traits either way. */
  refreshTraitsIfStale(userId: string, staleMs?: number): Promise<BotTraits>;

  /** Write a BotTraitSnapshot row with current traits. */
  snapshot(userId: string): Promise<void>;

  /** Snapshot history for growth narrative (oldest first). */
  snapshotHistory(userId: string, limit?: number): Promise<TraitSnapshot[]>;
}
```

### 4.3 Migration SQL (idempotent)

```sql
CREATE TABLE IF NOT EXISTS "BotTraitSnapshot" (
  "id"           TEXT PRIMARY KEY,
  "userId"       TEXT NOT NULL,
  "warmth"       DOUBLE PRECISION NOT NULL,
  "directness"   DOUBLE PRECISION NOT NULL,
  "humor"        DOUBLE PRECISION NOT NULL,
  "playfulness"  DOUBLE PRECISION NOT NULL,
  "depth"        DOUBLE PRECISION NOT NULL,
  "recordedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BotTraitSnapshot_userId_fkey') THEN
    ALTER TABLE "BotTraitSnapshot"
      ADD CONSTRAINT "BotTraitSnapshot_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BotTraitSnapshot_userId_recordedAt_idx"
  ON "BotTraitSnapshot"("userId", "recordedAt");
```

---

## 5. Computation (pure, no Claude)

### 5.1 relationshipDepth

```typescript
/** Logarithmic normalization — maps [0, ∞) to [0, 1) with diminishing
 *  returns. cap is the value at which output ≈ 0.9. */
export function logNorm(value: number, cap: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(cap));
}

export function computeRelationshipDepth(stats: RelationshipStats): number {
  const msg = logNorm(stats.messageCount, 500);      // ~500 msgs → deep
  const days = logNorm(stats.daysSinceFirst, 365);   // ~1 year → deep
  const ent = logNorm(stats.distinctEntities, 100);  // ~100 entities → rich
  const emo = logNorm(stats.emotionalMoments, 50);   // ~50 emotional moments
  const weighted = 0.30 * msg + 0.30 * days + 0.20 * ent + 0.20 * emo;
  return Math.max(0, Math.min(1, weighted));
}
```

### 5.2 computeBotTraits

```typescript
export function computeBotTraits(
  userEO: number,   // emotional_openness from B1 (default 0.5)
  userCT: number,   // conflict_tolerance from B1 (default 0.5)
  depth: number,
): { warmth: number; directness: number; humor: number; playfulness: number } {
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  return {
    warmth:      clamp01(0.45 + 0.30 * userEO + 0.25 * depth),
    directness:  clamp01(0.30 + 0.45 * userCT + 0.25 * depth),
    humor:       clamp01(0.20 + 0.50 * depth + 0.15 * userEO),
    playfulness: clamp01(0.30 + 0.30 * depth + 0.20 * userEO),
  };
}
```

Properties:
- At depth=0, userEO=userCT=0.5: warmth=0.60, directness=0.525, humor=0.275, playfulness=0.40
- At depth=1, same axes: warmth=0.85, directness=0.775, humor=0.85, playfulness=0.80
- Monotonic in depth — bot warms up over time ✓
- Responsive to user axes — different bots for different users ✓

### 5.3 traitLabel (reuse B1 axisLabel pattern)

```typescript
export function traitLabel(value: number): string {
  if (value < 0.2) return 'очень низкий';
  if (value < 0.4) return 'низкий';
  if (value <= 0.6) return 'средний';
  if (value <= 0.8) return 'высокий';
  return 'очень высокий';
}
```

---

## 6. Tone enrichment в system prompt

`formatToneSection` (pure helper in `tone-section.ts`):

```
## Твоя персона (как ты звучишь — continuous 0..1)

- warmth: 0.62 (высокий) — будь тёплой, показывай заботу, эмоциональную
  поддержку. Не только дела — человек.
- directness: 0.48 (средний) — говори честно, но мягко обрамляй. Не руби
  с плеча, но и не виляй.
- humor: 0.40 (низкий) — лёгкие шутки уместны изредка, но без перебора.
  Юзер пока не настроен на много юмора.
- playfulness: 0.45 (средний) — умеренная энергия. Не слишком ярко, не
  слишком сухо.

Глубина связи: 0.40 (знакомы ~1 месяц, 47 сообщений). Можешь ссылаться
на прошлые разговоры, но без излишней фамильярности.
```

Generated per-user from `getTraits(userId)`. Integrated into
`buildV2EnrichmentBlock` after axes section, gated by
`isV2IdentityEnabled(userId)`.

Guidance bucketed per trait per level (4 levels each), like B1 §7.2.

---

## 7. Growth narrative (Claude haiku)

`growth-narrative.ts`:

```typescript
export async function generateGrowthNarrative(
  userId: string,
  oldest: TraitSnapshot | null,
  current: BotTraits,
  botName: string,
): Promise<string>
```

If no oldest snapshot (< 2 weeks of history) → return a "still getting to
know you" message (no Claude call needed).

Else: Claude haiku compares oldest vs current, produces 2-4 sentence
first-person narrative. Best-effort: on failure return a template fallback.

System prompt:
```
Ты — {botName}, AI-друг. Опиши как ты ИЗМЕНИЛАСЬ в общении с
пользователем, сравнив свою персону тогда и сейчас.

ТОГДА ({oldest.recordedAt}): warmth {o.warmth}, directness {o.directness},
  humor {o.humor}, playfulness {o.playfulness}, depth {o.depth}
СЕЙЧАС: warmth {c.warmth}, directness {c.directness}, humor {c.humor},
  playfulness {c.playfulness}, depth {c.relationshipDepth}

ПРАВИЛА:
1. От первого лица («я стала...»).
2. 2-4 предложения. Тепло, искренне.
3. Описывай РЕАЛЬНУЮ дельту: что выросло, что осталось.
4. Без цифр в тексте — естественная речь.
5. Только русский.
```

---

## 8. Proactive self-aware growth comment (KAIROS gate)

**Berik chose: rare, via 4-gate, max 1/month.**

New detector in `v2-proactivity-engine.ts`:

```typescript
async function detectIdentityGrowth(userId: string): Promise<NudgeCandidate[]> {
  try {
    const store = getBotTraitsStore();
    const current = await store.getTraits(userId);
    const history = await store.snapshotHistory(userId, 50);
    if (history.length < 2) return [];

    // Find last identity-growth comment (via Insight dedup)
    const lastComment = await prisma.insight.findFirst({
      where: { userId, source: 'v2-proactivity', kind: 'identity_growth' },
      orderBy: { createdAt: 'desc' },
    });
    const daysSinceComment = lastComment
      ? (Date.now() - lastComment.createdAt.getTime()) / 86400_000
      : Infinity;
    if (daysSinceComment < 30) return [];  // max 1/month

    // Compare depth shift since last comment (or oldest snapshot)
    const baseline = lastComment
      ? history.find((h) => h.recordedAt > lastComment.createdAt) ?? history[0]
      : history[0];
    const depthShift = current.relationshipDepth - baseline.depth;
    if (depthShift < 0.15) return [];  // significant shift only

    return [{
      source: 'identity_growth',
      significance: Math.min(1, depthShift * 3),
      payload: { depthShift, baseline, current },
      toneHint: 'warm',
    }];
  } catch (err) {
    console.warn('[proactivity:identity-growth] failed:', err);
    return [];
  }
}
```

Wired into `detectCandidates` (the engine's aggregator). Then standard
4-gate (DND → rate ≤2/day → significance ≥0.6 → dedup 7d) applies, PLUS
the built-in 30-day identity-specific dedup above.

Nudge text = `generateGrowthNarrative` output (warm, first-person).

Insight written with `kind: 'identity_growth'` for the 30-day dedup.

---

## 9. /identity Telegram command

```
/identity →

Я — Соя 🤍

Сейчас с тобой я:
🔥 warmth: 0.62 (высокий)
🎯 directness: 0.48 (средний)
😄 humor: 0.40 (низкий)
⚡ playfulness: 0.45 (средний)

Глубина связи: 0.40 — знакомы ~1 месяц, 47 сообщений.

Как я изменилась:
{growth narrative — Claude haiku, or "ещё узнаём друг друга" if < 2 weeks}
```

Gated by `isV2IdentityEnabled`. Best-effort with friendly fallback.

---

## 10. Weekly cron snapshot + refresh

Hook into existing `proactive-scheduler.ts` tick using `withCronLock`
(from Week 6). Weekly job:

```typescript
async function botTraitsSnapshotCron(): Promise<void> {
  const activeUsers = await findActiveUsers(7); // reuse pattern-extraction logic
  for (const userId of activeUsers) {
    try {
      await getBotTraitsStore().refreshTraits(userId);
      await getBotTraitsStore().snapshot(userId);
    } catch (err) {
      console.warn(`[cron:bot-traits] user=${userId}:`, err);
    }
  }
}
```

Wired in tick via `withCronLock('bot-traits-snapshot', 7*24h, null, ...)`,
gated by `isV2CronEnabled()` (existing).

---

## 11. Bootstrap for existing users

`scripts/bootstrap-traits.ts` (mirrors bootstrap-axes pattern):

```
For --user=<id> --apply:
  1. Compute RelationshipStats from existing data (ChatMessage count,
     first msg date, Entity count, MoodSnapshot |valence|>0.4 count)
  2. refreshTraits(userId) — computes + persists current traits
  3. snapshot(userId) — first BotTraitSnapshot (baseline for narrative)
  4. Report
```

CLI: `npx tsx scripts/bootstrap-traits.ts --user=<id> --dry-run | --apply`.

For Berik: he has ~57 ChatMessages, ~69 entities, several MoodSnapshots,
~3 days tenure → depth will be modest (~0.10-0.15), traits warm-ish from
his EO 0.65.

---

## 12. Failure modes

| # | Mode | Detection | Mitigation |
|---|---|---|---|
| 1 | User axes flag off (no B1 data) | getAxes returns defaults 0.5 | Traits still computed from depth + neutral axes; graceful |
| 2 | BotIdentity.traits malformed JSON | parse try/catch | Recompute from scratch via refreshTraits |
| 3 | Claude narrative 429/network | best-effort | Template fallback narrative |
| 4 | No snapshot history (< 2 weeks) | history.length < 2 | "still getting to know you" message, no Claude call |
| 5 | depth computation div-by-zero | logNorm guards value<=0 | Returns 0 |
| 6 | refreshTraits DB failure | try/catch | Return last-known traits (or defaults); never throws |
| 7 | BotTraitSnapshot unbounded growth | ~52 rows/user/year (weekly) | Negligible; no retention needed |
| 8 | Proactive growth comment spam | 30-day dedup + 4-gate | Hard-capped 1/month per the gate |
| 9 | Tone change too abrupt | depth slow (logNorm + weekly) | Months to shift; no yo-yo |
| 10 | Flag flip mid-session | isV2IdentityEnabled checked each entry | Off → tone section omitted, bot uses static style |
| 11 | Two msgs race on refreshTraits | last-writer-wins on BotIdentity.traits | Acceptable — both compute same deterministic value |
| 12 | User deletes account | FK CASCADE on BotTraitSnapshot | Cleaned |

---

## 13. Test strategy

### 13.1 Pure unit (90%+)
- `logNorm` — boundary, cap, zero/negative
- `computeRelationshipDepth` — monotonic, bounded, weighted
- `computeBotTraits` — monotonic in depth, responsive to axes, clamped
- `traitLabel` — buckets
- `formatToneSection` — null traits, all levels

### 13.2 Structural (readFileSync + grep)
- postgres-impl methods call correct Prisma
- growth-narrative calls Claude haiku + best-effort
- proactivity detector wired + 30-day dedup + depth-shift threshold
- cron wired with withCronLock
- /identity command registered + gated

### 13.3 Integration smoke
- orchestrator → refreshTraitsIfStale → tone section in prompt
- scheduler → bot-traits-snapshot cron

### 13.4 Behavioral SMOKE (Berik)
1. `/identity` → shows persona + "ещё узнаём" (< 2 weeks)
2. Observe tone over days as depth grows (subjective)
3. After bootstrap + weekly snapshots accumulate → `/identity` narrative

### 13.5 Test count target
- ~70 unit + ~25 structural + ~10 integration = **~105 new tests**
  (1529 → ~1634)

---

## 14. Rollout (feature flag)

```
Stage 1 (deploy): code merged, migration applied, FEATURE_V2_IDENTITY=none
Stage 2 (Berik): FEATURE_V2_IDENTITY=user-{berikId}, bootstrap-traits applied
Stage 3 (Aydana): add aydana
Stage 4 (all): FEATURE_V2_IDENTITY=all
```

```typescript
export function isV2IdentityEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_IDENTITY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

Rollback: set `=none`, redeploy → bot uses static `style` again, traits
data preserved.

---

## 15. Self-review checklist

### Placeholder scan
- [ ] No TBD/TODO in production sections
- [ ] All API signatures complete
- [ ] Migration SQL valid + idempotent

### Internal consistency
- [ ] All API methods referenced in §2 diagram defined in §4.2
- [ ] 4 trait definitions (§3) consistent with computeBotTraits (§5.2)
- [ ] tone section levels (§6) consistent with traitLabel buckets (§5.3)
- [ ] Proactivity dedup (30-day, §8) consistent with KAIROS gate

### Ambiguity check
- [ ] depth weights specified (0.30/0.30/0.20/0.20)
- [ ] trait formulas specified (§5.2)
- [ ] stale threshold specified (6h)
- [ ] proactive dedup specified (30 days)
- [ ] depth shift threshold for growth comment (0.15)
- [ ] logNorm caps specified (500/365/100/50)

### Scope check
- [ ] USER axes NOT in B2 (B1, done)
- [ ] Feedback loop NOT in B2 (B3)
- [ ] No ML — deterministic formula
- [ ] No per-message Claude for traits (only narrative)
- [ ] Bot name evolution NOT auto (manual /setname)

### Edge cases
- [ ] B1 flag off → neutral axes graceful
- [ ] No snapshot history → no Claude narrative
- [ ] Flag off → byte-identical static style
- [ ] Account delete → CASCADE

### Test coverage
- [ ] Pure helpers all unit-tested
- [ ] Structural for all wiring
- [ ] Behavioral SMOKE Berik scenarios

---

## 16. Open questions

**None.** Tactical decisions made per «выбери сам» (2026-05-31). The one
strategic UX fork (proactive growth comments) — Berik chose YES, rare,
KAIROS-gated, max 1/month. Spec complete + self-contained.

---

## 17. Status

- ✅ Brainstorm complete (Berik approved 2026-05-31)
- ✅ Design spec written
- ⏳ Spec self-review
- ⏳ Berik reviews written spec
- ⏳ Implementation plan via writing-plans skill
- ⏳ Execution via subagent-driven-development

---

## Discipline reminder

Pacta sunt servanda. «Выбери сам» (2026-05-31) применяется к тактическим
решениям inside locked scope — НЕ к scope expansion. Любое «давай ещё
это» → СТОП → спросить Berik. Quality bar: «Умный Джарвис».
