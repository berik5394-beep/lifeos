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
| 2 | Prisma schema migration | — | — | — |
| 2 | Tier 1+2 implementation | — | — | — |
| 3 | Tier 3 + entity graph | — | — | — |
| 4 | Tier 4 mini + Tier 5 mini + identity mini | — | — | — |
| 5 | Proactivity engine + agent tools | — | — | — |
| 6 | Cron tasks + migration script + integration tests | — | — | — |
| 7 | Feature flag rollout Berik → Aydana + behavioral SMOKE + tag v2.0-alpha | — | — | — |
| 8-12 | Phase B (full versions) | — | — | — |

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
