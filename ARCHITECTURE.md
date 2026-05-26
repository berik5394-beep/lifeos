# LifeOS — Архитектура и структура проекта

> Документ-источник правды для разработчиков и AI-агентов.
> Обновляется при структурных изменениях.
> **Дата последнего обновления: 2026-05-26 (v1.1.0 — Phase 7 tool-filter pattern).**

## Карта документов (куда смотреть)

| Файл                  | Зачем                                                  |
|-----------------------|--------------------------------------------------------|
| `AGENTS.md`           | Договор с AI-агентом (11 правил работы)                |
| `CLAUDE.md`           | Product spec — что строим, UX, промпты для ассистента  |
| `ARCHITECTURE.md` *(этот файл)* | Как устроен код, ключевые файлы, инварианты |
| `docs/SMOKE.md`       | Пост-деплой checklist                                  |
| `docs/RELEASE.md`     | Convention версий + история тегов (v1.0.0, ...)        |
| `docs/migration/PHASE*.md` | История фаз (Phase 5, Phase 6, ...)               |
| `docs/migration/ISSUES.md` | Открытые вопросы / решения                        |
| `JARVIS_SPEC.md`      | Целевое видение JARVIS (vision, может расходиться с impl) |
| `COMPETITIVE_ANALYSIS.md` | Конкуренты                                         |
| `LIFEOS-STATUS.md`    | Snapshot статус (устаревший от 2026-04-15, на ревизию) |

**Цепочка для нового агента после compact**: `AGENTS.md` (50 строк) → `docs/RELEASE.md` (что сейчас в проде) → `ARCHITECTURE.md` (этот файл) → `docs/SMOKE.md`. Этого хватит для старта. Полный `CLAUDE.md` — только за деталями продуктовой спеки.

> **Удалены 2026-05-24** как устаревшие audit-снимки (всё P0 закрыто, see git history):
> `AUDIT-ARCHITECTURE.md`, `AUDIT-CODE-REVIEW.md`, `AUDIT-FRONTEND.md`,
> `AUDIT-SECURITY.md`, `AUDIT-SUMMARY.md`.

---

## 1. Высокоуровневая архитектура

LifeOS — монорепозиторий из двух независимых приложений, общающихся по HTTPS/JWT.

```
┌────────────────────────────┐     HTTPS (JSON + JWT)   ┌─────────────────────────────┐
│ apps/mobile                │ ──────────────────────► │ packages/server             │
│ React Native + Expo SDK 54 │                         │ Fastify + Prisma + Postgres │
│                            │ ◄────────────────────── │                             │
│ — Expo Router (file-based) │     4xx/5xx + code      │ — 42 REST routes            │
│ — Zustand stores (20)      │                         │ — handleMessage = ЕДИНЫЙ    │
│ — MMKV offline cache       │                         │   МОЗГ (text/voice/bot)     │
│ — Voice (Whisper+TTS)      │                         │ — SSOT tool registry (23)   │
│ — Sentry (crash reporting) │                         │ — Two-tier safety gate      │
└────────────────────────────┘                         └──────────────┬──────────────┘
                                                                      │
                                       ┌──────────────────────────────┴────────────┐
                                       ▼                                            ▼
                                  PostgreSQL                                 External APIs
                                  (Railway, 42 models)                       • Anthropic Claude
                                                                             • Groq Whisper
                                                                             • Telegram Bot API
                                                                             • Google Calendar
                                                                             • OpenWeather / FX
                                                                             • Sentry (errors)
```

**Архитектурные принципы:**

1. **ЕДИНЫЙ МОЗГ** — все каналы (Telegram bot, mobile chat, voice, web cabinet когда появится) идут через ОДИН orchestrator: `services/jarvis-orchestrator.ts → handleMessage(userId, text, channel)`. Запрещено иметь параллельные «брейны» — структурные тесты ловят drift.
2. **SSOT Tool Registry** — `src/tools/index.ts` единственный источник истины для инструментов агента. Каждый tool описан один раз (schema + handler + needsConfirm + опц. `requires`), агент-loop берёт из реестра. **Phase 7 tool-filter** (Relayna pattern): `agentToolSchemasForUser(userId)` фильтрует tools с `requires` против активных user-integrations — закрывает класс hollow-tools (tool не падает у юзера без подключённой интеграции, он просто скрыт от агента). См. AGENTS.md §12.
3. **Two-tier safety gate** — Tier 1 (phrase-match, instant, 0 latency) в самом верху `handleMessage`; Tier 2 (Haiku-классификация) только на эмоциональных сообщениях, расширяет recall не-явных формулировок.
4. **Offline-first mobile** — Zustand + MMKV кэшируют локально, синхронизация при появлении сети.
5. **Stateless сервер** — сессия в JWT, БД — единственный source of truth.
6. **Деньги/external → needsConfirm:true** — agent-loop автоматически исключает такие tools, требуется явный user confirm через pending-action flow.
7. **Централизованные ошибки** — `AppError` + `registerErrorHandler`; никаких ручных `try/catch + reply.status(500)` в роутах.
8. **Безопасность по умолчанию** — JWT_SECRET ≥32 символов (hard exit при нарушении), CORS whitelist, 256KB bodyLimit, rate-limit 120/min, AES-256-GCM для PII.

---

## 2. Структура монорепо

```
LifeOS/
├── AGENTS.md                  ← договор с агентом
├── CLAUDE.md                  ← product spec
├── ARCHITECTURE.md            ← этот файл
├── JARVIS_SPEC.md             ← vision (расходится с impl)
├── COMPETITIVE_ANALYSIS.md    ← конкуренты
├── LIFEOS-STATUS.md           ← snapshot (устарел)
├── package.json               ← npm workspaces: apps/*, packages/*
├── tsconfig.base.json
│
├── docs/
│   ├── SMOKE.md               ← пост-деплой checklist
│   ├── RELEASE.md             ← convention версий + история тегов
│   ├── plan/                  ← per-feature plan.md (convention, см. AGENTS.md §1)
│   └── migration/             ← Phase 5, Phase 6, ISSUES.md, VISION docs
│
├── apps/
│   └── mobile/                ← React Native + Expo SDK 54 (RN 0.81.5)
│       ├── App.tsx            ← root + Sentry.wrap
│       ├── app.json           ← Expo config + plugins (11 native)
│       ├── eas.json           ← build profiles: dev / preview / production
│       ├── app/               ← Expo Router (file-based)
│       │   ├── (tabs)/        ← главные табы: index, tasks, habits, goals, finance, chat
│       │   ├── (auth)/        ← login, register
│       │   ├── voice-conversation.tsx  ← VAD-диалог (новый contract /voice/conversation/*)
│       │   ├── pet.tsx, arena.tsx, battle-screen.tsx, character-select.tsx
│       │   ├── achievements.tsx, focus-mode.tsx, life-insights.tsx
│       │   ├── kanban-board.tsx, gantt-view.tsx, exercise-tracker.tsx
│       │   ├── nutrition.tsx, schedule-import.tsx, shared-spaces.tsx
│       │   ├── subscription.tsx, tag-manager.tsx, task-capture.tsx
│       │   ├── swipe-home.tsx, journal/index.tsx
│       │   ├── settings/index.tsx, settings/integrations.tsx
│       │   ├── activity/index.tsx, import/index.tsx, export.tsx, onboarding.tsx
│       │   └── legal.tsx
│       │
│       ├── components/        ← ui (Button/Input/Card/Modal/Checkbox/ProgressRing),
│       │                       charts, voice (VoiceButton/VoiceModal/VoiceAssistant),
│       │                       characters, shared (включая error-boundary с Sentry)
│       ├── hooks/             ← 12 hooks:
│       │   ├── use-voice.ts                ← LEGACY /voice/process (используется 6 экранами)
│       │   ├── use-voice-conversation.ts   ← NEW /voice/conversation/* (1 экран)
│       │   ├── use-wake-word.ts            ← wake-word detection
│       │   ├── use-dictation.ts            ← диктовка
│       │   ├── use-morning-greeting.ts     ← утренний брифинг
│       │   ├── use-health-sync.ts, use-calendar-sync.ts, use-steps.ts
│       │   ├── use-location.ts, use-notifications.ts, use-refresh.ts, use-colors.ts
│       │
│       ├── stores/            ← 20 Zustand stores (по одному на модуль)
│       ├── services/          ← 19 services: api (с retry+refresh), crash-reporting (Sentry),
│       │                       notifications, voice-alarm, health-sync, calendar-sync,
│       │                       contacts-sync, deep-links, export, haptics, offline-manager,
│       │                       storage, store-persist, vad, version-check, alarm-notifications,
│       │                       wake-up-notification, background-steps
│       ├── constants/         ← colors, taskCategories, priorities, goalAreas
│       └── utils/             ← dates, format, quotes (600+ мотивац.)
│
└── packages/
    └── server/                ← Fastify + Prisma backend, deployed on Railway
        ├── Dockerfile         ← prod build
        ├── railway.toml       ← healthcheck /health, timeout 120s
        ├── prisma/
        │   ├── schema.prisma  ← 42 моделей (User, Task, Habit, Pet, Achievement,
        │   │                    ChatMessage с crisis:boolean, Insight, UserProfile,
        │   │                    Memory, ToolCall audit, Goal hierarchy, ...)
        │   └── migrations/    ← never modify existing, always new (AGENTS.md §3)
        ├── src/
        │   ├── index.ts       ← Fastify bootstrap, plugins, route registration
        │   │
        │   ├── routes/        ← 42 файла (REST endpoints, один файл = один домен)
        │   │   ├── auth.ts, tasks.ts, habits.ts, goals.ts, finance.ts, journal.ts, steps.ts
        │   │   ├── voice.ts                ← /voice/process (legacy, ВСЁ через handleMessage)
        │   │   ├── conversation.ts         ← /voice/conversation/{message,text,end} (new)
        │   │   ├── chat.ts                 ← /voice/chat встроенный AI-чат
        │   │   ├── vision.ts               ← Claude Vision (food, schedule, exercise)
        │   │   ├── pet.ts, arena.ts, challenge.ts, achievements.ts
        │   │   ├── insights.ts             ← Phase 5: feed insights
        │   │   ├── briefing.ts             ← утренние/вечерние брифинги
        │   │   ├── prioritization.ts, quick-add.ts
        │   │   ├── events.ts, import.ts, calendar-sync.ts, integrations.ts
        │   │   ├── contacts.ts, documents.ts, tags.ts, dependencies.ts, shared-spaces.ts
        │   │   ├── notifications.ts, life-analysis.ts, export.ts, subscription.ts
        │   │   ├── travel.ts, dictation.ts, app-info.ts, audit.ts, admin.ts
        │   │   └── *.test.ts (conversation-safety, voice-safety, import, dependencies,
        │   │                  documents, export — structural tests, refactor-proof)
        │   │
        │   ├── services/      ← 38 файлов — бизнес-логика
        │   │   ├── jarvis-orchestrator.ts  ← ⭐ ЕДИНЫЙ МОЗГ handleMessage(userId, text, channel)
        │   │   ├── claude-agent.ts         ← Anthropic SDK agent loop (tool_use → result → ...)
        │   │   │
        │   │   ├── safety-classifier.ts    ← Tier 1 phrase + Tier 2 Haiku-расширение
        │   │   ├── safety-response.ts      ← buildSafetyResponse(isRepeat) — style-agnostic
        │   │   ├── emotional-classifier.ts ← therapeutic-mode trigger
        │   │   │
        │   │   ├── reflector-core.ts       ← Phase 5: детерминированный reflect(facts)
        │   │   ├── reflector-service.ts    ← Sonnet phrasing + runReflectorDaily
        │   │   ├── insight-core.ts         ← selectInsights, pickForPush, joinFeed, ...
        │   │   ├── insight-store.ts        ← persistCandidates, deliverTopInsight
        │   │   ├── plan-vs-fact.ts         ← planVsFact, yearElapsedPct
        │   │   │
        │   │   ├── planner-service.ts      ← Phase 5: planner mode
        │   │   ├── profile-core.ts         ← Phase 6 C2: derived view над Memory
        │   │   ├── profile-synthesizer.ts  ← Sonnet 1×/week
        │   │   ├── therapeutic-detector-service.ts ← Phase 6 C4: 5 detectors
        │   │   ├── therapeutic-detectors.ts
        │   │   │
        │   │   ├── pending-actions.ts      ← needsConfirm flow (money/external)
        │   │   ├── proactive-scheduler.ts  ← cron fan-out: pet-streak, crisis-purge,
        │   │   │                            reflector, profile-synthesis, therapeutic
        │   │   ├── proactive-notifications.ts ← morning_briefing, event-reminders (tz-aware)
        │   │   ├── proactive-insights.ts
        │   │   │
        │   │   ├── telegram-bot.ts         ← Telegraf, отправляет в handleMessage
        │   │   ├── conversation-greeting.ts ← первый /start
        │   │   ├── pet-streak-service.ts   ← runPetStreakSweep
        │   │   ├── streak-service.ts       ← один findMany + reduce (НЕ N+1)
        │   │   ├── push-service.ts, memory-service.ts, life-truth-analyzer.ts
        │   │   ├── smart-booking.ts, embeddings.ts
        │   │   ├── gmail.ts, google-calendar.ts, external-apis.ts (weather/FX/news)
        │   │   ├── integration-registry.ts, interest-service.ts, items-catalog.ts
        │   │   ├── assistant-service.ts, dictation-service.ts
        │   │   └── tool-audit.ts, token-cleanup.ts
        │   │
        │   ├── tools/         ← ⭐ SSOT TOOL REGISTRY (23 tools — Phase 9A.8/9B.2 + Phase 7 tool-filter)
        │   │   ├── _types.ts               ← Tool, defineTool, IntegrationRequirement (Phase 7)
        │   │   ├── index.ts                ← registry: Map, defineTool, runRegistryTool,
        │   │   │                              agentToolSchemas (auto-filter needsConfirm),
        │   │   │                              confirmAlwaysNames
        │   │   ├── READ (12):              get-today, get-weather, get-budget, get-free-slots,
        │   │   │                            get-tasks, get-calendar, get-email-triage,
        │   │   │                            recall-person, get-weekly-plan, get-trip,
        │   │   │                            get-goal-progress, get-user-profile
        │   │   ├── WRITE (8, needsConfirm:false): create-task, complete-task,
        │   │   │                            complete-habit, complete-multiple-habits,
        │   │   │                            create-event, journal-entry, apply-insight,
        │   │   │                            decompose-goal
        │   │   ├── CONFIRM (3, needsConfirm:true): add-expense, add-income, send-telegram
        │   │   ├── _types.ts, _finance.ts, _slots.ts (shared internals)
        │   │   └── *.test.ts (registry-consistency, dispatch-audit, slots, tz-correctness,
        │   │                  money-safety, write-tools, agent-read-tools, schema-anthropic-compat)
        │   │
        │   ├── middleware/    ← auth (JWT), security (headers + rateLimit),
        │   │                     error-handler (registerErrorHandler), validate (Zod)
        │   │
        │   ├── lib/           ← инфраструктура (без бизнес-знаний)
        │   │   ├── errors.ts              ← AppError + классы + normalizeError + sanitizeForLog
        │   │   ├── logger.ts              ← pino + sanitize hook
        │   │   ├── async-handler.ts       ← requireUserId, tryAsync
        │   │   ├── prisma.ts              ← Prisma singleton
        │   │   ├── crypto.ts              ← AES-256-GCM (PII at rest)
        │   │   ├── cyrillic-regex.ts      ← cyrillicWord helper + containsAny
        │   │   │                            (НИКОГДА \b с кириллицей — ASCII-only!)
        │   │   ├── tz.ts                  ← localDayStartUTC, localHour, timeToDate(time, tz)
        │   │   │                            tz REQUIRED через TS-types (нельзя забыть)
        │   │   ├── env-check.ts           ← startup checks (JWT_SECRET ≥32, ...)
        │   │   └── *.test.ts (no-bare-b-cyrillic structural lint, errors, ...)
        │   │
        │   ├── data/          ← статические данные
        │   │   └── crisis-resources.ts    ← KZ hotlines 150/111/1303/112 + disclaimer
        │   │
        │   ├── db/            ← (placeholder)
        │   │
        │   └── types/         ← общие TypeScript-типы
        │
        ├── package.json
        └── tsconfig.json
```

---

## 3. Поток запроса (server)

### Bot / mobile chat / voice — все через единый мозг

```
HTTP request (/voice/conversation/message | /voice/process | TG webhook)
    │
    ▼
onRequest: globalApiLimiter (120/min per IP, in-memory LRU)
    │
    ▼
onRequest: securityHeaders (HSTS, X-Frame, CSP)
    │
    ▼
preHandler: authMiddleware → verify JWT → request.userId
    │
    ▼
Route handler (voice.ts / conversation.ts / telegram-bot.ts)
    │  STT (если voice): Whisper API
    │  Берёт `text`, `userId`
    │
    ▼
jarvis-orchestrator.handleMessage(userId, text, channel)
    │
    ├─ [Tier 1 SAFETY] matchesCrisisPhrase(text)?  ← phrase-net, 0 latency, top of function
    │      └─ если YES → buildSafetyResponse + saveTurn(crisis:true) + return safety_crisis
    │
    ├─ Если есть pending action → confirm/cancel flow
    │
    ├─ classifyEmotional(text) → therapeuticMode (if User.therapeuticMode=true)
    │
    ├─ [Tier 2 SAFETY] if (therapeuticMode) → classifyCrisis(text) (phrase OR Haiku)
    │      └─ если YES → buildSafetyResponse + saveTurn(crisis:true) + return safety_crisis
    │
    ├─ buildContext(userId) + buildSystemPrompt(style, therapeuticMode)
    │
    └─ claudeAgent.run({system, messages, tools=agentToolSchemas})
            │
            └─ tool_use loop:
                   runRegistryTool(toolName, input) → result → ...
                   (max rounds; если loop ends with tool_use без text → 1 extra call без tools)
            │
            └─ возвращает {reply, intent}
    │
    ▼
saveTurn(userId, text, reply, crisis=false) → ChatMessage rows
    │
    ▼
JSON response: { reply, response: reply (alias), intent, ... }
```

### Error path

```
AppError или любой throw
    │
    ▼
app.setErrorHandler:
    │  normalizeError() ← Prisma P2002/P2025/P10xx, Anthropic APIError, AbortError → AppError
    │  sanitizeForLog() ← redact password/token/Bearer/sk-*/JWT
    │  log (5xx → error, 4xx → warn)
    │  toErrorResponse() ← { ok:false, error, message, code, requestId, details }
    ▼
Клиент видит структурированную ошибку
```

---

## 4. Обработка ошибок — полная карта

### Классы ошибок (`lib/errors.ts`)
| Класс              | Code                       | Status | Когда                                     |
|--------------------|----------------------------|--------|-------------------------------------------|
| ValidationError    | VALIDATION_FAILED          | 400    | Zod или ручная валидация                  |
| AuthError          | AUTH_REQUIRED / FORBIDDEN  | 401/403| Нет токена / нет прав                     |
| NotFoundError      | NOT_FOUND                  | 404    | Запись не существует                      |
| ConflictError      | CONFLICT                   | 409    | Дубль / уникальность                      |
| RateLimitError     | RATE_LIMITED               | 429    | Лимит                                     |
| ExternalApiError   | EXTERNAL_API_FAILED/TIMEOUT| 502/504| Внешний API                               |
| AiModelError       | AI_MODEL_FAILED            | 503    | Claude/Whisper отказал                    |
| DatabaseError      | DATABASE_ERROR             | 500    | Prisma P10xx                              |
| AppError           | INTERNAL_ERROR             | 500    | Непредвиденное                            |

### Sanitizer — что скрывается
Ключи (регексы): `password`, `token`, `secret`, `api_key|apiKey`, `authorization`, `cookie`, `session`, `credit_card`, `ssn`, `cvv`.
Значения: `Bearer <...>`, `sk-[A-Za-z0-9]{20,}`, JWT `eyJ...`.
Truncate: строки >500 → 500; массивы >20 → 20; depth >6 → cut.

---

## 5. Единый мозг — `jarvis-orchestrator.handleMessage`

**Файл**: `packages/server/src/services/jarvis-orchestrator.ts`

`handleMessage(userId, text, channel?)` — единственная точка входа для текстового запроса юзера, **независимо от канала** (mobile chat, voice, Telegram bot, future web). Все 4 voice-endpoint'а (`/voice/process`, `/voice/conversation/{message,text,end}`) идут через него — гарантировано structural тестами (`conversation-safety.test.ts`, `voice-safety.test.ts`).

**Pipeline** (схематично):
1. **Tier 1 safety**: `matchesCrisisPhrase(text)` — детерминированный phrase-net (19+ паттернов ru + базовый kk), 0 latency. При match → `buildSafetyResponse` + persist crisis row + return `safety_crisis`.
2. **Pending action**: если у юзера висит `PendingAction` (нужен confirm/cancel для money/external) — обработать.
3. **Emotional classification**: `classifyEmotional(text)` → `therapeuticMode` (bool).
4. **Tier 2 safety** (только если therapeuticMode): `classifyCrisis(text)` — phrase OR Haiku (`@anthropic-ai/sdk`, model `claude-haiku-4-20250514`). Расширяет recall на не-явные формулировки.
5. **Build context + system prompt** — учёт стиля (`friendly/strict/calm/toxic`), therapeutic-mode prompt block, opt-out флаг.
6. **Agent loop** — `claude-agent.ts` → `client.messages.create({tools: agentToolSchemas})`. SSOT registry автоматически фильтрует `needsConfirm:true` tools (нельзя автоматом тратить деньги). При `stop_reason='tool_use'` без text — extra call без tools для финального текста (закрывает Aydana-баг, см. v1.0.0).
7. **Persist** — `saveTurn(userId, text, reply, crisis=false)` → две `ChatMessage` строки (user + assistant), оба с `crisis` boolean.

### SSOT Tool Registry (`src/tools/index.ts`)
- `registry: ReadonlyMap<string, ToolDefinition>` — все 23 tools
- `defineTool({name, schema, needsConfirm, handler})` — DSL для добавления
- `agentToolSchemas` — для Claude API, **автоматически** исключает `needsConfirm:true`
- `confirmAlwaysNames()` — список confirm-tools (источник истины)
- `runRegistryTool(name, input, ctx)` — централизованный dispatch + audit log

**3 категории**: READ (12) — без побочных эффектов. WRITE (8) — мутируют БД, но обратимы (`needsConfirm:false`). CONFIRM (3) — `addExpense`, `addIncome`, `sendTelegram` — деньги/внешнее, требуют explicit user confirm.

### Mobile JARVIS (`hooks/use-voice-conversation.ts`)
State machine с VAD для continuous-listening режима:
- "Режим общения" → активирует continuous → VAD ловит конец фразы → Whisper → `/voice/conversation/message` → TTS → авто-рестарт.
- Стоп-фразы: «стоп», «хватит», «выключись» → выход.
- Idle timeouts разные в `once` vs `continuous`.

### Mobile legacy (`hooks/use-voice.ts`)
6 экранов (chat, главный, tasks, habits, swipe-home, morning-greeting) — всё ещё на `/voice/process`. **Не блокер**: на бэкенде P0-fix роутит `/voice/process` через `handleMessage` (с тем же safety-gate). Migration на `use-voice-conversation` запланирована на v1.2.0.

---

## 6. Тесты

- **Total**: 773/773 проходят (на момент v1.0.0).
- **Hard invariants** (≥15): structural source-parse тесты, refactor-proof:
  - `lib/no-bare-b-cyrillic.test.ts` — лит на `\b` рядом с кириллицей (ASCII-only, не работает)
  - `tools/registry-consistency.test.ts` — все tools в registry имеют валидную schema
  - `tools/money-safety.test.ts` — все money-tools имеют `needsConfirm:true`
  - `tools/dispatch-audit.test.ts` — runRegistryTool пишет audit row
  - `tools/tz-correctness.test.ts` — все tz-операции имеют explicit tz
  - `routes/conversation-safety.test.ts` — voice routes идут через handleMessage
  - `routes/voice-safety.test.ts` — voice safety-gate структурно работает
  - `services/safety-two-tier.test.ts` — Tier 1 + Tier 2 wiring
  - `phase5-schema.test.ts`, `phase6-schema.test.ts` — schema invariants
  - `proactive-notifications-tz.test.ts` — tz-correctness в push
  - `lib/errors.test.ts` — 28 unit-тестов
- **Run**: `cd packages/server && npm test`

---

## 7. Критические инварианты (НЕ нарушать)

| # | Правило | Где enforce'ится |
|---|---|---|
| 1 | JWT_SECRET ≥32 символов | startup check, `process.exit(1)` если меньше |
| 2 | CORS whitelist (не `origin: true`) | `middleware/security.ts` |
| 3 | bodyLimit 256KB default, per-route override только где нужно | Fastify config |
| 4 | Rate limit: 120/min global, 3-30/min auth, special для vision/voice/chat/import | `middleware/security.ts` |
| 5 | Никогда не удалять функционал юзера | user rule (CLAUDE.md) |
| 6 | Темы оформления НЕ добавлять | user rule |
| 7 | UI / тексты / ошибки — на русском | user rule |
| 8 | Offline-first на mobile (MMKV + retry queue) | `services/offline-manager.ts` |
| 9 | `fetchWithTimeout` для всех внешних fetch (AbortController + 8s default) | `lib/external-apis.ts`, mobile `services/api.ts` |
| 10 | LRU cache в orchestrator — MAX 500, TTL 30s, sweep 60s `.unref()` | conversation cache |
| 11 | **LLM-output → structured tool-use или strict JSON, НИКОГДА regex по prose** (AGENTS.md §5) | code review, structural lint |
| 12 | **Two-tier safety gate** — Tier 1 в самом верху handleMessage, Tier 2 на emotional | `safety-two-tier.test.ts` |
| 13 | **Money/external → `needsConfirm:true`** — agent-loop auto-excludes | `money-safety.test.ts` |
| 14 | **Schema additive-only** (Railway: `db push` без `--accept-data-loss` блокирует destructive) | deploy-time enforce |
| 15 | **Никаких `\b` рядом с кириллицей** — `\b` ASCII-only, не работает с RU/KK; используй `lib/cyrillic-regex.ts` | `no-bare-b-cyrillic.test.ts` |
| 16 | **tz REQUIRED** в `timeToDate(time, tz)` — TS-types не позволяют забыть | `lib/tz.ts` signature |
| 17 | **handleMessage = единственный мозг** — все voice/text/bot через него | `conversation-safety.test.ts`, `voice-safety.test.ts` |
| 18 | **`crisis:true` rows изолированы** — `getRecentHistory` фильтрует `crisis:false`, scheduler purge 30d | `crisis-isolation.test.ts`, `profile-crisis-isolation.test.ts` |

---

## 8. Как добавить новый роут

1. `src/routes/<domain>.ts` с `export const <domain>Routes: FastifyPluginAsync = async (app) => { ... }`.
2. Zod-схема через `validate(schema)`. Для auth-роутов — `preHandler: [app.authenticate]`, читай `request.userId`.
3. Не делай `try/catch`. Бросай `AppError` или дай ошибке всплыть.
4. Регистрируй в `src/index.ts`: `await app.register(<domain>Routes)`.
5. Если мутирует — `invalidateContextCache(userId)` после успеха.
6. Тесты рядом: `<domain>.test.ts`. **Если затрагивает: voice, safety, money, mobile API contract — обязательно structural тест.**

### Как добавить новый tool

1. `src/tools/<tool-name>.ts` с `defineTool({name, schema, needsConfirm, handler})`.
2. Импортировать в `src/tools/index.ts` registry Map.
3. Если money/external → **`needsConfirm: true` обязательно**, иначе agent-loop сможет тратить деньги юзера без подтверждения.
4. Покрыть тестом (тест на dispatch + если money, money-safety).

---

## 9. Deploy

### Backend (Railway)
- **Repo**: `berik5394-beep/lifeos`, branch `main`, auto-deploy on push
- **Builder**: Dockerfile (`packages/server/Dockerfile`)
- **Healthcheck**: `/health` (HTTP 200, timeout 120s)
- **DB**: Railway Postgres
- **Migrations**: `prisma db push` в pre-deploy (additive-only, см. инвариант #14)
- **Secrets** (Variables): JWT_SECRET, DATABASE_URL, ANTHROPIC_API_KEY, GROQ_API_KEY, TELEGRAM_BOT_TOKEN, CORS_ORIGINS, ...
- **После deploy**: пройти `docs/SMOKE.md` (API-часть всегда, behavioral по ситуации)
- **GREEN smoke → tag**: `git tag -a vX.Y.Z <commit> + push origin vX.Y.Z` (см. `docs/RELEASE.md`)

### Mobile (Expo EAS)
- **Account**: `lifeos1` (Berik), project `@lifeos1/lifeos`
- **Profiles** (`eas.json`): `development` (Expo Go), `preview` (internal APK, prod API), `production` (signed APK)
- **Build**: `npx eas build --profile preview --platform android` → ~15-30 мин в EAS cloud → APK link
- **Distribution**: internal через APK link (Telegram/WhatsApp/email) → юзер ставит на Android
- **iOS**: НЕ собирается (нет Apple Developer Account)
- **OTA Updates** (EAS Update): после первого build — `eas update --branch preview` для JS-only фиксов без нового APK

### Crash reporting
- **Sentry** (`@sentry/react-native ~7.2.0`)
- Wrap в `App.tsx` через `Sentry.wrap(App)`
- DSN через `.env` (`EXPO_PUBLIC_SENTRY_DSN` / `SENTRY_DSN`), source maps upload через `@sentry/wizard` (требует `SENTRY_AUTH_TOKEN`)

---

## 10. Что ещё нужно доделать

### Pre-release (mobile build)
- [ ] Sentry init + crash-reporting.ts swap to Sentry impl
- [ ] EAS Update (OTA) setup перед первым build (иначе каждый fix = новая APK)
- [ ] `docs/plan/mobile-build.md` (применить plan.md convention впервые)
- [ ] EAS preview build → APK → раздача → install smoke
- [ ] v1.1.0 tag после GREEN behavioral SMOKE

### v1.1.x — стабилизация на live-юзерах
- [ ] Tool-filtering по integration availability (фиксит hollow-tools `getEmailTriage` / `getTrip` когда нет интеграции)
- [ ] Migration mobile legacy `use-voice` → `use-voice-conversation` (6 экранов)
- [ ] Telegram bot команда `/bug` для бесшовного фидбэка от юзеров

### Backlog (post-billing)
- [ ] Billing / IAP (отсутствует полностью)
- [ ] WhatsApp канал (после исследования стоимости Business API vs Baileys risk)
- [ ] Web cabinet через `expo export --platform web`
- [ ] Multi-provider LLM абстракция (premature пока)
- [ ] Prisma 6.19.3 → 7.8.0 major upgrade
- [ ] CLAUDE.md / LIFEOS-STATUS.md ревизия (устарели на 40-48 дней)
- [ ] release/X.Y branching + QA gate (когда появится команда)

### Backlog (architectural)
- [ ] E2E тест критичного флоу (регистрация → задача → голосовое отмечание → completion)
- [ ] Transactional outbox для интеграций (сейчас возможна потеря событий при ретраях)
- [ ] Расширить тесты на `proactive-scheduler`, `pet-engine` edge cases
