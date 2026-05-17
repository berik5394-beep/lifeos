# Step 0 — Empirical evidence (SSOT migration gate)

Prod: project `vivacious-smile` / service `lifeos-api` / env `production`
Captured live via `railway logs --json`, repro run 2026-05-17 ~12:05 UTC
User: `cmp6n0jf90000pf017gv1kukz`

## Repro

| Msg | Sent | Log result |
|-----|------|------------|
| #1  | `40 000 ₸ — комиссия Kaspi Gold за перевод` | **No `intent=add_expense` line at all** (executed OR pending). `grep -c add_expense` over full capture = 0. Routed to JARVIS-chat branch (jarvis-orchestrator.ts:582, unlogged) → text reply, no DB write. |
| #2  | `Запиши доход 150000 тенге — зарплата за май` | `12:05:52.366Z [jarvis] user=cmp6n0jf9… intent=add_income PENDING (awaiting confirm)` |
| #3  | `да` | `12:05:57.377Z [jarvis] user=cmp6n0jf9… intent=add_income CONFIRMED → "Доход 150000 ₸ записан (зарплата за май)"` |
| #4  | `Какой сегодня день недели? И поставь встречу в среду 20 мая в 15:00` | No `intent=create_event` line → event NOT created, routed to chat branch. |

## Conclusions

1. **Bug #1 confirmed:** `add_expense` tool is never invoked for free-form expense phrasing → expense never persisted. Any "записан" reply is fabricated by the toolless chat path.
2. **create_event** same failure mode for the calendar/date message.
3. **Bug #4 confirmed:** explicit imperative ("Запиши доход") still forced through PENDING confirm gate.
4. Confirm round-trip (PENDING → "да" → CONFIRMED → write) works in ~5s via Telegram — sound base for per-tool needsConfirm.

## Incidental prod findings (separate from SSOT scope)
- `Frankfurter HTTP 404` in convertCurrency → enforceTenge → handleMessage (spawned as separate task).
- `Voyage 429` embeddings rate-limited (no payment method) — ops/billing action.
- `runAgent(localTools) failed → degraded to web_search-only` observed earlier (11:05Z) — toolless degradation is a live steady-state, the mechanism behind #1/#5.
- `[push] expo push error: "ExponentPushToken[test123abc]" is not a valid Expo push token` — stale test token in prod; `[scheduler] tick done: 1 delivered, 2 users` confirms proactive scheduler runs in prod.
