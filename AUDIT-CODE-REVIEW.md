# LifeOS — Code Review Audit
Date: 2026-04-11
Reviewer: Claude Code Agent (Opus 4.6)

## Summary
- Files reviewed: 18 server routes + 3 middleware + index.ts + crypto lib + 8 mobile screens + api.ts + chat-store + task-store + use-voice hook
- Critical (P0): 4 issues
- High (P1): 11 issues
- Medium (P2): 14 issues
- Focus: code quality, N+1 queries, type safety, error handling, stale patterns

---

## P0 — Must Fix

### [1] N+1 query storm in calculateStreak (up to 365 SELECTs per chat/voice request)
**Files:**
- `packages/server/src/routes/chat.ts:675-707`
- `packages/server/src/routes/voice.ts:337-375`
- `packages/server/src/routes/export.ts:281-302`

**Problem:** The streak function runs `prisma.habitLog.count(...)` inside a `for (let i = 0; i < 365; i++)` loop. Every assistant/chat request triggers up to 365 individual round-trips to Postgres. At 1-3ms per round-trip, that's 0.5-1s of pure IO per request with ZERO cached state.
**Impact:** Every `POST /voice/chat`, `POST /voice/assistant`, and `POST /export/story` is O(365) DB queries. With 10 concurrent users chatting, this single function is consuming most of the connection pool.
**Fix:** Replace with a single query: `prisma.habitLog.groupBy({ by: ['date'], where: { userId, completed: true, date: { gte: yearAgo } }, _count: true })`. Then iterate the result in memory. Reduces 365 queries → 1 query.

### [2] Arena `find-opponent` and `leaderboard` endpoints issue 2N+1 queries each
**File:** `packages/server/src/routes/arena.ts:200-230` (find-opponent), `arena.ts:452-478` (leaderboard)
**Problem:** Both endpoints `Promise.all(opponents.map(async ...))` where each iteration does `prisma.pet.findUnique` AND calls `calculatePowerScore` which itself does another `prisma.pet.findUnique({ include: { items: true } })`. Leaderboard is over TOP 50 players → 100+ queries per leaderboard hit. `find-opponent` also does duplicate power calculation (2× per opponent).
**Impact:** Leaderboard page fetch = 100+ sequential queries; find-opponent = 10+ queries. Both in hot path of gameplay loop.
**Fix:** Load all pets in one `prisma.pet.findMany({ where: { userId: { in: userIds } }, include: { items: true } })`, then compute power in memory. Also memoize `calculatePowerScore` per userId within a single request.

### [3] vision.ts writes to non-existent Task schema fields — silently drops all imports
**File:** `packages/server/src/routes/vision.ts:269-287` (import-schedule handler)
**Problem:** Creates tasks with `description: ...` and `timeBlock: ...` cast to `as any`. Neither field exists on the `Task` model in `schema.prisma` (actual fields: title, category, priority, date, time, completed, notes). The `.catch(() => null)` on each create swallows the Prisma error silently and filters nulls out, so the endpoint returns `{ok: true, created: 0}` while the user thinks it worked.
**Impact:** The entire "import schedule from photo" feature is non-functional end-to-end. Silent data loss.
**Fix:** Map correctly: `notes: [item.time && ⏰ ${item.time}, item.teacher, item.notes].filter(Boolean).join(' • ')`, `time: item.time || null`. Remove `as any`, remove `.catch(() => null)` swallow, surface the error.

### [4] api.ts token refresh: the refreshPromise is never actually assigned — race window is open
**File:** `apps/mobile/services/api.ts:20-72`
**Problem:** `refreshPromise` is declared but never set to a promise. The intended "single-flight" pattern is broken:
```ts
if (isRefreshing && refreshPromise) { await refreshPromise; ... }
// ...
isRefreshing = true;
// ...body of refresh inline, refreshPromise never assigned...
```
Two concurrent 401s will both set `isRefreshing = true`, skip the guard (because `refreshPromise` is null), and race to POST `/auth/refresh`. Because the server now uses refresh-token ROTATION with revocation detection (auth.ts:219), the second request will use an already-revoked token → server logs "🚨 Подозрительная активность" and revokes ALL tokens → user gets logged out of every device.
**Impact:** Users lose sessions randomly whenever two background API calls both hit 401 at the same time (e.g. dashboard mount fires 5 parallel fetches). High-severity UX bug tied directly to the hardened auth flow.
**Fix:** `refreshPromise = (async () => { ... })();` and `await refreshPromise;` then return `useAuthStore.getState().token`. Clear `refreshPromise = null` only in `finally`.

---

## P1 — Should Fix

### [5] Mana side-effect on every habit/task completion is an N+1 hidden in the CRUD path
**Files:** `packages/server/src/routes/tasks.ts:123-133`, `habits.ts:132-142`
**Problem:** After every habit/task complete, the code does `findUnique(pet) → update(pet)`. That's 2 extra queries per completion. Worse, `pet.maxMana` is fetched just to clamp — the whole thing can be one `UPDATE pet SET mana = LEAST(maxMana, mana + 10) WHERE userId = $1`.
**Impact:** Doubles write load on the hot path and introduces a race: concurrent completions can both read `mana=50` and both write `mana=55` instead of `60`.
**Fix:** Single atomic statement using `prisma.$executeRaw` with `LEAST(max_mana, mana + 10)`, or use `update({ data: { mana: { increment: 10 } } })` and clamp in a scheduled job / at read time.

### [6] Challenge active/history endpoints do 2× findUnique per challenge (N+1)
**File:** `packages/server/src/routes/challenge.ts:279-300`, `challenge.ts:318-332`
**Problem:** `Promise.all(challenges.map(async (c) => { const attacker = findUnique(user[c.attackerId]); const defender = findUnique(user[c.defenderId]); ... }))`. 20 challenges = 40 user queries.
**Fix:** Collect all unique userIds first, single `prisma.user.findMany({ where: { id: { in: ids } }, select: { id, name } })`, build a Map, then enrich.

### [7] Expensive token-refresh write pattern in auth refresh — 2 UPDATE + 1 INSERT, all sequential
**File:** `packages/server/src/routes/auth.ts:242-249`
**Problem:** `createRefreshToken` runs a `prisma.refreshToken.create`, then immediately after the route does a separate `prisma.refreshToken.update` on the old one. Two sequential writes in one request. Also: because the two statements aren't wrapped in `prisma.$transaction([...])`, if the second one crashes the old token is live AND a new token is live — user can effectively have two valid refresh chains.
**Impact:** Consistency bug: a crashed revoke between new-create and old-revoke leaves both tokens usable, breaking the "one live refresh token" invariant that the revocation-detection logic depends on.
**Fix:** Wrap in `prisma.$transaction([...])`.

### [8] pet.ts GET /pet mutates pet state AND auto-unlocks items on every read
**File:** `packages/server/src/routes/pet.ts:108-335`
**Problem:** GET /pet is supposed to be a read. It does:
1. `prisma.pet.update({ data: { health, happiness, stage, roomLevel, lastActive } })` — write
2. `prisma.petItem.findMany` + conditional `createMany` — write
3. A chain of count queries for every category (10+ queries)

It means a mobile client that pulls GET /pet on every screen focus (which `usePetStore.fetchPet` does) will be writing to the DB constantly. Also violates HTTP semantics (GET is supposed to be idempotent). Also creates race conditions because two focus events within 1s will both try to insert the same PetItem (the `skipDuplicates: true` saves correctness but not the lock contention).
**Impact:** Significant write amplification. Bad for DB and bad for mobile battery (every GET triggers a full recomputation).
**Fix:** Split this into GET /pet (read-only, returns cached state + computed health) and POST /pet/tick (explicit recompute, called e.g. on day rollover or after habit completion).

### [9] arena.ts battle writes are not in a transaction — partial success is possible
**File:** `packages/server/src/routes/arena.ts:323-381`
**Problem:** battle logic does: create(battle) → update(attackerProfile) → update(defenderProfile) → update(attackerPet). Four separate awaits. If the second or third crashes, the battle is recorded but trophies are inconsistent. The defender might be charged a loss the attacker was never credited for.
**Impact:** Data corruption under load.
**Fix:** Wrap in `prisma.$transaction`.

### [10] chat.ts & voice.ts: AssistantContext loads full user context on EVERY chat turn
**File:** `packages/server/src/routes/chat.ts:333-441`, `voice.ts:65-205`
**Problem:** Every single chat/voice message triggers ~7 parallel queries just to build the system prompt (tasks, habits, habitLogs, events, expense agg, budget agg, yearly goals), PLUS calculateStreak (365 queries — see P0[1]), PLUS calculateWeekProgress. At say 50 messages/user/day × 100 users = 5000 context-builds/day × ~375 queries each = 1.9M queries/day just for context — 99% of which is stale info.
**Fix:** Cache AssistantContext in memory (Node-local Map, 30-60s TTL keyed by userId). Invalidate on writes. Or at minimum push the full context fetch off the hot path and fetch a slim version.

### [11] calculateStreak duplicated in THREE files — known issue, priority raised because it's the P0[1] hot spot
**Files:** `chat.ts:675-707`, `voice.ts:337-375`, `export.ts:281-302`
**Problem:** Three copies of the same broken function. Cannot optimize one without forgetting another. (Flagged in task; Architecture agent will deep-dive.) Mention here because fix for P0[1] must touch all three.
**Fix:** Extract to `packages/server/src/services/streak.ts`. Single source of truth.

### [12] chat.ts webSearch uses axios-less fetch → DuckDuckGo HTML scraper, no timeout, no User-Agent
**File:** `packages/server/src/routes/chat.ts:18-48` (webSearch function)
**Problem:** The web search tool for the chat assistant scrapes duckduckgo.com HTML with plain `fetch`. There's no timeout — a hanging DDG response can block the request for Node's default (infinity). No User-Agent header means DDG may block or return a captcha page. No fallback.
**Impact:** A single slow search can block the chat request until client timeout; users see spinner forever.
**Fix:** Wrap in `AbortController` with 5s timeout. Set User-Agent. On failure, return "" so Claude can answer without search.

### [13] events.ts /events query accepts any, builds where clause via `Record<string, unknown>`
**File:** `packages/server/src/routes/events.ts:75-98`
**Problem:** Query params `date|week|month` are not Zod-validated. `date?: string` is passed straight into `new Date(date)`. Malformed strings → `Invalid Date` → Prisma may throw cryptic errors, or worse, return all rows. `where: Record<string, unknown> = { userId: request.userId }` then conditional overwrites lose Prisma's type guarantees.
**Fix:** Zod-validate query params: `z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ... })`. Build `where` as `Prisma.CalendarEventWhereInput`.

### [14] `any`-typed error catches leak types in vision.ts, voice.ts, challenge.ts
**Files:** `vision.ts:110,150,173,184,237,294`, `voice.ts:306`, `challenge.ts:178,193`
**Problem:** 10+ uses of `: any` across error handling and helpers violate CLAUDE.md strict typing rule. `challenge.ts:178-193` uses `updateData: any` and `result: any` that defeat all Prisma type checking on the update path.
**Fix:** Use `unknown` for errors and narrow; use proper Prisma update input types (`Prisma.ChallengeUpdateInput`).

### [15] import.ts: JSON.parse on a regex-matched `{[\s\S]*}` substring with no size limit
**File:** `packages/server/src/routes/import.ts:66-72`
**Problem:** `analyzeWithClaude` takes Claude's response, greedy-matches the first `{` to the last `}`, and JSON.parses. No size limit, no validation of shape, then casts result to `{ purpose: string; items: unknown[] }` via unchecked `as`. If Claude returns `{ "purpose": "x", "items": "not an array" }`, it passes through and `analysis.items.length` will NaN-crash the route.
**Fix:** Zod-validate parsed output: `z.object({ purpose: z.enum([...]), items: z.array(z.unknown()) })`. On parse failure, return a structured error.

### [16] chat-store `hasMore` flag off-by-one
**File:** `apps/mobile/stores/chat-store.ts:108`
**Problem:** `hasMore: messages.length >= 20`. Server returns up to `limit=20` items. On the exact page boundary, `hasMore` will be true for a full page forever. The subsequent call returns 0 items but that only flips hasMore to false on the NEXT call. User sees loading spinner loop.
**Fix:** `hasMore: messages.length === 20`, and also stop on empty response.

### [17] API_URL hardcoded to a private LAN IP in swipe-home.tsx and api.ts default
**Files:** `apps/mobile/app/swipe-home.tsx:20`, `apps/mobile/services/api.ts:1`
**Problem:** `const API = process.env.EXPO_PUBLIC_API_URL || 'http://172.20.10.4:3000';`. If `.env` is missing during a TestFlight/Play build, the app will try to contact a private LAN IP and fail silently.
**Fix:** Fail loudly in production if `EXPO_PUBLIC_API_URL` is unset. Remove the LAN fallback.

### [18] Mobile chat screen reads wrong field from voice/assistant response
**File:** `apps/mobile/app/(tabs)/index.tsx:358`
**Problem:** `setEveningMessage(response.reply)` but `voice.ts:247-248` returns `{ response: responseText, context: ... }`. The field is `response`, not `reply`. `response.reply` is `undefined`, so the evening ritual silently shows the empty-string fallback.
**Fix:** `setEveningMessage(response.response)`, or (better) rename the server field to `reply` and update both sides.

---

## P2 — Nice to Have

### [19] swipe-home.tsx: pervasive variable name obfuscation (s, pg, ti, ct, tH, cH, wD, yP, bal, inc, sp, hdr)
**File:** `apps/mobile/app/swipe-home.tsx` (entire file, 514 lines)
**Problem:** Variables are 1-4 character minified. `s` is the StyleSheet (conflicts with Zustand selectors), `ct` is current task, `wD/wT` is weekly-done/total, etc. Makes the file unreadable and error-prone.
**Fix:** Rename during next touch. Not urgent but painful for any future debug pass.

### [20] swipe-home.tsx uses direct `fetch(`${API}/challenge/mana`, { headers })` instead of `api.get`
**File:** `apps/mobile/app/swipe-home.tsx:74-75, 118`
**Problem:** Bypasses the `api` service, meaning no 401 → refresh retry. If the user's access token expires while on swipe-home, these two endpoints will silently fail while the rest of the app auto-recovers.
**Fix:** Use `api.get('/challenge/mana', token)`.

### [21] Inline styles violate CLAUDE.md rule ("StyleSheet.create, НЕ inline styles")
**Files:** 14 files, 27 occurrences, worst offenders: `swipe-home.tsx` (8), `battle-screen.tsx` (3), `arena.tsx` (2), `nutrition.tsx` (2)
**Problem:** Explicit CLAUDE.md rule violated. `tasks.tsx:605` has `style={{ marginTop: 12, backgroundColor: '#EF4444' } as any}` — inline style AND `as any` in one expression.
**Fix:** Move to StyleSheet.create variants. Keep inline only for truly dynamic values (e.g. animated transforms, progress widths).

### [22] Mobile screens use `.map((item, i) => … key={i} …)` or fallback keys like `key={h.id||`h${i}`}`
**File:** `apps/mobile/app/swipe-home.tsx:31, 166, 373` and several uses of `key={g.id||`wg${i}`}`
**Problem:** Using index keys breaks React reconciliation when items reorder/delete. Fallback keys suggest the store may return items without IDs — that should be fixed at the source, not papered over.
**Fix:** Always use stable IDs. If store sometimes lacks IDs, fix the store.

### [23] habit-log unique index only on (habitId, date) — query at habits.ts:153 uses (userId, date)
**File:** `packages/server/prisma/schema.prisma:112-114`, consumer `habits.ts:147-164`
**Problem:** `@@index([userId, date])` exists (good), but the query also filters `completed: true`. Consider a partial index `CREATE INDEX ... WHERE completed = true` for read-heavy streak/stats queries. Currently not needed due to small data volume, but this is the P0[1] bottleneck.
**Fix:** Add partial index once data grows, or after fixing P0[1] with a groupBy.

### [24] JSON fields used for querying in Integration.settings, User.settings
**Files:** `schema.prisma:261-269`, consumer `achievements.ts:295-305`
**Problem:** `prisma.user.findUnique({ select: { settings: true } })` then client-side reads `settings.activeTheme`. Fine for small configs but as settings grow, every read deserializes the whole blob. Also `activeTheme` is effectively a structured field hidden in Json — violates CLAUDE.md which says `activeTheme` should be a top-level column on User (which it is in the CLAUDE.md schema, but NOT in the actual `schema.prisma`).
**Fix:** Add `activeTheme String @default("default")` as a column; drop the JSON round-trip.

### [25] CORS logic: `origin.includes('192.168.')` allows any 192.168.x origin in dev
**File:** `packages/server/src/index.ts:84`
**Problem:** `origin.includes('192.168.')` also matches `https://192.168.evil.com`. Not production-critical because the block is `!isProduction`, but still sloppy.
**Fix:** Use URL parsing: `const hostname = new URL(origin).hostname; hostname.startsWith('192.168.')`.

### [26] voice.ts and chat.ts build IDENTICAL 8-query AssistantContext blocks
**Files:** `voice.ts:85-205` and `chat.ts:333-441`
**Problem:** Same queries copy-pasted. Context building should be one `buildAssistantContext(userId)` helper. (Architecture agent will see this.)
**Fix:** Extract `services/assistant-context.ts`.

### [27] pet.ts revive method `three_days` has date-boundary bug
**File:** `packages/server/src/routes/pet.ts:396-419`
**Problem:** The loop does `const date = new Date(today); date.setDate(date.getDate() - i)` and then queries `prisma.task.count({ where: { ..., date: dayStart } })`. But for i=0 (today), if the user's day hasn't started yet or is still in progress, the completion ratio is artificially low. Also no handling of timezones: the server uses `new Date()` which is server local time, not user's TZ. A user in GMT+5 finishing habits at 11pm local will be counted against the next UTC day.
**Fix:** Store all dates in UTC explicitly and accept a TZ offset from the client, OR use the user's TZ column (to be added).

### [28] events.ts /events/upcoming has subtle TZ bug
**File:** `packages/server/src/routes/events.ts:103-113`
**Problem:** `const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000); const todayDate = new Date(now.toISOString().split('T')[0])`. Double conversion via ISO string to build "today" — this rounds to UTC midnight regardless of server timezone, inconsistent with the rest of the codebase which uses server-local midnight.
**Fix:** Pick one timezone convention and document it.

### [29] `as any` on TypeScript union narrowing in habits.ts, tasks.tsx
**Files:** `apps/mobile/app/(tabs)/habits.tsx:227`, `tasks.tsx:230,234`
**Problem:** `CATEGORY_KEYS.includes(intent.category as any)`. `includes` on a tuple needs a proper type guard: `(CATEGORY_KEYS as ReadonlyArray<string>).includes(intent.category)`.
**Fix:** Use the readonly-array cast form; keeps type safety.

### [30] api.ts uses `require('@/stores/auth-store')` dynamic require instead of static import
**File:** `apps/mobile/services/api.ts:27, 33, 55, 65`
**Problem:** The comment says "import lazily to avoid circular deps". The actual issue is a fixable design smell — storage and api.ts are tangled. Dynamic requires bypass Metro's tree-shaking and type inference. Better to pass the auth state in from the caller or use a small event emitter.
**Fix:** Refactor to pass a `getToken()` callback to `api.request` from the auth store at app boot, or move token logic into a dedicated `http.ts` that lives "above" the stores.

### [31] Error envelopes inconsistent across routes: `{ error: ... }` vs `{ message: ... }`
**Files:** all of `arena.ts`, `challenge.ts` use `{ error: ... }`; everything else uses `{ message: ... }`
**Problem:** Mobile error handling in `api.ts:109,119` only reads `error.message`. Responses from arena/challenge failures will show the generic "Ошибка сервера" instead of the actual Russian error text.
**Fix:** Pick one (`message`), migrate arena/challenge. Also consider adding a `code` field for machine-readable reasons.

### [32] tasks.ts GET /tasks `take: 50` without sort stability / pagination
**File:** `packages/server/src/routes/tasks.ts:50-54`
**Problem:** Default task list returns "last 50" with no offset/cursor. Once a user has >50 tasks, older ones become invisible and there's no way to paginate.
**Fix:** Add `cursor` or `offset` query param. Same issue exists in `finance.ts:92-96` (expenses) and `finance.ts:193-197` (incomes) and `journal.ts:54-58`.

---

## Positive Observations

- **Auth hardening is excellent.** Refresh-token rotation with revocation-on-reuse detection (`auth.ts:219-231`) is textbook. Fake bcrypt compare on missing user (`auth.ts:167`) defeats user-enumeration via timing. Per-IP rate limiting with separate buckets for login/register/refresh.
- **Zod validation middleware is clean** and used consistently on POST/PUT endpoints in most routes.
- **Prisma indexes are thoughtfully placed** for the common access patterns: `(userId, date)` on Task, HabitLog, Expense, Income, CalendarEvent; `(userId, createdAt)` on ChatMessage; `(userId)` on Habit, Integration.
- **Security middleware** includes helmet-equivalent headers (CSP, HSTS, Frame-Options, Permissions-Policy) without an extra dependency.
- **Finance route uses correct aggregate/groupBy** instead of loading all expenses — this is the right pattern that should be propagated elsewhere.
- **Dashboard screen (`index.tsx`) uses `React.memo` correctly** on sub-components and `useMemo`/`useCallback` on derived values and handlers. Good performance discipline.
- **Chat tab (`(tabs)/chat.tsx`) properly uses `api.post`** instead of raw fetch for transcription, correctly leveraging the refresh-on-401 flow.
- **Graceful shutdown** in `index.ts:151-158` properly closes the Fastify app and Telegram bot on SIGTERM/SIGINT.
- **Body limits are tuned per-route** (256KB default, 10-15MB for vision/voice upload endpoints) — smart defense against JSON DoS without breaking the features that need it.
