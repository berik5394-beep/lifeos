# LifeOS — Security Audit
Date: 2026-04-11
Auditor: Claude (Opus 4.6)
Scope: packages/server/src (Fastify + Prisma + PostgreSQL)

## Summary
- Files reviewed: 18 route files, middleware/{auth,security,validate}.ts, lib/crypto.ts, lib/prisma.ts, ai/{assistant-personality,voice-pipeline,intent-parser}.ts, src/index.ts, prisma/schema.prisma, .env, .gitignore
- P0 (exploitable now): 4
- P1 (likely exploitable or defense-in-depth gap): 7
- P2 (hardening): 6

---

## Crypto review of packages/server/src/lib/crypto.ts

**Verdict: SAFE with one watch-item (the legacy fallback).**

Line-by-line:
- L18-21: `ALGORITHM='aes-256-gcm'`, `IV_LENGTH=12`, `AUTH_TAG_LENGTH=16`. Correct GCM parameters (96-bit IV is NIST-recommended for AES-GCM).
- L23-35 `getKey()`: no default. Throws if `ENCRYPTION_KEY` unset OR not exactly 64 hex chars. `Buffer.from(keyHex, 'hex')` silently drops invalid hex chars, but length check on the hex string (not the buffer) still enforces 32 bytes. **Minor**: `Buffer.from(keyHex, 'hex').length !== 32` would be stricter — if user passes 64 chars with non-hex chars, buffer could be shorter. P2.
- L42-51 `encrypt()`:
  - Empty string short-circuit: returns '' — fine, does not cipher a zero-length plaintext (no real harm but means empty tokens round-trip as empty).
  - `crypto.randomBytes(IV_LENGTH)` — **correct**: new random IV per call. GCM key-reuse condition is satisfied (never reused with same key).
  - `createCipheriv` + `cipher.update` + `cipher.final` + `getAuthTag()` — correct order.
  - Output format: `iv || authTag || ciphertext`, base64-encoded. Self-describing, single-column safe.
- L56-80 `decrypt()`:
  - Length pre-check `< 40` and base64-charset regex `^[A-Za-z0-9+/=]+$` for legacy detection. Correct detection heuristic — legacy plaintext OAuth tokens (if any) typically contain `.` and `-` so they won't match the base64 regex.
  - Reads iv/authTag/ciphertext via `subarray` (no copy).
  - `decipher.setAuthTag(authTag)` is called **before** `decipher.final()` (as required by Node) — **correct**, any tamper causes `final()` to throw.
  - On any error the catch **returns the ciphertextB64 as-is**. This is the legacy-fallback behaviour and is the ONE risk to consider carefully:
    - Safe scenario: DB contains plaintext from pre-encryption rows → returned verbatim, consumer uses it as token. Correct transitional behaviour.
    - Risk scenario: If an attacker can inject a crafted base64 string into the DB column that looks like encrypted ciphertext but fails auth (e.g. bit-flipped authTag), the catch returns the **base64 string itself** as the "decrypted" value. The consumer then tries to use that as an OAuth access token → Google API returns 401 → no actual privilege escalation. There is no known downgrade attack here because the attacker would need write access to the `Integration.accessToken` column, which already means they've compromised the DB. **Acceptable**.
  - **No timing-safe comparison is needed in this file** — the authTag check is performed inside Node's OpenSSL bindings which handles constant-time verification internally.

**Recommendations (P2):**
1. After the legacy migration is complete, replace the catch-return-original with `throw new Error('Decryption failed')` and surface that to the caller as a hard error. Leaving the fallback forever creates a perpetual downgrade surface if the threat model changes.
2. Add `Buffer.from(keyHex, 'hex').length === 32` assertion in `getKey()`.
3. Consider key-versioning (prefix `v1:`) so future rotation is a non-breaking migration.

---

## P0 — Fix immediately

### [P0-1] `POST /pet/unlock-item` grants arbitrary items (legendary gear) to any user
**File:** packages/server/src/routes/pet.ts:732-765
**Vulnerability:** The endpoint accepts `itemKey, name, slot, rarity, bonus, bonusValue` directly from the request body with **zero Zod validation** and **zero authorization check against any allow-list**. It simply creates a `PetItem` row with whatever rarity the client sends. This completely bypasses the intended unlock system (the streak/level gates in `GET /pet`, e.g. `excalibur` requires level 10).
**Exploit scenario:** Any authenticated user POSTs `{ "itemKey": "titan_plate", "name": "Titan", "slot": "armor", "rarity": "legendary", "bonusValue": 999 }`. The server stores it, then `/arena/battle` uses `RARITY_POWER.legendary = 50` and `+bonusValue` directly in the power score (arena.ts:57-60) — the attacker wins every battle, climbs to Legend rank, and disrupts the global leaderboard. `bonusValue` is also not clamped, so they can mint arbitrary power.
**Fix:** Either delete the route entirely (unlocks should only happen server-side via the auto-unlock logic already in `GET /pet`), or gate it behind a hard allow-list of predefined items with server-authoritative rarity/bonus values, and verify the unlock condition against pet state server-side.

### [P0-2] `POST /challenge/complete` trusts client-supplied `timeSeconds` — guaranteed wins
**File:** packages/server/src/routes/challenge.ts:158-194
**Vulnerability:** `const { challengeId, timeSeconds } = request.body` — no Zod validation, no lower bound. `updateData.attackerTime = timeSeconds || 0`. The winner is determined by the lowest time (L199 `if (aTime < dTime) winnerId = attacker`). An attacker passes `timeSeconds: 0.0001` and always wins every challenge, farming trophies/XP/mana.
**Exploit scenario:** Challenge anyone (or yourself, see P0-3), wait 1 second, POST `/challenge/complete` with `timeSeconds: 0`. Trophy reward credited, loser (real user) loses trophies. Repeat until Legend rank.
**Fix:** Add a Zod schema `z.object({ challengeId: z.string().cuid(), timeSeconds: z.number().positive().min(5).max(3600) })`. Additionally, the server should record the `startedAt` timestamp on challenge create and compute `timeSeconds = Date.now() - startedAt` server-side instead of trusting the client.

### [P0-3] `POST /challenge/create` allows self-challenge; no opponent validation
**File:** packages/server/src/routes/challenge.ts:75-157
**Vulnerability:** `opponentUserId` comes from the body with no Zod schema. There is no check that `opponentUserId !== userId`. Combined with P0-2, an attacker challenges themselves, "completes" with time=0 for the attacker role and time=999999 for the defender role, and reaps rewards on both sides — but since only `attackerId === userId` branch runs when the attacker POSTs complete, they actually need to complete from both sides. However they CAN mark themselves as both attacker and defender (the `isAttacker` / `isDefender` checks in L173-177 pass the same userId check either way if `challenge.attackerId === challenge.defenderId`), so the second POST from the same user flips them to "defender" role and sets defenderTime. Result: full trophy farming loop with one user.
**Exploit scenario:** POST /challenge/create with `opponentUserId` = self → POST /challenge/complete `timeSeconds: 0.1` → switches `isAttacker=true` first, then the same call later also matches `isDefender` (because both IDs are equal). Server writes both `attackerDone` and `defenderDone` on successive calls, resolves winner = self, awards trophies. Equivalent effect: both sides are the same user so they can drain `challenge.trophyReward` into their own profile without losing anything to a real opponent.
**Fix:** 
1. Zod: `z.object({ opponentUserId: z.string().cuid() })`.
2. Early check: `if (opponentUserId === userId) return reply.status(400).send(...)`.
3. In `/challenge/complete`, compute `const isAttacker = challenge.attackerId === userId && challenge.defenderId !== userId` to be defensive, OR reject challenges where attacker==defender at creation.
4. Add a per-user cooldown on `/challenge/create` (currently no rate-limit and no cooldown, only mana cost which regenerates via task completions).

### [P0-4] `POST /import/file` — no MIME check, no filename sanitization, no zip-bomb protection on xlsx
**File:** packages/server/src/routes/import.ts:86-160
**Vulnerability:** 
1. File type is decided purely from the client-supplied filename extension (L79 `getFileExtension`). An attacker uploads `evil.exe` renamed to `evil.xlsx` — the code blindly passes the buffer to `XLSX.read(buffer, { type: 'buffer' })`.
2. `xlsx` library is **well-known** to be vulnerable to prototype pollution and zip-bomb amplification (CVE-2023-30533, CVE-2024-22363). A 50KB crafted xlsx can expand to >10GB of shared-strings and crash the Node process. Body limit is 15MB but the xlsx unzip happens AFTER the body is received.
3. `fileName` is stored directly in DB and later echoed back in `/import/history`. No path traversal risk on disk (we're not writing files to FS), but XSS is possible if this ever gets rendered in HTML.
4. Parsed data is sent to Claude API with only a 50-item slice — fine — but the full `parsedData` is stored in `ImportedFile.parsedData` Json column with no size cap → unbounded DB growth and potential $ cost attack.
**Exploit scenario:** Attacker uploads a 14MB crafted xlsx → Node CPU pegged during parse → other requests time out → DoS. OR: attacker uploads a prototype-pollution payload → `XLSX.utils.sheet_to_json` result includes `__proto__` keys → potential global Object prototype pollution in the Node process → later innocuous code paths behave unexpectedly (see CVE-2023-30533 for real demonstrations).
**Fix:**
1. Validate `file.mimetype` from multipart against an allowlist (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/csv`, `text/calendar`).
2. Upgrade `xlsx` to a patched fork (`@sheet/core`) or migrate to `exceljs` which is actively maintained. Until then, set a hard cap: `if (buffer.length > 2 * 1024 * 1024) return 400` (2MB of xlsx is a LOT of spreadsheet).
3. After `XLSX.utils.sheet_to_json`, walk the result and drop any keys `__proto__`, `constructor`, `prototype`. Or use `Object.create(null)` sanitization.
4. Clamp `analysis.items` to max 200 rows before DB write. Sanitize `fileName` to `[A-Za-z0-9._\- ]{1,255}`.

---

## P1 — Likely exploitable / defense-in-depth gaps

### [P1-1] Global rate limiter is NOT applied to expensive routes (AI, vision, voice, import)
**File:** packages/server/src/index.ts + packages/server/src/middleware/security.ts
**Gap:** `rateLimiter` is only instantiated in `auth.ts` for login/register/refresh. `/voice/chat`, `/voice/assistant`, `/voice/transcribe`, `/vision/analyze-food`, `/vision/analyze-schedule`, `/import/file`, `/export/pdf/report` have no per-route limiter. Each of these triggers paid calls (Claude API, Groq Whisper) and/or heavy DB reads. A single authenticated account can burn through thousands of dollars of Anthropic/Groq credits in minutes.
**Exploit:** Attacker registers one account, hits `/voice/chat` in a loop with a 10KB body (under 256KB limit), each call ~$0.05 Claude. 60 req/s × 60s = 3,600 calls/min × $0.05 = **$180/min**.
**Fix:** Wrap each AI/vision/import route in `preHandler: [rateLimiter({ max: 20, windowMs: 60_000, keyPrefix: 'ai' })]`. Preferably tie it to userId, not IP: the current `getClientIp` keying lets a multi-IP botnet bypass the limit trivially — change the key function to `prefix:${userId ?? ip}`.

### [P1-2] No max-length on most text fields → JSON bomb / DB row bloat
**File:** tasks.ts:7-15, habits.ts:8-18, events.ts:7-17, finance.ts:7-25, journal.ts:7-13, voice.ts:28-30, chat.ts:49-51
**Gap:** `z.string()` with no `.max()`. The 256KB bodyLimit caps request size, but:
  1. `/chat` `text` is unbounded → attacker sends 255KB of text to Claude API → $$$$
  2. `Task.title`, `Task.notes`, `JournalEntry.notes`, `CalendarEvent.description`, `Expense.description` can each reach ~250KB → 1000 such rows = 250MB in Postgres per user.
**Fix:** Add `.max(200)` for titles/names, `.max(2000)` for notes/descriptions, `.max(500)` for voice/chat text (or `.max(2000)` for chat specifically with a per-user daily token budget).

### [P1-3] `z.string()` for date fields → `new Date('<anything>')` produces `Invalid Date` but code still calls Prisma with it
**File:** tasks.ts:64-66, 82-86; finance.ts:108, 199; events.ts:130; journal.ts:62; steps.ts:55
**Gap:** `date: z.string()` with no regex → `new Date(data.date)` on `"not-a-date"` → `Invalid Date` object → Prisma call either throws with an ugly error (leaking stack) OR inserts `NaT`. Low severity but turns a typo into a 500 leaking internals.
**Fix:** `date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` everywhere, OR `z.string().datetime()`. Apply also to `steps.gpsTrack` timestamp validation (already uses `z.number()` which is fine).

### [P1-4] `Expense.amount` / `Income.amount` accept `number` but no integer coercion, precision loss on floats
**File:** finance.ts:11, 24; chat.ts:add_expense schema L80
**Gap:** `z.number().positive()` allows `1e-323` (subnormal) and `Number.MAX_VALUE`. `Prisma.Expense.amount` is `Float` (from schema). Attacker sends `amount: 1e308` → overflow during aggregation → summary endpoint returns Infinity → client crashes, and budget-warning logic (`percentage = spent / limit`) divides by a huge number and shows 0% used. Also negative/zero is rejected but `NaN` needs explicit check (Zod rejects NaN since 3.x, so OK).
**Fix:** `z.number().positive().max(1_000_000_000).finite()` and use Prisma `Decimal` type instead of `Float` for money — Prisma Float is JS double, so sums > 2^53 lose precision silently.

### [P1-5] `parseActions` regex + JSON.parse allow storing arbitrary keys in Prisma action writes
**File:** chat.ts:99-129
**Gap:** The Zod whitelist schemas for actions (good!) only validate the *top-level* fields. But `ACTION_SCHEMAS.create_task` uses `z.object({...})` without `.strict()`, so unknown properties pass through into `result.data` via Zod's default strip behaviour — OK, Zod strips by default. **Actually this is safe** because `safeParse` strips unknown keys. However: `executeActions` then does `new Date(dateStr)` and `String(action.data.title)` without re-checking length / validity. A prompt-injection that makes Claude emit `[ACTION:create_task:{"title":"<250KB>"}]` would be bounded by the `{[^}]{0,2000}` regex (2000 chars, good), but there is no protection against **the LLM itself being induced** to output 5 actions that each create an `Expense` of `999999999` — that passes the schema. Defense-in-depth: we trust the model to not do this, but a prompt injection from a malicious imported file or malicious calendar title could induce it.
**Fix:** Require a server-side "confirmation" step for money-creating actions (`add_expense`, `add_income`). Only `create_task`/`create_event` should auto-execute. For spend/income, return them as `suggestedActions` to the client and require the user to tap Confirm.

### [P1-6] `webSearch()` in chat.ts is a Server-Side Request Forgery surface waiting to happen
**File:** chat.ts:19-48
**Gap:** The query is LLM-derived from user input, and the server fetches `https://html.duckduckgo.com/html/?q=...`. Currently hardcoded to DDG, so not exploitable **yet**. But two concerns:
  1. Cheerio parses the full HTML response (up to whatever body size DDG returns) — no size limit in the fetch. A malicious DNS/MITM or DDG CDN edge case could return gigabytes.
  2. If someone ever changes the `url` template to interpolate anything from the LLM, this becomes direct SSRF.
**Fix:** Add `AbortSignal.timeout(5000)` to fetch, check `resp.headers.get('content-length') < 2_000_000` before calling `.text()`, and add a comment `// SECURITY: URL must remain hardcoded — do not interpolate user/LLM content`.

### [P1-7] No logout of individual refresh token — only "logout all"
**File:** auth.ts:245-252
**Gap:** `/auth/logout` calls `revokeAllUserTokens(userId)`. That's safe but crude. More importantly: there's no endpoint that returns the current JWT's `jti` back to the client, so a client cannot revoke a single session. Minor UX issue, but the bigger gap is that **there's no enforcement of `iat` on access tokens** — if JWT_SECRET ever leaks, old tokens stay valid until the 30-minute TTL even though `revokeAllUserTokens` ran. Access tokens are stateless, so that's expected, but consider a `tokenVersion` column on User that's compared inside authMiddleware for truly-global logout.
**Fix:** P2-class — add `user.tokenVersion` and check it in `authMiddleware`.

---

## P2 — Hardening

### [P2-1] CSP allows `frame-ancestors 'none'` but no `frame-src`
**File:** middleware/security.ts:138-142
The CSP is `"default-src 'none'; frame-ancestors 'none'"` — correct for a JSON API. No change needed, but consider adding `base-uri 'none'; form-action 'none'` for completeness.

### [P2-2] `X-XSS-Protection: 0` is correct modern guidance, but consider removing the header entirely
security.ts:144 — fine, modern browsers ignore it.

### [P2-3] `credentials: true` with CORS whitelist is safe, but document the expectation
index.ts:66-97 — the whitelist approach is correct. Note that `CORS_ORIGINS` splits on comma without trimming protocol — if someone sets `https://app.lifeos.com ` (trailing space) it silently fails to match. The `.trim()` on line 59 handles that — good.

### [P2-4] `validate(schema)` middleware re-assigns `request.body = result.data` — Zod strips unknown keys, which is defense-in-depth, but `request.body` type is not narrowed in handlers (every handler does `as z.infer<...>`). No bug, just friction.

### [P2-5] `export/csv/:module` doesn't Zod-validate `module` param
export.ts:30-131 — uses a `switch` with default 400. Safe, but inconsistent with the rest of the codebase. Add `z.object({ module: z.enum(['finance','habits','tasks']) })` for consistency.

### [P2-6] Bcrypt work factor 12 is fine today but bumping to 13 in 2026 is cheap
auth.ts:125 — 12 is OSSF-blessed for 2025. Consider 13 on next password rotation.

---

## Verification of previous session fixes

- [x] **1. JWT_SECRET length check** — index.ts:30-37 enforces ≥32 chars and hard-exits. Good.
- [x] **2. ENCRYPTION_KEY 32-byte hex** — crypto.ts:23-34 enforces 64 hex chars. Good. (Minor P2: add `.length === 32` assertion on the decoded buffer.)
- [x] **3. AES-256-GCM implementation in lib/crypto.ts** — reviewed above. **SAFE**. Random IV per call, auth tag verified, no key default, no timing-attack surface. The legacy-fallback catch is acceptable for the current migration phase but should be hardened post-migration (see crypto review).
- [x] **4. routes/integrations.ts uses encrypt()/decrypt() for Google OAuth tokens** — integrations.ts:51-66 wraps both accessToken and refreshToken in `encrypt()` for both upsert branches. Good. Decryption happens via `decrypt()` (not currently called in this file — will be needed once the actual Google API sync is implemented in `/integrations/google-calendar/sync`). No current leak.
- [x] **5. routes/vision.ts and voice.ts no longer leak err.message** — vision.ts:117-122 and voice.ts:295-302 log `{err}`/`lastError` server-side, return generic Russian messages to client. Verified.
- [x] **6. routes/chat.ts Zod action schemas + MAX_ACTIONS_PER_RESPONSE=5 + ReDoS-safe regex** — chat.ts:66-98 has all three. The regex `/\[ACTION:(\w{1,32}):(\{[^}]{0,2000}\})\]/g` is linear time (no nested quantifiers). ACTION_SCHEMAS validates 6 known types. Good. **See P1-5** for the residual "LLM-can-still-emit-real-money-actions" concern.
- [x] **7. routes/auth.ts ACCESS_TOKEN_TTL = '30m'** — auth.ts:41. Refresh rotation with DB-stored hashes, revoke-all-on-reuse detection (auth.ts:200-213). Excellent.
- [x] **8. src/index.ts CORS rejects via cb(null, false)** — index.ts:73-94. Correct — no stack trace in logs on denied origins. Good.

---

## Additional notes for the maintainer

**Authentication coverage:** I spot-checked every route file. Every file except `index.ts` registers `app.addHook('preHandler', authMiddleware)` at the top of its route registrar. This means ALL routes in that file are behind auth. No unauthenticated endpoints were found apart from `/health` and the `/auth/*` endpoints themselves — which is correct.

**IDOR coverage:** Every Prisma write verified. Pattern used across the codebase:
```
const x = await prisma.X.findFirst({ where: { id, userId: request.userId } });
if (!x) return 404;
await prisma.X.update({ where: { id }, data: ... });
```
This is correct — the `findFirst` with composite filter prevents cross-user access, and the subsequent `update` only runs after ownership is confirmed. Verified in: tasks.ts, habits.ts, goals.ts, finance.ts, events.ts, journal.ts (upsert uses composite `userId_date`), steps.ts (composite `userId_date`), integrations.ts (composite `userId_provider`), achievements.ts (composite `userId_key`), pet.ts (all by `userId`), import.ts. **No IDOR was found** in the standard CRUD routes.

**The IDOR-adjacent issue is P0-1 (pet/unlock-item) and P0-3 (self-challenge)** — not classical IDOR but the same class of "server trusts client-declared identity/state".

**SQL injection:** No `$queryRaw` or `$executeRaw` usage found in the codebase. All DB access goes through Prisma's query builder which parameterizes correctly. No risk.

**Command injection:** No `child_process`, `exec`, `spawn` calls in server source. `import.ts` parses xlsx/csv/ics in-process (not via subprocess) — no command-injection surface, but see P0-4 for the xlsx library issue.

**Secrets hygiene:** `.env` sits in `packages/server/.env` and the root `.gitignore` has `.env` listed. **However**, there is no `packages/server/.gitignore`. If someone runs `git init` from the server subdir or uses a different tool, `.env` might leak. **P2**: add an explicit `.env` entry to `packages/server/.gitignore`.

**Prompt injection:** The system prompts in `assistant-personality.ts` interpolate `ctx.userName`, `ctx.yearlyGoalsSummary`, `ctx.todayTasks[].title`, event titles, etc. All these come from the user's own DB writes. A user can therefore inject prompt instructions into their own system prompt — **but only to affect their own session's Claude responses**. There is NO cross-user prompt injection because data is always scoped to the calling user. The only real risk is (a) the user manipulating Claude to emit a money-creating action (mitigated by P1-5 recommendation to require confirmation) and (b) a malicious imported file (see P0-4) containing event/task titles that get echoed into the next session's system prompt, but again — only affects the same user. **Acceptable threat model.**
