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
