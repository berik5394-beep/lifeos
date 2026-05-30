# v2.0 Week 5 — SMOKE checklist (Berik only)

**Goal:** validate v2 memory + proactivity end-to-end on prod with a single user (Berik) before opening to Aydana (Week 7).

**Prerequisites:**
1. Server deployed to Railway with Week 5 code merged to `main`.
2. Berik's userId known (from prod DB: `SELECT id FROM "User" WHERE email = '<berik_email>';`).
3. Two new ENV vars set on Railway (DO NOT enable for anyone else):
   - `FEATURE_V2_MEMORY=user-{berikUserId}`
   - `FEATURE_V2_PROACTIVITY=user-{berikUserId}`
4. Railway will auto-redeploy on env change. Wait for green health check.

**ENV-set commands (Berik runs manually):**
```bash
# In Railway dashboard or via CLI:
railway variables set FEATURE_V2_MEMORY=user-<paste-berik-id>
railway variables set FEATURE_V2_PROACTIVITY=user-<paste-berik-id>
# Trigger redeploy if needed.
```

**Rollback (if regression spotted):**
```bash
railway variables set FEATURE_V2_MEMORY=none
railway variables set FEATURE_V2_PROACTIVITY=none
# Both flags off → orchestrator/scheduler skip v2 paths bit-identically to pre-Week-5.
# Existing prod data in Memory/captureMemory untouched.
```

## Day 1 — Basic capture + identity

- [ ] `/setname Соя` — expect reply `Готово, теперь меня зовут Соя 🤍`.
- [ ] `/setname ` (empty) — expect `Использование: /setname Имя`.
- [ ] `/setname Очень-Длинное-Имя-Которое-Точно-Длиннее-Тридцати` — expect rejection.
- [ ] DB check: `SELECT * FROM "BotIdentity" WHERE "userId" = '<berik>';` — `botName = 'Соя'`.
- [ ] Send a normal chat msg: `"Помни, мою маму зовут Гульнара, живёт в Алматы"`.
- [ ] DB check 30s later:
  - `SELECT * FROM "Entity" WHERE "userId" = '<berik>' AND name ILIKE '%гульнара%';` — one row, type=person.
  - `SELECT * FROM "Entity" WHERE name ILIKE '%алматы%';` — one row, type=place.
  - `SELECT * FROM "Memory" WHERE "userId" = '<berik>' ORDER BY "createdAt" DESC LIMIT 1;` — STILL written (dual-write preserved).
- [ ] Bot reply itself should be unaffected (no regression in tone or completion).

## Day 2 — Entity awareness + prompt enrichment

- [ ] Send: `"что ты помнишь про мою маму?"` — bot should mention "Гульнара" and "Алматы" without the user repeating those names this turn (proves V2 enrichment block landed in prompt).
- [ ] Tail Railway logs while sending the message — look for: no `v2-` warnings.
- [ ] Send: `"опять с мамой поссорился"` — emotional. Check MoodSnapshot row created within 30s.

## Day 3 — Proactivity

- [ ] Manually invoke a single scheduler tick (or wait for next 10-min tick).
- [ ] If no candidates: log `candidates=0 passed=0 delivered=0` is normal — proactivity needs accumulated data (patterns, stale entities). Berik likely doesn't have streak_break/frequency patterns yet — DETECTION COVERAGE in Week 5 is sparse-by-design. Goal is no crashes.
- [ ] DB sanity: `SELECT source, COUNT(*) FROM "Insight" WHERE "userId" = '<berik>' GROUP BY source;` — `v2-proactivity` may be 0 (acceptable Week 5; spike expected Week 6 after cron extraction).
- [ ] Confirm no extra TG spam: bot's existing `/start`, `/setname`, voice, text behaviours unchanged outside the test interactions.

## Acceptance criteria

- [ ] No 5xx errors in Railway logs caused by `v2-`/`captureV2`/`proactivity` code paths.
- [ ] Old captureMemory continues to write (`SELECT count(*) FROM "Memory" WHERE "userId" = '<berik>' AND "createdAt" > now() - interval '3 days'` shows growth).
- [ ] At least 2 Entity rows created for Berik in 3 days.
- [ ] At least 1 MoodSnapshot for Berik in 3 days.
- [ ] `/setname` round-trip works.
- [ ] Bot reply quality not visibly worse than Week 4.

## Failure response

If any **acceptance** fails or any unexplained 5xx spike appears:
1. Flip both flags to `none` in Railway (see Rollback above).
2. Open issue, attach Railway log excerpt + reproduction.
3. Do NOT proceed to Week 6 Aydana extension until root-cause fix lands.
