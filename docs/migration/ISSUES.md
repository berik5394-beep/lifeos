# Out-of-scope issues found during SSOT migration

These are NOT fixed by the SSOT migration (Steps 1–9). Tracked here so
they aren't lost.

## ISSUE-1 — runAgent degraded mode must return an honest refusal, not silently fabricate

**Severity:** high — this is a *live mechanism of bug #1*, persists even after Step 9.

**Observed (prod, 2026-05-17):**
```
[jarvis] runAgent(localTools) failed user=… AI model request failed — retry without localTools
[jarvis] degraded OK user=… web_search-only ответ сработал (проблема именно в localTools-комбинации)
```
When the Claude tool-use call fails (rate-limit, transient error, the
Frankfurter-404 exception inside the flow), `jarvis-orchestrator`
silently degrades to a **web_search-only chat with zero tools**. In
that state the model cannot call any tool, so it *generates text*
like "Расход записан" while nothing is written. The user sees a
confident lie.

**Required behavior:** when the tool-capable path fails, return an
explicit, honest message to the user — e.g. *"Извини, сейчас не могу
выполнить это действие — попробуй через минуту"* — and do NOT fall
through to a toolless chat that can fabricate confirmations. A
read-only informational answer may still degrade gracefully, but
anything that *should* have executed a tool must surface the failure,
not hide it.

**Why separate from SSOT:** the SSOT migration makes the registry the
single source of truth and audits real calls, but the degradation
path itself (orchestrator catch → web_search-only) is independent. A
fabricated "записал" during degraded mode would still produce zero
`ToolCall` rows (audit stays honest) — but the *user* is still lied
to. This needs its own fix in the orchestrator's degradation branch.

**Location:** `packages/server/src/services/jarvis-orchestrator.ts`
degradation catch (~lines 617–651).

## ISSUE-2 — Frankfurter currency API 404 (spawned separately)
## ISSUE-3 — Voyage embeddings 429 / no payment method (ops/billing, not code)

## ISSUE-4 — Unexplained PENDING→CONFIRMED in 9µs (money-safety, verify before Step 6)

Prod 2026-05-17T15:07:18Z: a single "Запиши доход 50000 тенге" produced
`intent=add_income PENDING` then `intent=add_income CONFIRMED` 9µs apart,
with no separate "да". FSM logic cannot produce this from one message
(confirm regex is anchored — "Запиши доход…" is not a confirm). User
reported sending the income message twice and was unsure whether to
confirm — likely interleaved manual sends and/or Telegram update
double-delivery, but UNCONFIRMED. Restart test #1 (15:07:37 pending →
15:10:50 restart → 15:11:30 confirm) is clean and unaffected.

REQUIRED before Step 6 (money): a clean controlled re-verify — exactly
one "доход" message, observe PENDING, then exactly one "да", confirm a
single CONFIRMED. Assert the normal path does NOT auto-confirm without
an explicit separate "да". If reproduced, investigate Telegram update
de-duplication in telegram-bot.ts and/or a race in handleMessage.

### ISSUE-4 — RESOLVED (2026-05-17, clean prod re-verify)

Controlled single-sequence re-verify on deployed foundation:
`Запиши доход 77777 тенге` (once) → exactly one `intent=add_income
PENDING` at 15:15:28, ZERO CONFIRMED over an 18s window (no
auto-confirm). Then `да` (once) → exactly one `intent=add_income
CONFIRMED → "Доход 77777 ₸ записан"` at 15:17:08. PENDING=1,
CONFIRMED=1. Conclusion: the 15:07:18 9µs PENDING→CONFIRMED was NOT
a code defect — it was the user's double-send interleaved with a
prior pending. Normal money path is safe (no confirm without an
explicit separate "да"). Money-safety gate for Step 6 satisfied.

## ISSUE-5 — intent-parser: "Закрой задачу X" → complete_habit (Step 8)

Prod 2026-05-17 ~16:06: "Закрой задачу тест реестра" classified as
`complete_habit` (deterministic regex `^(?:отметь|выполнил|сделал|
закрой)\s+(?:привычку\s+)?(.+)$` swallows "закрой задачу …" before
complete_task). Pre-existing parser bug, NOT Step 5 (Step 5 routed
it through the registry cleanly, 0 deprecated). Fix belongs to
Step 8 (booking-routing / intent-parser shrink): "закрой/заверши
задачу X" must map to complete_task, not complete_habit.

## ISSUE-6 — fake badge confirmed live (Step 7)

Prod 2026-05-17 ~16:0x: a `create_event` action returned the badge
"📝 +1 в задачи" (wrong noun, wrong source). Confirms bug #5 is
still live: badges come from captureInBackground NLP, not real
tool_use / ToolCall. Step 7 fixes (badges read /audit/counts).

## ISSUE-7 — Step 6 internal verification DEFERRED (Railway rate-limit)

Step 6 (money via registry) is BEHAVIORALLY verified in prod via
authoritative bot replies: free-form "Запиши расход 88888 … Kaspi"
→ bot ASKED confirmation (no fabrication, no auto-write) → "да" →
"Расход записан ✅". Bug #1 user-facing lie pattern is gone.

NOT yet verified (Railway CLI rate-limited / empty; bot text is
Claude-rephrased so path not inferable from wording):
- that it went through the audited registry path (ToolCall row written)
- zero `[deprecated] action-executor.add_expense`
- no auto-confirm before "да"
- possible DUPLICATE 88888 expense ("бот: уже второй раз с такой
  суммой") — data-integrity check.

TODO when Railway rate-limit clears: pull `railway logs --since`
around the 88888 test, confirm `intent=add_expense PENDING` then
`CONFIRMED` via registry, 0 deprecated, and check Expense table for
duplicate 88888. Until then Step 6 is "behavior verified, internal
verification pending" — NOT a green checkmark.

## ISSUE-8 — captureInBackground creates junk tasks/memories from any chat (Step 8/quality)

Root finding behind the fake badge: captureInBackground runs NLP
extraction on EVERY chat message and ACTUALLY creates Task/Memory
rows — so "Запиши расход 88888 …" produced a bogus task + memory
(that's what the old "+1 в задачи" counted). Step 7 removes the
fabricated BADGE (now audit-truthful), but captureInBackground still
pollutes tasks/memories from non-task messages (expense commands,
confirmations, questions). This is a precision bug separate from
badges. Decide in Step 8 / quality pass: gate captureInBackground
to genuine task-bearing chat only, or drop auto-create entirely.
Not fixed by Step 7 (scope = badge truthfulness).

## ISSUE-7 — RESOLVED (2026-05-17, proven by prod DB)

Step 6 v1 (regex deleted) FAILED: "Запиши расход 88888 … Kaspi" →
Expense WHERE amount=88888 = 0 rows; bot fabricated "Расход
записан ✅" (chat-agent, no money tool). Bug #1 regressed by the
regex deletion.

FIX (commit 80c0695): restored deterministic money prefilter →
routes into Step-6 registry. Re-verified by DB on the fixed deploy
(hostname da9f27b1a4b8):
- "Запиши расход 99999 тенге тест Kaspi реестр" →
  Expense row: amount 99999 @ 2026-05-17 17:15:15.378
  ToolCall row: add_expense @ 2026-05-17 17:15:15.392 (+14ms)
The 14ms gap is the auditToolCall signature (handler then sink) —
proves money went through runRegistryTool→auditToolCall, audited,
not legacy, not fabricated. Bug #1 truly closed, DB-proven.
Audit infra confirmed live in prod (5 ToolCall rows: create_task,
create_event x2, complete_habit, add_expense).
Note: Railway dashboard row-list grid glitches (stale "No Results");
aggregate queries (COUNT/GROUP BY) render correctly — use those.

## ISSUE-5 — RESOLVED (Step 8); intent-parser.ts KEPT (decision by test)

Fix: added complete_task deterministic rule BEFORE complete_habit —
"закрой/заверши/закончи/выполни задачу X" → complete_task (was
mis-caught as complete_habit "задачу X"). Regression tests cover
"Закрой бег"→complete_habit and "Создай задачу"→create_task intact.

Step 8 decision: booking-routing.test.ts (10 booking phrases) PASSES
→ deterministic booking-prefilter is a proven correctness layer
(Claude systematically misclassifies booking↔create_task; Step 6
also proved deleting the deterministic money layer regressed #1).
Test even exposed+fixed a prefilter gap ("найди МНЕ отель" → added
BOOK_VERB + NOUN-guard rule). DECISION: intent-parser.ts is NOT
deleted/shrunk — it stays. Step 9 deletion scope = conversation-
engine.ts, action-executor switch, manual CAPABILITY_TEXT,
NEEDS_CONFIRM array ONLY (NOT intent-parser.ts).

## ISSUE-8 — RESOLVED (quality gate)

Root: captureInBackground ran extractFromTranscript on EVERY
chat-fall-through message → questions/chitchat became junk
tasks/memories. (The 88888-class money pollution was already
removed by the Step 6 fix: money commands now early-return via
EXECUTABLE and never reach captureInBackground.)
Fix: looksCaptureWorthy() deterministic gate (no LLM/DB) — skip
questions (ends with ?, interrogative starts), <12-char replies,
assistant-directed chitchat (мотивируй/расскажи/привет/как дела).
Genuine ambient capture ("купи продукты", "надо позвонить врачу",
fact statements) preserved. 16 unit tests. suite 283/283.

## ISSUE-8 — HARDENED (assistant-control commands no longer captured)

Found via real chat: user said "Поставь будильник на 7 утра" inside
an app-control bundle ("Открой экран… Экспортируй… Отправь в
телеграм… Перенеси задачу…"). Bot verbally declined alarm, but
captureInBackground NLP-created a junk task "Будильник 7 утра
(высокий приоритет)" — which then surfaced via get_tasks. NOT
fabrication, NOT optimization — ISSUE-8 pollution; the looksCaptureWorthy
gate (questions/chitchat/short) did NOT cover imperative
assistant-control bundles. Fix: ASSISTANT_CONTROL denylist
(будильник, открой экран, экспортир, в телеграм/whatsapp, в колонк,
фокус-режим, покажи календарь, открой приложение) → skip capture.
Personal ambient ("купи продукты", "надо позвонить") unaffected.
8 new tests; suite 301/301. NOTE: pre-existing junk task rows
created BEFORE the gate remain in DB — need one-time cleanup
(see migration/CLEANUP.sql; user runs review→delete, not auto).

## ISSUE-X — deploy pipeline cutover: `prisma db push` → `prisma migrate deploy`

**Severity:** high (latent footgun) — opened 2026-05-18 after a real
deploy incident.

**Incident:** the P0-billing commit dropped User.subscriptionTier/
subscriptionExpiresAt from schema.prisma. The Railway deploy CMD
(Dockerfile) is `... && npx prisma db push --skip-generate && node
dist/index.js`. `db push` without `--accept-data-loss` in a
non-interactive container REFUSES a destructive column drop and exits
non-zero → `&&` blocks `node` → server never listens → Network/
Healthcheck fails → Railway keeps the previous deploy. The whole batch
(billing/Pet.streak/import) + Phase 5 P1 rode the same broken push, so
prod was stuck on a 2h-old commit while branch commits looked "done".
Fixed by reverting the destructive op (1ef5125: restore the columns
as orphans; deploy went green, "database already in sync").

**Required:** move the deploy from `db push` to `prisma migrate
deploy` (apply committed migration files with history), so destructive
changes are explicit, reviewed, and ordered — not silently blocked at
runtime. Until then: NEVER remove a column/table from schema.prisma
(any destructive schema change) — additive only. `--accept-data-loss`
is explicitly rejected (footgun: a stray schema deletion would silently
drop prod data, e.g. User.email, on the next deploy).

**Do NOT do this now** — refactoring the deploy pipeline during/just
after a deploy incident adds crisis to crisis. Schedule when prod is
stable and Phase 5 P2/P3 are not mid-flight. Our hand-written
IF-EXISTS migrations must be reconciled with Prisma's _prisma_migrations
history as part of the cutover (resolve/baseline), or migrate deploy
will fail on drift.

## ISSUE-Y — DROP orphan subscription columns (depends on ISSUE-X)

User.subscriptionTier/subscriptionExpiresAt are dead (no code reads
them — subscription.ts and the lying route were deleted in the P0
billing fix, which STANDS). They are kept in schema.prisma ONLY so
`db push` stays non-destructive (see ISSUE-X). Marked `/// @deprecated`
in schema. The actual `ALTER TABLE "User" DROP COLUMN` must wait until
ISSUE-X (migrate deploy cutover) is done, then ship as one explicit
reviewed migration. Blocked-by: ISSUE-X. Do not attempt via db push.

## ISSUE-2 (Phase 5 era) — send_telegram sends the literal phrase, not resolved content

**Severity:** P1 — breaks a flagship use-case ("look, JARVIS sends me
my day"). Found in prod 2026-05-18 by Berik.

Repro: «отправь мне в телеграм список задач на сегодня» → bot asks
confirm «Отправить тебе в Telegram: "список задач на сегодня"?» →
«да» → Telegram receives the literal text "список задач на сегодня",
NOT the actual task list.

Root: send_telegram tool puts the raw user phrase into the message
body. It does not resolve intents like "список задач / расписание /
финансы" by first calling the matching read-tool (get_tasks/
get_calendar/get_budget) and sending THAT rendered result.

Required: when the send target is a data view, the brain must first
call the read-tool, render the result, and put the rendered result in
the Telegram body. Likely fix in the orchestrator/agent path (compose
result before send_telegram), not in send_telegram itself (keep that
tool dumb: it sends the text it's given). Honesty note: still must go
through the confirm gate (9B.2 invariant) — fixing this must NOT make
send autonomous.

## ISSUE-3 (Phase 5 era) — PENDING confirm-action leaked into Task list

**Severity:** P1 — pollutes the task list, erodes trust over time.

Observed: «Записать расход 2000 тенге на обед» (a PENDING money
confirm-action from a voice message, id cmpb8eluz...) appeared as a
Task in get_tasks output. Same class seen across many rows in the
2026-05-18 cleanup ("Записать расход…", "Записать доход…",
"Отправить Серику в телеграм…", "Экспортировать…", "Подвести итоги
дня" — all commands materialized as Task rows).

Candidate causes (need diagnosis, do NOT guess-fix):
1. intent-parser misclassifies "запиши расход …" as create_task
   instead of add_expense on the voice path.
2. captureInBackground (ISSUE-8 family) NLP-extracts the command as a
   task despite the ASSISTANT_CONTROL/looksCaptureWorthy gate (gate
   may not cover money/command phrasings on the voice route).
3. double-write: confirming a pending also create_task's.
Diagnose with voice-pipeline + intent-parser logs around a controlled
"запиши расход N" voice message; assert exactly one Expense PENDING
and ZERO Task created. Related: ISSUE-8 (capture pollution) — likely
the same root on the voice path.

## ISSUE-4 (cosmetic) — "выполнено только 0" grammar

**Severity:** P2 — UX polish (App Store review bait).

When completed-count is 0 the bot says «Из них выполнено только 0:».
Add a system-prompt rule: if N=0 phrase as «ни одной ещё не
выполнено» / «пока ничего», never «только 0». Also: voice answers
still too long (~25s TTS). Add to the voice prompt: max ~3 sentences
/ ~15s speaking time; for detail say "открой приложение / хочешь
полный список". Prep for mobile UX.
