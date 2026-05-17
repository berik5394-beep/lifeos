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
