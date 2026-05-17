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
