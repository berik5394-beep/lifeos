# v2.0 — Memory + Proactivity (SCOPE LOCK 2026-05-28, ОБНОВЛЕНО)

> **Принято Berik'ом 2026-05-28.** Путь 2 (5-tier phased, 9-10 недель).
> Этот документ — **scope lock + work protocol**. Любое расширение
> требует явного повторного решения от Berik.

---

## Северная звезда

> **Память + проактивность = ядро LifeOS. Всё остальное — руки.**
>
> Бот должен быть как полноценный друг: помнит детали, инициирует
> разговор, знает паттерны юзера, замечает изменения, имеет свой характер.
>
> Benchmark: «давно не звонил маме, как она?» (gap detection) + «обычно
> ты бросаешь habits на 3-й неделе, давай я напомню?» (pattern awareness).

---

## АРХИТЕКТУРА: Multi-Store Cognitive Memory (5-tier phased)

Atkinson–Shiffrin + Tulving model. Phased rollout: Phase A — все 5 tier
в minimal версиях, Phase B — full versions.

### Phase A — 5 недель (5-tier MINI + identity mini + proactivity)

```
┌──────────────────────────────────────────────────────────┐
│ 1. WORKING MEMORY                                         │
│    In-process Map + ChatMessage (уже есть)                │
│    TTL eviction после час idle                            │
├──────────────────────────────────────────────────────────┤
│ 2. EPISODIC MEMORY                                        │
│    Расширяем нашу Memory table:                           │
│    + validAt / invalidAt колонки (Graphiti pattern)       │
│    + entityRefs (FK к Entity table)                       │
│    + mood (scalar -1..+1)                                 │
├──────────────────────────────────────────────────────────┤
│ 3. SEMANTIC + ENTITY GRAPH                                │
│    Новые таблицы: Entity, EntityRelationship              │
│    Storage: Postgres + recursive CTE                      │
│    Abstraction: entity-graph-service.ts (interface для    │
│      future Neo4j swap без переписи бизнес-логики)        │
├──────────────────────────────────────────────────────────┤
│ 4. PROCEDURAL MINI                                        │
│    Auto-extracted patterns: frequency, time-of-day,       │
│    recurring topics, обязательства/обещания               │
│    Storage: Pattern table                                 │
│    Trigger: weekly batch + on-demand                      │
├──────────────────────────────────────────────────────────┤
│ 5. EMOTIONAL + IDENTITY MINI                              │
│    Mood per msg (existing emotional-classifier)           │
│    Entity mood association (мама ↔ negative когда ссора)  │
│    Identity: имя бота + выбранный стиль (фиксированный)   │
└──────────────────────────────────────────────────────────┘

PROACTIVITY ENGINE (новый сервис):
  Heartbeat: scheduler tick 10min (уже есть)
  Change-detector: scan entities lastSeen + procedural patterns
  4-gate filter (KAIROS pattern from NEST):
    1. DND quiet hours (уже есть)
    2. Rate limit: max 1-2 nudge/день/юзер
    3. Significance score > threshold
    4. Dedup: не повторяем тот же entity 7 дней
  Nudge generator: tone from UserProfile.styleNotes
  Output: Insight stream → deliverTopInsight (уже есть)

AGENT TOOL EXTENSIONS:
  + remember_entity (бот сам создаёт entity)
  + link_relationship (бот связывает entities)
  + suggest_goal / suggest_task / suggest_event
    (бот предлагает, юзер подтверждает confirm-pattern)
```

### Phase B — 4-5 недель (full versions)

- Tier 4 FULL: Hermes-like skill auto-creation
- Tier 5 FULL: NEST-like emergent personality (axis signals)
- Identity evolution: бот растёт от взаимодействий
- Cross-session learning: closed feedback loop

---

## Stack — что используем, что НЕ используем

### Используем
- Postgres + pgvector (уже есть, расширяем schema)
- Prisma migrations (обязательно, ad-hoc db push запрещён)
- Voyage embeddings (уже есть)
- Anthropic Sonnet 4.6 + Haiku 4.5 (после v1.4.1 model SSOT)
- **Паттерны** из Mem0/Graphiti/NEST/Hermes — копируем, не подключаем как lib

### НЕ используем
- ❌ Mem0/Zep/Letta/NEST как библиотеки (vendor lock-in)
- ❌ Neo4j в Phase A (отложено; abstraction layer готовит к swap если нужно)
- ❌ Redis (working memory через in-process Map; для 1 instance Railway OK)
- ❌ Внешние proactivity-as-a-service

---

## Lock'и для дисциплины

| Соблазн | Запрет |
|---|---|
| Сразу подключить Mem0 как lib | Паттерны — да, lib — нет |
| Сразу Neo4j | Postgres CTE + abstraction в Phase A |
| Persistent identity FULL в Phase A | Identity mini только; emergent — Phase B |
| Cross-platform gateway (Discord/Slack) | Telegram остаётся, остальное phase N |
| Заменить captureMemory на Mem0 API | Расширяем существующий |
| «А давай ещё это» в процессе | СТОП → спросить Berik → дождаться ответа |

---

## Benchmark v2.0 Phase A done = ✓

- [ ] Юзер упоминает «маму» 3 раза за неделю
- [ ] Не упоминает 10 дней
- [ ] Бот сам пишет: «давно ничего не говорил про маму, как она?»
- [ ] Бот замечает паттерн: «обычно бросаешь habits на 3-й неделе»
- [ ] Бот знает кто Серик, мама, работа — через entity graph
- [ ] Mood tracking: бот замечает «ты сегодня грустно пишешь»
- [ ] Никаких false positives (не пишет «давно не упоминал X» если X
      реально был упомянут вчера)
- [ ] Не спамит — не больше 1-2 проактивных nudge / день
- [ ] Aydana smoke: 3 дня без регрессии

---

## Timeline (estimated)

### Phase A — 5 недель
- **Week 1:** Design spec → self-review → review Berik → approval
- **Week 2:** Prisma schema migration (Entity, EntityRelationship,
  Pattern, MemoryEvent с validAt/invalidAt, MoodSnapshot, Identity)
  + Tier 1+2 (working + episodic)
- **Week 3:** Tier 3 (entity graph + abstraction layer для Postgres CTE)
- **Week 4:** Tier 4 mini (patterns) + Tier 5 mini (mood) + identity mini
- **Week 5:** Proactivity engine + agent tool extensions + behavioral SMOKE
  + feature flag rollout (Berik first, потом Aydana)

### Phase B — 4-5 недель (после Phase A SMOKE)
- Full tier 4 + tier 5
- Identity evolution
- Cross-session learning
- Tag v2.0 после Phase B success

### Total: ~9-10 недель до полного v2.0

---

## WORK PROTOCOL (правила работы Berik'а 2026-05-28)

**1. Перед началом любой работы — обнови в памяти.**
   → Прочитать этот scope lock + cross-session memory `v2_memory_proactivity_scope.md`
   → Убедиться что текущая задача в scope, не расширение

**2. Иди строго по записанному.**
   → Не отклоняться от scope без явного approval Berik'а
   → Pacta sunt servanda — любое расширение = СТОП + спросить

**3. После каждой сделанной работы — checkpoint.**
   → Заходишь в память (этот файл) → отмечаешь что сделано
   → Смотришь что дальше по timeline
   → Не прыгать вперёд — следующий шаг ровно тот что в spec

**4. Перед кодом — архитектура.**
   → Design spec в `docs/superpowers/specs/YYYY-MM-DD-*.md`
   → Prisma schemas всех таблиц
   → API signatures
   → Sequence diagrams (consolidation triggers)
   → Failure modes / edge cases

**5. Сам тестишь архитектуру и находишь ошибки.**
   → Self-review spec (placeholder scan, internal consistency,
     ambiguity check, scope check)
   → Прогон mental tests: ввести в spec потенциальные edge cases,
     убедиться что architecture handles
   → Если найдена ошибка в архитектуре — fix в spec, **не в коде**

**6. И только потом — код.**
   → После Berik approval design spec
   → После implementation plan через writing-plans skill
   → Каждый коммит — atomic, с tests
   → После каждого коммита — снова checkpoint (шаг 3)

---

## Progress tracker (обновляется после каждого done step)

| Week | Step | Status | Date | Commit/Files |
|------|------|--------|------|--------------|
| 0 | Scope lock Path 2 | ✅ done | 2026-05-28 | docs/plan/v2-memory-proactivity-scope.md |
| 1 | Design spec draft | ✅ done | 2026-05-28 | docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md (1462 lines) |
| 1 | Self-review spec | ✅ done | 2026-05-28 | 8 ошибок найдено + исправлено inline |
| 1 | Berik review + approval | ✅ approved | 2026-05-28 | «ок» — spec approved |
| 1 | Implementation plan (writing-plans) | ✅ done | 2026-05-28 | docs/superpowers/plans/2026-05-28-v2-week2-schema-tier1-tier2.md (1915 lines, v2 careful — v1 халтура переписана) |
| 2 | Prisma schema migration (Tasks A1-A4) | ✅ done | 2026-05-29 | commit 1d3dc76, migration applied prod via db push |
| 2 | Tier 1 WorkingMemory (Tasks B1-B3) | ✅ done | 2026-05-29 | commits fbbb60a + 171967d + 2ce42a3, 15 tests |
| 2 | Tier 2 EpisodicMemory (Tasks C1-C5) | ✅ done | 2026-05-29 | commits 7d571e2 + c0fdc4f + 09c02a7 + aa63a29, 23 tests |
| 2 | feature-flags + Section D verify (D1-D2) | ✅ done | 2026-05-29 | commit 40d7118, 10 tests. **Week 2 TOTAL: 9 commits, 894/894 tests pass, tsc clean** |
| 3 | Tier 3 + entity graph | ✅ done | 2026-05-29 | 10 commits e07adbe…347a4d5 (A1, B1–B6, C1–C2, D1); +68 tests (894→962); tsc clean; 0 vi.mock; 0 placeholders. Plan: docs/superpowers/plans/2026-05-29-v2-week3-tier3-entity-graph.md |
| 4 | Tier 4 mini + Tier 5 mini + identity mini | ✅ done | 2026-05-30 | 12 commits 8c65c6e…77a8278 (B1–B8 ProceduralMemory + 5 extractors, C1–C3 EmotionalMemory, D1 IdentityService); +201 tests (962→1163); tsc clean; 0 vi.mock; 0 placeholders. Plan: docs/superpowers/plans/2026-05-30-v2-week4-tier4-tier5-identity.md |
| 5 | Proactivity engine + agent tools + wiring | ✅ done | 2026-05-30 | 16 commits 9494756…414db7e (A1-A6 ProactivityEngine, B1-B4 3 tools+registry, C1 /setname, D1-D3 capture+enrichment+orchestrator wiring, E1 scheduler hook, F1 SMOKE doc); +66 tests (1163→1262 inc Week 5 only 1196→1262 = +66 in this week's files); tsc clean; 0 vi.mock; 0 placeholders. Dual-write preserved; behavior byte-identical при flag=off. Plan: docs/superpowers/plans/2026-05-31-v2-week5-proactivity-wiring.md |
| 6 | Cron tasks + migration script + integration tests | ✅ done | 2026-05-30 | 10 commits 6ce0196…91267c2 + 588a289 progress (A1 CronJobRun, A2 cron-runner, A3 mood-retention, A4 pattern-extraction, A5 scheduler wire, B1+B2 migrate-to-v2.ts, C1+C2+C3 integration tests); +100 tests (1262→1362); tsc clean; 0 vi.mock; migration applied via Docker (idempotent); pushed + deployed 2026-05-30 after Berik approval. Plan: docs/superpowers/plans/2026-05-31-v2-week6-cron-migration-integration.md |
| 7 | Feature flag rollout Berik+Aydana + behavioral SMOKE + 3 post-rollout fixes + tag v2.0-alpha | ✅ done | 2026-05-30 | Railway ENV: FEATURE_V2_MEMORY/PROACTIVITY=user-berik(TG),user-aydana, FEATURE_V2_CRON=true. SMOKE verified in Telegram (Роза/Дана entities + Соя identity + reflective queries answer from v2). Post-rollout fixes: F1 (bogus task deleted in prod DB), F2 ce1b324 (MoodSnapshot.entityRefs propagation), F3 61ec308 (intent parser skips reflective queries). 1362 → 1371 tests pass. Tag v2.0-alpha on 61ec308 (Phase A done). |
| 8 (B1) | Phase B1 — USER NEST axes (Tier 5 FULL user side) | ✅ done | 2026-05-31 | 12 atomic commits c7c570f…e7f57e8 (A1 schema, B1-B5 service, C1-C2 analyze+rules, D1-D2 wiring, E1-E2 telegram+bootstrap) + F1 progress; +142 tests (1387→1529); tsc clean; 0 vi.mock; 0 placeholders; flag FEATURE_V2_AXES default off. Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md. Plan: docs/superpowers/plans/2026-05-31-v2-phase-b1-user-axes.md |
| 9 (B2) | Phase B2 — Identity Evolution (BOT axes / emergent persona) | ✅ done | 2026-05-31 | 13 atomic commits 1c75453…72609ca + F1 progress; +89 tests (1529→1618); tsc clean; 0 vi.mock; 0 placeholders; flag FEATURE_V2_IDENTITY default off. 4 bot traits (warmth/directness/humor/playfulness) + relationshipDepth, tone enrichment, growth narrative, /identity command, weekly snapshot cron, rare KAIROS-gated growth comment (max 1/mo, depth-shift 0.15), bootstrap. Reuses B1 axes. Spec: docs/superpowers/specs/2026-05-31-v2-phase-b2-identity-evolution-design.md. Plan: docs/superpowers/plans/2026-05-31-v2-phase-b2-identity-evolution.md |
| 10 (B3) | Phase B3 — Cross-Session Learning (feedback loop) | ✅ done | 2026-05-31 | ~10 atomic commits A1–E1 (schema 4 types, types 14 tests, classify-feedback Claude haiku classifier, detect-mood-drop MoodSnapshot Δ, detect-reask Voyage cosine, postgres-impl, index, wiring, transparency, integration E1); +52 tests (1618→1670); tsc clean; 0 vi.mock; 0 placeholders. Passive natural-language detection (no buttons): explicit corrections (Claude haiku) + mood-drop signal (ΔmoodScore threshold) + re-ask signal (cosine similarity). Corrections route through B1 axes via AxisSignal(source='feedback') — B2 traits follow deterministically (never edited directly). New CorrectionLog table for transparency; surfaced in /axes. Feature flag FEATURE_V2_FEEDBACK (default off). Files: src/services/feedback/ (types, classify-feedback, detect-mood-drop, detect-reask, postgres-impl, index). Local only (pending push+deploy). |
| 11-12 (B4) | Phase B4 — Hermes (composable skills) | ✅ done | 2026-05-31 | ~12 atomic commits A1–E1 (schema 3 types, types 11 tests, skill-builder 4, skill-router 4, postgres-impl 5, index 3, create-skill 5, wiring 5, detector 4, telegram 2, integration 4); +53 tests (1670→1723); tsc clean; 0 vi.mock; 0 placeholders. Skill = DATA (recipe of existing tools + synthesis), NOT codegen. Runs via the EXISTING agent loop (seeded instruction) → money/write steps inherit their confirm gates. Blocklist: pet + photo/calorie (at create AND run). Both creation paths: explicit `create_skill` tool (needsConfirm:true) + proactive `detectSkillOpportunity` (ToolCall clusters → KAIROS nudge, source='skill_suggestion'). skill-router: exact name + Voyage cosine. `/skills` Telegram command (list/delete). Feature flag `isV2HermesEnabled` (env `FEATURE_V2_HERMES`). Standard migration folder `20260531210000_v2_hermes_skills`. Files: `src/services/hermes/` (types, skill-builder, skill-router, postgres-impl, index) + `src/tools/create-skill.ts`. Known follow-up: cache skill embeddings before broad rollout (router re-embeds skills per message). Local only (pending push+deploy). |
| 13 (Reflector v2) | Reflector v2 — Cross-tier synthesizer | ✅ done | 2026-05-31 | ~6 atomic commits B1–E1 (types, gather-facts, synthesize, index, scheduler wiring, integration E1); +29 tests (1723→1752); tsc clean; 0 vi.mock; 0 placeholders. Cross-tier synthesizer: reads axes/traits/feedback/mood-trend (getMoodTimeline)/skills (listSkills)/stale-entities/procedural-patterns (getActivePatterns) + inline legacy summary → ONE keystone via Claude sonnet-4-6 (links ≥2 tiers + one concrete step). Two modes: weekly (rolling-7d gate, at most 1 weekly keystone per user per 7 days) + event-triggered (significanceScore compound signal, threshold 0.6, min 24h gap). Reuses EXISTING Insight store (persistCandidates, source='reflector_v2') — NO new table/migration; inherits TTL/supersede/cooldown/quiet-hours/≤1-push. Feature flag `isV2ReflectorEnabled` (env `FEATURE_V2_REFLECTOR`). Files: `src/services/reflector-v2/` (types.ts, gather-facts.ts, synthesize.ts, index.ts) + scheduler wiring in `src/services/proactive-scheduler.ts`. Integration test: `src/__integration__/v2-reflector-flow.test.ts` (4 structural assertions). Local only (pending push+deploy). |
| 14 (H2) | H2 — Hermes Action Skills (deterministic two-phase execution) | ✅ done | 2026-05-31 | ~7 atomic commits B1–E1 (arg-resolver haiku, skill-runner two-phase, orchestrator routing + runConfirmedAction branch, integration E1); +24 tests (1752→1776); tsc clean; 0 vi.mock; 0 placeholders. Closes the gap: money/confirm skill steps now EXECUTE. Route by composition — skills with any `needsConfirm` step → deterministic two-phase `runSkillPlan` (auto steps run via `runRegistryTool` + haiku synthesis; money/confirm steps batch into ONE `run_skill_actions` PendingAction, executed only after «да» via the new `runConfirmedAction` branch); read/write-non-money skills keep the existing agent-loop seed (zero regression). arg-resolver (haiku) fills step args from the user's message ("расход 3000" → amount). No new flag (reuses `isV2HermesEnabled`), no new table/migration. Files: `src/services/hermes/` (arg-resolver.ts, skill-runner.ts) + orchestrator routing + `runConfirmedAction` branch in `src/services/jarvis-orchestrator.ts`. Integration test: `src/__integration__/v2-hermes-action-flow.test.ts` (3 structural assertions). Local only (pending push+deploy). |
| 15 (P2) | P2 — Engagement-Aware Proactivity (lean) | ✅ done | 2026-05-31 | ~6 atomic commits B1–E1 (types, engagement service, index, threshold-wiring, deliver-wiring, integration E1); +28 tests (1776→1804); tsc clean; 0 vi.mock; 0 placeholders. Two adaptations: (a) **adaptive significance threshold** — InsightDismissal rows + Insight.deliveredAt + reply-within-6h → `receptiveness` score (0–1) → `adaptiveThreshold(base, receptiveness)` replaces fixed 0.6 in proactivity engine gate3 AND Reflector v2 event-triggered check (pester less when ignored, more when engaged); (b) **receptive-hour delivery defer** — `deliverTopInsight` defers non-critical pushes outside the user's active-hour window (ChatMessage hour histogram); critical (severity≥8) bypasses. No new table/migration (reuses InsightDismissal + Insight.deliveredAt + ChatMessage). Feature flag `isV2EngagementEnabled` (env `FEATURE_V2_ENGAGEMENT`, default off). Degrade-safe: flag off OR sparse data → `getEngagement` returns `{ receptiveness: 0.5, activeHours: [] }` → today's behavior byte-for-byte. Files: `src/services/engagement/` (types.ts, engagement.ts, index.ts) + wiring in `v2-proactivity-engine.ts`, `reflector-v2/index.ts`, `insight-store.ts`. Integration test: `src/__integration__/v2-engagement-flow.test.ts` (3 structural assertions). Local only (pending push+deploy). |

---

## Что НЕ делаем параллельно с этим scope'ом

Чтобы не разбрасываться:
- ❌ Backfill embeddings (отложили) — отдельно когда Voyage payment решён
- ❌ APK build (#11), 2GIS (#14), NewsAPI (#17) — pending tasks, не v2.0
- ❌ Sentry source maps (#15) — отдельно
- ❌ Worktree sync — отдельно

v2.0 — это **только память + проактивность**. Всё остальное parked
до Phase A done.

---

## Pacta sunt servanda — обязательство

Этот scope lock — **обязательство Berik'у**. Если в процессе появится
соблазн расширить (например «давай сразу emotional store!»), агент
**обязан**:
1. **СТОП** работу
2. Явно сформулировать что хочется расширить
3. Дать Berik'у объяснение + tradeoff
4. **Дождаться** явного approval
5. Только тогда — продолжить с обновлённым scope (новая запись в этом
   файле + memory)

Тихое расширение scope = нарушение договора. Прецедент 2026-05-28 (L99
с молчаливым расширением до 5-tier) — урок усвоен.
