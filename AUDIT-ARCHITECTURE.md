# LifeOS — Architecture & Tech Debt Audit
Date: 2026-04-11

## Executive summary

- **Strong foundations exist in server/** — single Prisma singleton (`packages/server/src/lib/prisma.ts`), centralized auth middleware, working security hardening (JWT_SECRET gate, bodyLimit, CORS whitelist, in-house rate limiter/headers in `middleware/security.ts`), and Zod-validated inputs make the API backbone solid.
- **Biggest risk: routes are 500–770-line "god-files"** mixing HTTP, business logic, DB, and AI prompting — `pet.ts` (768), `chat.ts` (732), `arena.ts` (509), `voice.ts` (405). `services/` folder exists but is empty except `telegram-bot.ts`; all domain logic lives in `routes/`, which is already blocking reuse (see `calculateStreak` triplication).
- **Biggest risk on mobile: 6 screens bypass `services/api.ts`** and call raw `fetch()` directly (arena, swipe-home, battle-screen, character-select, exercise-tracker, import), so the auto-refresh/401 logic and error envelope are silently skipped in gamification features.
- **Top 3 refactors (ROI-ordered):** (1) extract `services/streak-service.ts` with a single-query implementation replacing 2×365 + 1×365 Prisma count loops; (2) normalize all mobile HTTP through `api.ts` and delete zombie `screens/*.ts` shim layer; (3) establish shared `packages/types` + `packages/constants` and stop duplicating `Task/Habit/categories/colors` between mobile and server.
- Onboarding new contributors is painful because there is **no test suite, no lint config, no CI**, and the `screens/*.ts` shim layer plus half-migrated `app/(tabs)/` directory make it unclear which routing system is authoritative. Migration from expo-router to @react-navigation is effectively complete but left a large trail of dead indirection.

## Monorepo health

**Workspace:** Root `package.json` declares npm workspaces (`apps/*`, `packages/*`) and a React 19.1.0 override to force a single React copy. Metro config (`apps/mobile/metro.config.js`) uses `disableHierarchicalLookup=true` plus `nodeModulesPaths=[<monorepoRoot>/node_modules]`, so mobile resolves dependencies only from the root — this is why the React-duplicate-copy crash (recent commits `cbaec3d`, `e773292`) is finally fixed. Workspaces themselves are wired correctly.

**Shared packages: none.** There is no `packages/types`, no `packages/shared`, no `packages/constants`. Result:

| Concern | Mobile location | Server location | Drift? |
| --- | --- | --- | --- |
| `Task`, `Habit`, `User`, `YearlyGoal`, etc. | `apps/mobile/types/index.ts` (hand-written) | `@prisma/client` generated types | Drift: mobile `Task` has `time` but no `notes`/`createdAt` alignment with Prisma, no `Pet`, no `Achievement`, no `ArenaProfile`, no `NutritionLog`, no `Challenge` types at all. |
| `taskCategories` / `expenseCategories` / `priorities` / `habitCategories` / `goalAreas` | `apps/mobile/constants/categories.ts` | Re-declared inline inside prompts in `ai/intent-parser.ts` and `routes/voice.ts` | Drift: mobile `expenseCategories` has `education` + `housing`, CLAUDE.md says `home`. Server categories only exist as free strings — no enforcement. |
| `colors`, `spacing`, `borderRadius` | `apps/mobile/constants/colors.ts` | Not needed server-side | OK (single owner). |

**Prisma client isolation:** `@prisma/client` is imported only under `packages/server/**` — confirmed by grep. Mobile never pulls Prisma types. ✅

**Path aliases:** Mobile has `@/*` → `./*` in `apps/mobile/tsconfig.json`, and it is used consistently in stores/navigation/components. Server has no aliases; everything is relative + `.js` ESM suffixes.

**tsconfig.base.json:** Exists but is **not extended by either subproject**. Mobile extends `expo/tsconfig.base`, server has its own. The root base is effectively dead config.

## Server architecture

### Layering — "everything in routes"

```
packages/server/src/
├── ai/                # ✅ assistant-personality, intent-parser, voice-pipeline
├── lib/               # ✅ prisma singleton, crypto helpers
├── middleware/        # ✅ auth, security, validate
├── routes/            # ❌ 5607 LOC across 19 files, mixing HTTP + domain + DB
├── services/          # ⚠ exists but only holds telegram-bot.ts
└── types/             # only bcryptjs.d.ts shim
```

`services/` is aspirational. Every domain operation is inline in a route handler: streak math is in `chat.ts`+`voice.ts`+`export.ts`, pet health/XP math is in `routes/pet.ts`, arena ELO and battle resolution is in `routes/arena.ts`, financial advice prompts are in `routes/finance.ts`. `pet.ts` is 768 LOC and owns roughly 13 handlers — this is the clearest candidate for splitting into `services/pet-service.ts` (health decay, leveling, costume unlock) with the route as a thin HTTP layer.

### Known triplicated logic: `calculateStreak`

Three places compute the same habit streak:
- `packages/server/src/routes/voice.ts:340` — `async function calculateStreak(userId)` (private helper). 365-iteration loop, inside each iteration one `prisma.habitLog.count()` → **365 sequential round-trips per call**.
- `packages/server/src/routes/chat.ts:675` — byte-for-byte duplicate, same 365 queries. Called from every `/chat` message (`chat.ts:447`) — so a noisy chat user pays 365 queries per turn.
- `packages/server/src/routes/export.ts:270-307` — **inline** version of the same loop (not a separate function), called inside the `/export/story` endpoint.

**Architectural root cause:** because `services/` is empty, the second author simply copy-pasted the helper into the next route file instead of creating `services/streak-service.ts`. There is no "this is where shared domain code lives" convention to violate.

**Perf impact:** Worst case for an active user on chat → 365 count queries + the 7-query dashboard snapshot on every turn. In Refactor 1 below, a single `findMany` replaces the whole thing with 1 query.

### Other route-level issues

- **Config / env access scattered.** `CLAUDE_API_KEY` is read inline in 4 files (`routes/import.ts:11`, `routes/vision.ts:9`, `routes/voice.ts:25`, `routes/chat.ts:14`, `ai/intent-parser.ts:4`). Each constructs its own `new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' })`. Same for `GROQ_API_KEY` (voice.ts). There is no `config.ts` owning env validation. `index.ts` does validate `JWT_SECRET` at boot — that pattern needs to be extended to every required key.
- **No global error handler.** 17+ `try { ... } catch (err) { app.log.error(err); reply.status(500).send({ message: '...' }) }` blocks copy-pasted across routes. Fastify's `app.setErrorHandler(...)` is not registered. A single global handler + a custom `AppError` class would delete ~200 lines.
- **Anthropic clients instantiated multiple times** — one per route file — instead of a single `lib/anthropic.ts` factory. Wastes memory, complicates mocking.
- **Logging:** only 6 `console.log/error` in `src/` — Fastify's `app.log` is used correctly almost everywhere. Structured logs are already good. ✅
- **Schema drift — confirmed two cases:**
  1. `routes/vision.ts:276-283` writes `description` + `timeBlock` to `prisma.task.create` with `as any` cast. **Task model has neither field** (`schema.prisma` lines ~86–100 show only `title/category/priority/date/time/completed/notes`). This code silently drops the data at runtime; the `as any` disables type checking.
  2. `routes/achievements.ts` reads/writes `activeTheme` out of `user.settings` JSON blob. CLAUDE.md documents `activeTheme` as a top-level column on `User`. Code-docs drift: CLAUDE.md is stale, not the code.

### Security/hardening notes

- JWT + refresh tokens via `RefreshToken` model. `RefreshToken` model exists (line in schema list), rotation is implemented in `auth.ts`. ✅
- `lib/crypto.ts` exists — presumably AES for integration tokens. `ENCRYPTION_KEY` env is read.
- In-house `rateLimiter` + `securityHeaders` in `middleware/security.ts` — replaces `@fastify/rate-limit`/`@fastify/helmet` to avoid extra deps. Noted in comments that these should be swapped for official packages post-launch — valid tech debt to track.

## Mobile architecture

### Navigation — migration 90% complete, shim layer needs cleanup

`App.tsx` → `navigation/index.tsx` (a single `@react-navigation` file with `NavigationContainer`, Tab + Stack navigators). Zero `expo-router` imports remain (grep confirmed). But:

- `apps/mobile/app/` still uses expo-router folder shape: `(auth)/`, `(tabs)/`, file-based structure. These files ARE the screens — they were never moved — they're just imported via re-export shims.
- `apps/mobile/screens/*.ts` — **24 one-line files**, each `export { default } from '../app/.../x'`. This is a zombie indirection layer that exists purely so `navigation/index.tsx` can write `import DashboardScreen from '@/screens/dashboard'` instead of `import DashboardScreen from '@/app/(tabs)/index'`. No runtime benefit, pure tech debt from the migration.
- **Dashboard duality:** `app/(tabs)/index.tsx` (906 LOC per byte count proxy) AND `app/swipe-home.tsx` (993 LOC) both exist. `navigation/index.tsx` wires `Dashboard` tab → `SwipeHomeScreen` (from `screens/swipe-home.ts` → `app/swipe-home.tsx`). **`app/(tabs)/index.tsx` is dead code.** It is the old dashboard from before the "swipe home" redesign and can be deleted (along with the `screens/dashboard.ts` shim).

### Stores — one per module, API layer fractured

All 13 Zustand stores import `api` from `@/services/api` — `api.ts` is correctly used inside stores. The fracture is at the **screen layer**, where 6 files bypass stores entirely and hit `fetch()` directly:

| File | Bypass count | Why it matters |
| --- | --- | --- |
| `app/arena.tsx` | 5 `fetch(...)` calls | Arena has no store. Screen holds its own state. Auto-refresh/401 logic silently missing. |
| `app/swipe-home.tsx` | 3 `fetch(...)` calls — one using `.catch(()=>{})` | Main screen after login. Swallows all errors silently. |
| `app/battle-screen.tsx` | 3 `fetch(...)` calls | Gamification layer. |
| `app/character-select.tsx` | 1 `fetch(...)` call | |
| `app/exercise-tracker.tsx` | 1 `fetch(...)` call | |
| `app/import/index.tsx` | 3 `fetch(...)` calls | Used hand-rolled FormData — can't go through `api.ts` which is JSON-only. Genuine limitation, not just laziness. |

The systemic cause: the **gamification layer (arena/battle/challenge/pet-character)** was added in a single rush without first extending `api.ts` for FormData and without creating `arena-store.ts` / `battle-store.ts`. Stores exist for the original 5 modules but not for any game features.

### Offline-first claim vs reality

`CLAUDE.md` says: "Offline-first: работает без интернета, синхронизация при подключении" and calls out MMKV.

Reality check:
- **No MMKV** — `react-native-mmkv` is not in `apps/mobile/package.json`. The project uses `@react-native-async-storage/async-storage`.
- `services/storage.ts` is a **synchronous-façade-over-AsyncStorage** (in-memory cache + eventual-consistency write-behind), which is only suitable for auth tokens and single flags — not a real persistence layer.
- Zustand stores have **zero `persist` middleware** (no `zustand/middleware` import anywhere).
- No "mutation queue" / "pending ops" pattern. If the device is offline when the user taps a habit checkbox, the store updates optimistically and the `api.post` just throws. Nothing queues.
- **Verdict: offline-first is aspirational.** It needs: (a) `zustand/middleware` persist wrapping each store, (b) a dedicated "pending mutations" queue, (c) network-status hook, (d) sync-on-reconnect driver. Estimate: 3–5 days of focused work.

### Component library

`components/ui/` owns 10 primitives (Button, Input, Card, Modal, Checkbox, AnimatedCard, AnimatedCheckbox, ProgressRing, SwipeableRow). `components/shared/` holds 2 cross-cutting widgets (Confetti, PetAvatar). `components/ui/index.ts` exports ALL of them — including Confetti and PetAvatar — which blurs the boundary. **Fix:** `ui/` should be pure atoms, `shared/` is cross-module composites, each with its own barrel. No runtime cost, just hygiene.

`components/voice/` is a third cluster — voice-button, voice-modal, morning-greeting, evening-ritual — which is correct, it's a feature cluster.

`components/characters/CharacterRenderer.tsx` + `constants/characters/index.ts` are the game-layer visual components, also correct.

## Tech debt inventory

| # | Item | File(s) | Severity | Effort | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `calculateStreak` duplicated 3× with N+1 loops (365 queries each call) | `routes/chat.ts:675`, `routes/voice.ts:340`, `routes/export.ts:270-307` | P0 | S (2h) | Extract to `services/streak-service.ts` with one `findMany` — see Refactor 1. |
| 2 | Schema drift in vision import: writes `description`/`timeBlock` with `as any` to Task | `routes/vision.ts:276-283` | P0 | XS (30m) | Either add the fields to `Task` model + migration, or map to `notes` and `time`. Silently dropping data today. |
| 3 | Dashboard duality: `app/(tabs)/index.tsx` dead (~900 LOC) while `swipe-home.tsx` is live | `app/(tabs)/index.tsx`, `screens/dashboard.ts` | P1 | XS | Delete. Verify navigation wiring once. |
| 4 | `screens/*.ts` zombie shim layer (24 one-line re-exports) | `apps/mobile/screens/*.ts` | P1 | S (1h) | Update `navigation/index.tsx` imports to point at `@/app/...` directly, delete `screens/`. |
| 5 | 6 screens bypass `services/api.ts` with raw `fetch()` — no 401 refresh | `arena.tsx`, `swipe-home.tsx`, `battle-screen.tsx`, `character-select.tsx`, `exercise-tracker.tsx`, `import/index.tsx` | P0 | M (1 day) | Add `api.postForm` for multipart; build `arena-store.ts` + `battle-store.ts`; route all screens through stores. |
| 6 | No shared `types` package — mobile hand-defines Task/Habit/User, drifts from Prisma | `apps/mobile/types/index.ts` vs `schema.prisma` | P1 | M | Create `packages/types` with hand-maintained DTOs OR publish Prisma types via a tiny `packages/server-api-types` re-export. See Refactor 3. |
| 7 | No shared constants — categories/priorities redefined in prompts | `apps/mobile/constants/categories.ts`, `routes/voice.ts`, `ai/intent-parser.ts` | P1 | S | Move to `packages/constants`. |
| 8 | `routes/pet.ts` is 768 LOC — business logic (level/xp/decay/unlock) not extracted | `routes/pet.ts` | P1 | M | `services/pet-service.ts` + thin route. Unlocks unit testing. |
| 9 | Anthropic SDK client instantiated 5 times | `routes/chat.ts`, `routes/voice.ts`, `routes/vision.ts`, `routes/import.ts`, `ai/intent-parser.ts` | P2 | XS | `lib/anthropic.ts` singleton, read key once. |
| 10 | No global Fastify error handler — every route duplicates try/catch | 17+ occurrences across `routes/*` | P1 | S | `app.setErrorHandler(...)` + `AppError` class in `lib/errors.ts`. Deletes ~200 LOC. |
| 11 | Scattered `process.env.*` reads with no central config module | `routes/import.ts:11`, `routes/vision.ts:9`, `routes/voice.ts:21-25`, `routes/chat.ts:14`, `lib/crypto.ts:23`, `ai/intent-parser.ts:4`, `services/telegram-bot.ts:120`, `index.ts:30-137` | P1 | S | `lib/config.ts` with Zod validation at boot; fail-fast like `JWT_SECRET` already does. |
| 12 | No tests, no lint config, no CI | repo root | P1 | M | At minimum: root `.eslintrc` + `vitest` for `services/*`, `.github/workflows/ci.yml` running `tsc --noEmit` and tests on both packages. |
| 13 | Offline-first claimed but unimplemented — no persist, no queue | all stores; `services/storage.ts` | P1 | L (3–5d) | `zustand/middleware` persist + pending-mutations queue + reconnect driver. |
| 14 | `tsconfig.base.json` at root is dead — neither sub-project extends it | root | P2 | XS | Delete or make both subprojects extend it. |
| 15 | `package-lock.json` only at root (correct for workspaces) but `list-users.mjs` script sits at `packages/server/list-users.mjs` without being documented | `packages/server/list-users.mjs` | P3 | XS | Move under `packages/server/scripts/` or delete if one-off. |
| 16 | Stores have no persistence; auth-token refresh races (`isRefreshing` flag) work but are untested | `services/api.ts:20-72` | P2 | S | Add a unit test once vitest is wired. The `isRefreshing && refreshPromise` branch on line 24 reads from `refreshPromise` but the happy path never assigns to it — subtle dormant bug. |
| 17 | `trustProxy: true` is on in dev AND prod — fine behind Railway, but X-Forwarded-For spoofing risk if ever deployed bare | `index.ts:53` | P3 | XS | Gate on `NODE_ENV === 'production'`. |
| 18 | `describe`-less, ungrouped routes with duplicated auth `preHandler` pattern | every route file | P3 | S | Fastify plugin with `addHook('preHandler', authMiddleware)` is already used; consolidating routes by domain would be a win for OpenAPI generation later. |

## Dead / zombie code

- **`apps/mobile/app/(tabs)/index.tsx`** — old dashboard. Not reachable from `navigation/index.tsx`. `SwipeHomeScreen` wins. Delete.
- **`apps/mobile/screens/dashboard.ts`** — shim pointing at the above. Delete when cleaning up the screens shim layer (Item #4 above).
- **`apps/mobile/screens/*.ts` (all 24 files)** — one-line re-exports, useful only during the expo-router → react-navigation migration. Post-migration they add zero value. Delete after migrating navigation imports.
- **`packages/server/src/services/` contains only `telegram-bot.ts`** — the folder is *named* like a service layer but has none of that use. The `services/` name is essentially stolen by the Telegram integration. Either rename it `integrations/` and actually build a proper `services/` layer, or keep the name and populate it (Refactor 1 below).
- **`tsconfig.base.json` at repo root** — not extended by anyone. Delete or use.
- **`packages/server/list-users.mjs`** — ad-hoc script with hard-coded Prisma `findMany`. Probably left over from debugging a user.
- **`packages/server/src/types/bcryptjs.d.ts`** — needed shim, not dead. Keep.
- **No `.backup`/`.old` files found.** ✅
- **No orphan Prisma models** — every model is referenced from at least one route (verified `stepLog`, `journalEntry`, `userInterest`, `nutritionLog`, `petItem`, `arenaProfile`, `battle`, `challenge`, `refreshToken` all have touching routes or are related via User). ✅

## Stage completeness matrix (CLAUDE.md stages 0-9 × [schema, route, screen, tested])

Legend: ✅ done · 🟡 partial · ❌ missing · N/A = out of scope

| Stage | Feature | Prisma model | Server route | Mobile screen | Tested |
| --- | --- | --- | --- | --- | --- |
| 0 | Bootstrap: UI kit, dark theme, Expo+Fastify+Prisma | N/A | N/A | ✅ (10 `ui/` atoms) | ❌ |
| 1 | Auth, Habits, Tasks | ✅ (`User`, `Habit`, `HabitLog`, `Task`, `RefreshToken`) | ✅ (`auth.ts`, `habits.ts`, `tasks.ts`) | ✅ (`(auth)/`, `(tabs)/habits`, `(tabs)/tasks`) | ❌ |
| 2 | Weekly + Yearly goals | ✅ (`WeeklyGoal`, `YearlyGoal`) | ✅ (`goals.ts`) | ✅ (`(tabs)/goals`) | ❌ |
| 3 | Finance (expenses/incomes/budget) | ✅ (`Expense`, `Income`, `BudgetLimit`) | ✅ (`finance.ts`) | ✅ (`(tabs)/finance`) | ❌ |
| 4 | Steps + GPS | ✅ (`StepLog`) | 🟡 (`steps.ts` exists, 2 routes only — no GPS persist) | 🟡 (`activity/index.tsx` exists; map/GPS not confirmed) | ❌ |
| 5 | Voice AI + assistant personality | ✅ (`ChatMessage`, `UserInterest`) | ✅ (`voice.ts`, `chat.ts`, `ai/*`) | ✅ (`(tabs)/chat`, `components/voice/*`) | ❌ |
| 5.5 | File import + Calendar events | ✅ (`ImportedFile`, `CalendarEvent`) | ✅ (`import.ts`, `events.ts`) | ✅ (`app/import`, `schedule-import.tsx`) | ❌ |
| 6 | Notifications (morning/evening/streaks/finance) | N/A | 🟡 (scheduling logic lives in mobile `hooks/use-notifications.ts` + `services/wake-up-notification.ts`) | 🟡 (hook exists; financial-limit push not verified) | ❌ |
| 7 | Journal + dashboard + year heatmap | ✅ (`JournalEntry`) | ✅ (`journal.ts`) | ✅ (`journal/`, `swipe-home.tsx`) | ❌ |
| 8 | AI chat + Google Calendar + Health + Telegram + export | ✅ (`Integration`) | ✅ (`chat.ts`, `integrations.ts`, `export.ts`, `services/telegram-bot.ts`) | 🟡 (`settings/integrations.tsx` exists; Apple Health sync lives in `services/health-sync.ts` but no model touches) | ❌ |
| 9 | Polish + onboarding + tests + launch | N/A | N/A | 🟡 (onboarding screen exists) | ❌ no tests, no CI |
| — | Pet / Tamagotchi | ✅ (`Pet`, `PetItem`, `Achievement`) | ✅ (`pet.ts` 768 LOC, `achievements.ts`) | ✅ (`app/pet.tsx`, `achievements.tsx`, `character-select.tsx`) | ❌ |
| — | Arena / Battle / Challenge (unlisted in CLAUDE.md stages) | ✅ (`ArenaProfile`, `Battle`, `Challenge`) | ✅ (`arena.ts` 509 LOC, `challenge.ts` 342 LOC) | ✅ (`arena.tsx`, `battle-screen.tsx`, `exercise-tracker.tsx`) | ❌ and bypasses `api.ts` |
| — | Vision / Nutrition (unlisted in CLAUDE.md stages) | ✅ (`NutritionLog`) | ✅ (`vision.ts` 299 LOC, shares NutritionLog) | ✅ (`nutrition.tsx`) | ❌ |

**Observations from the matrix:**
1. **Stages 1–5.5 are fully plumbed end-to-end.** The core product works.
2. **A major feature cluster — Arena / Battle / Challenge / Pet / Nutrition / Vision — was added after CLAUDE.md was written and is not in the 0–9 stage list.** Product scope expanded but the roadmap doc did not. Whoever owns CLAUDE.md needs to add "Stage 10: Gamification" and "Stage 11: Vision/Nutrition" to prevent future drift.
3. **Tests row is 100% empty.** Not a single `.test.ts` file in the repo.
4. **Stage 6 (notifications) is half-done on the server side** — the dispatch logic lives in the mobile hook, not the server. CLAUDE.md implies server-side push — expectation drift.
5. **No orphan models** — every schema model is reachable from a route.

## Dependency audit

- **React 19.1.0 forced via root `overrides`.** `@types/react` is pinned `~19.1.0`. All React deps are unified. The recent "nuclear fix" commit chain (`d017660`, `e773292`, `cbaec3d`) resolved the dual-React-copy crash — that pain is behind you.
- **`@types/react-native` is NOT listed in the mobile `devDependencies`** — expo ships types via `expo/tsconfig.base`, which is fine.
- **`expo-router` is NOT in `package.json`.** ✅ Migration dep cleanup complete.
- **`react-native-mmkv` is NOT in `package.json`** despite CLAUDE.md naming it as the cache layer. Either add it or update CLAUDE.md. Using `AsyncStorage` is workable but slower; for a "voice-first, offline-first" app MMKV is a meaningful perf win.
- **`react-native-reanimated` is NOT in `package.json`** despite CLAUDE.md listing it. The `animated-card.tsx` / `animated-checkbox.tsx` / `confetti.tsx` components must be using React Native's built-in `Animated` API — check bundle impact.
- **`victory-native` is NOT in `package.json`** despite CLAUDE.md listing it for charts. `components/charts/` exists — need to verify what it actually uses.
- **No `"*"` version pins** in mobile or server package.json. ✅
- **No duplicate deps across packages** — mobile only has RN/Expo stack, server only has Node/Fastify/Prisma. The only overlap is `typescript ~5.9.2` (dev) which is fine.
- **`package-lock.json` only at root** — this is the correct shape for npm workspaces. ✅
- **`@fastify/multipart` is in server deps but not used per grep of `multipart`** — verify `routes/import.ts` still parses XLSX via `xlsx` package from a base64 body; if so the multipart dep is dead. (Not verified inline; add to follow-up.)

## Module boundaries

**Gamification as cross-cutting concern:**
- Pet & Achievement logic lives in its own routes but is *driven* by events from every module (habit completed → XP, task completed → XP, budget under-limit → XP). Right now the update is presumably inline inside each route — e.g. the achievement check for "book worm" should live wherever `habitLog.completed` transitions. Verified `pet.ts` owns its model; the "hook points" from other domains are hard to see without deeper inspection. **Recommendation: a lightweight event emitter (`services/events.ts`) with `emit('habit.completed', ...)` fired from the habit route and subscribed by pet/achievement services.** This prevents gamification bloat from spreading into every core route.

**AI layer fragmentation:**
- Three parallel Anthropic clients (`chat.ts`, `voice.ts`, `vision.ts`, `import.ts`, `ai/intent-parser.ts`). Each constructs its own client, each has its own prompt-building code. The `ai/` folder (`assistant-personality.ts`, `intent-parser.ts`, `voice-pipeline.ts`) is the *right* abstraction but `chat.ts` and `vision.ts` don't use it — they build their prompts inline. **Recommendation: pull `buildAssistantPrompt`/`parseActions`/`stripMarkdown`/`executeActions` out of `chat.ts` into `ai/chat-pipeline.ts`, same way `voice-pipeline.ts` already exists. Then every AI-touching route just imports from `ai/`.**

## Top 3 refactors — detailed plans

### Refactor 1: Extract `services/streak-service.ts` with single-query implementation

Current: 3 implementations doing `365 × habitLog.count()` in a loop. Rough cost: 365 DB round-trips per chat turn for every active user.

Target: one `streak-service.ts` module; one `findMany` per call.

```
packages/server/src/services/streak-service.ts   (NEW)
```

Plan:
1. Create `services/streak-service.ts` exporting `calculateHabitStreak(userId: string): Promise<number>`.
2. Implementation:
   - Single query: `prisma.habit.count({ where: { userId, active: true } })` → `habitCount`.
   - Early return `0` if `habitCount === 0`.
   - Single query: `prisma.habitLog.findMany({ where: { userId, completed: true, date: { gte: <today - 365 days> } }, select: { date: true } })`.
   - Group by date in JS (`Map<isoDate, completedCount>`).
   - Walk backwards from today: if `group[day] / habitCount > 0.5` → `streak++`, else break (with the "today has nothing yet, skip" rule already present in the originals).
   - Return `streak`.
3. Delete `calculateStreak` from `routes/voice.ts`; import from `services/streak-service.ts`. Same for `routes/chat.ts`.
4. In `routes/export.ts`, replace the inline loop (lines 270–307) with one call.
5. Add a unit test (once vitest is wired): fixture with 10 days of logs, assert streak of 10; fixture with a gap, assert streak stops at gap.
6. Measure: before-refactor chat turn hits ~372 DB queries; after should be ~8. Verify with Fastify `app.log` or Prisma's `$on('query')`.

Effort: 2 hours (including tests once vitest is in place). Risk: low — the streak contract is already identical across all 3 copies.

### Refactor 2: Kill `screens/*.ts` shim layer + normalize mobile HTTP through `api.ts`

Current: 24 zombie shim files + 6 screens using raw `fetch` without refresh-token logic. Two separate problems that share a root cause: the gamification migration was done in a rush.

Plan:
1. **Shim removal (30 min):**
   - Open `apps/mobile/navigation/index.tsx`.
   - Replace every `import X from '@/screens/y'` with `import X from '@/app/.../y'` (point directly at the source file).
   - Delete `apps/mobile/screens/`.
   - Verify `npx tsc --noEmit` is clean.
2. **Dashboard dedup (15 min):**
   - Delete `apps/mobile/app/(tabs)/index.tsx`.
   - Delete the matching `screens/dashboard.ts` shim (already gone if step 1 is done).
   - Confirm `navigation/index.tsx` only references `SwipeHomeScreen`.
3. **Extend `api.ts` for FormData (1 hr):**
   - Add `api.postForm<T>(endpoint: string, form: FormData, token?: string)` that skips `Content-Type` and goes through the same 401-retry path.
   - Update `app/import/index.tsx` to use it.
4. **Build `arena-store.ts` / `battle-store.ts` / `challenge-store.ts` (4–6 hrs):**
   - Scaffold like `task-store.ts`: `loadProfile()`, `loadHistory()`, `loadLeaderboard()`, `findOpponent()`, `startBattle()`, `completeChallenge()`.
   - Each method delegates to `api.get`/`api.post`.
5. **Rewire screens:**
   - `arena.tsx`, `swipe-home.tsx`, `battle-screen.tsx`, `character-select.tsx`, `exercise-tracker.tsx` → replace `fetch(`...`)` with store calls.
6. **Verify:** manually trigger a 401 (expire token in dev) and confirm each screen auto-refreshes instead of bouncing to login.

Effort: ~1 day. Payoff: every screen gets auto-refresh, unified error envelope, and we can now swap `services/api.ts` for `react-query` later without touching UI code.

### Refactor 3: Establish `packages/types` + `packages/constants` to kill drift

Current: mobile hand-writes `Task/Habit/User` types in `apps/mobile/types/index.ts` which already drift from Prisma (missing Pet/Achievement/Arena/Nutrition). Categories and priorities are redefined inside server prompts.

Plan:
1. Create `packages/types/` with `package.json` `{ "name": "@lifeos/types", "main": "./src/index.ts" }`.
2. In `packages/types/src/index.ts`, define **DTOs** (wire-format types), not Prisma types — this keeps the server free to change Prisma without breaking mobile, and keeps mobile free of `@prisma/client`.
   - `TaskDTO`, `HabitDTO`, `UserDTO`, `PetDTO`, `ArenaProfileDTO`, `ChatMessageDTO`, etc.
   - Dates as ISO strings (mobile can't use `Date`).
   - Enums as union types (`TaskCategory`, `Priority`, `HabitCategory`, `GoalArea`, `AssistantStyle`).
3. Create `packages/constants/` with `taskCategories`, `habitCategories`, `goalAreas`, `expenseCategories`, `priorities`, `colors`, `spacing`, `borderRadius` — one source of truth.
4. Wire both subprojects: `apps/mobile/package.json` and `packages/server/package.json` add `"@lifeos/types": "*"`, `"@lifeos/constants": "*"`. Workspace resolution will hand back the local folder.
5. In server routes, import constants from `@lifeos/constants` and use them to build Zod enums (e.g. `z.enum([...Object.keys(taskCategories)] as [string, ...string[]])`). This auto-enforces the set everywhere.
6. In `ai/intent-parser.ts`, build the prompt by interpolating `Object.keys(taskCategories).join(', ')` — so adding a new category only requires editing `packages/constants`.
7. Delete `apps/mobile/types/index.ts` and `apps/mobile/constants/categories.ts`. Re-export from the shared packages for internal ergonomics.
8. Run `tsc --noEmit` in both sub-projects to catch the inevitable mismatches — and fix them. That's the whole point: the compiler now tells you where drift existed.

Effort: 1–2 days. Payoff: no more silent drift when a new category or priority is introduced. Mobile also gets proper types for Pet/Arena/Nutrition for free when the DTOs are added.

---

## Concrete next-action checklist (18 items, rank-ordered)

1. **Extract `services/streak-service.ts`** (Refactor 1) — 2h, P0, perf win.
2. **Fix `vision.ts` Task schema drift** — add `description`/`timeBlock` migration OR remap to `notes`/`time` — 30m, P0, silent data loss today.
3. **Delete `apps/mobile/app/(tabs)/index.tsx` + `screens/dashboard.ts`** — 15m, P1, dead code.
4. **Wire all gamification screens through `api.ts` (add `api.postForm`)** — 1d, P0, auto-refresh broken for 6 screens.
5. **Build `arena-store.ts` + `battle-store.ts` + `challenge-store.ts`** — 4h, P1, store discipline.
6. **Create `packages/types` + `packages/constants`** (Refactor 3) — 1–2d, P1, kills drift.
7. **Add global Fastify `setErrorHandler` + `AppError`** — 2h, P1, deletes ~200 LOC.
8. **Centralize env access in `lib/config.ts` with Zod fail-fast** — 2h, P1.
9. **Single `lib/anthropic.ts` client factory** — 30m, P2.
10. **Split `routes/pet.ts` into `services/pet-service.ts` + thin route** — 1d, P1, testability.
11. **Wire up `vitest` + `.github/workflows/ci.yml` running `tsc --noEmit` + tests on both packages** — 3h, P1.
12. **Add ESLint config at root + per-package overrides** — 2h, P1.
13. **Reality-check CLAUDE.md vs deps**: add MMKV, Reanimated, Victory OR update CLAUDE.md to match actually-installed set — 30m, P2.
14. **Add "Stage 10: Gamification" + "Stage 11: Vision/Nutrition" to CLAUDE.md** — 15m, P2, roadmap truth.
15. **Implement Zustand `persist` middleware on at least `auth-store`, `habit-store`, `task-store`** — 4h, P1, offline-first foundation.
16. **Build offline mutation queue + reconnect driver** — 2–3d, P1, completes the offline promise.
17. **Move `packages/server/list-users.mjs` to `scripts/` or delete** — 5m, P3.
18. **Delete `tsconfig.base.json` at repo root (unused)** — 5m, P3.

---

Generated by architecture audit on 2026-04-11.
