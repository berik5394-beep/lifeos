# LifeOS — Архитектура и структура проекта

> Документ-источник правды для разработчиков. Обновляется при любых структурных изменениях.
> Дата последнего обновления: 2026-04-15.

---

## 1. Высокоуровневая архитектура

LifeOS — монорепозиторий из двух независимых приложений, общающихся по HTTPS/JWT.

```
┌────────────────────────────┐          HTTPS (JSON + JWT)          ┌─────────────────────────────┐
│   apps/mobile              │ ───────────────────────────────────► │   packages/server           │
│   React Native + Expo      │                                      │   Fastify + Prisma          │
│                            │ ◄─────────────────────────────────── │                             │
│   ─ UI (expo-router)       │         401 / 403 / 5xx                │   ─ REST routes            │
│   ─ Zustand stores         │         with typed code               │   ─ AI engines (Claude)    │
│   ─ MMKV offline cache     │                                      │   ─ Prisma ORM              │
│   ─ Voice (Whisper+TTS)    │                                      │   ─ Rate limiter / security │
└────────────────────────────┘                                      └──────────────┬──────────────┘
                                                                                   │
                                                   ┌───────────────────────────────┴────────┐
                                                   │                                        │
                                                   ▼                                        ▼
                                          PostgreSQL (Railway)                 External APIs
                                          (Prisma schema)                       ─ Anthropic Claude
                                                                                ─ Groq Whisper
                                                                                ─ Telegram Bot
                                                                                ─ Google Calendar
                                                                                ─ OpenWeather / FX
```

**Ключевые принципы:**
- **Offline-first мобильное приложение** — Zustand + MMKV кэшируют всё локально, синхронизация при появлении сети.
- **Stateless сервер** — вся сессия хранится в JWT, БД — единственный источник правды.
- **AI как first-class citizen** — Claude tool-use loop (`conversation-engine.ts`) — центральный мозг для любых голосовых/чат-действий.
- **Безопасность по умолчанию** — JWT_SECRET ≥32 символов, whitelist CORS, 256KB bodyLimit, глобальный rate-limit 120/min, per-route лимиты для auth.
- **Централизованные ошибки** — ни один роут не формирует ошибки вручную, всё через `AppError` → `registerErrorHandler`.

---

## 2. Структура монорепо

```
LifeOS/
├── CLAUDE.md                          ← главный спек (продукт, функционал, промпты)
├── ARCHITECTURE.md                    ← этот файл (архитектура, структура, как работает код)
├── package.json                       ← root, workspaces: apps/*, packages/*
├── tsconfig.base.json
│
├── apps/
│   └── mobile/                        ← React Native + Expo app
│       ├── app/                       ← expo-router pages (file-based routing)
│       │   ├── (tabs)/                ← таб-бар: index, tasks, habits, goals, finance
│       │   ├── activity/              ← шагомер, GPS-треки
│       │   ├── journal/               ← дневник самочувствия
│       │   ├── import/                ← импорт xlsx/csv/ics/pdf
│       │   ├── settings/              ← настройки, стиль ассистента, интеграции
│       │   ├── voice-conversation.tsx ← экран JARVIS-диалога (голос с VAD)
│       │   └── chat.tsx               ← встроенный AI-чат
│       ├── components/
│       │   ├── ui/                    ← Button, Input, Card, Checkbox, ProgressRing
│       │   ├── charts/                ← victory-native диаграммы
│       │   ├── voice/                 ← VoiceButton, VoiceModal, VoiceAssistant
│       │   ├── pet/                   ← тамагочи-питомец (Lottie)
│       │   └── shared/
│       ├── hooks/
│       │   ├── use-voice-conversation.ts  ← state machine голосового диалога
│       │   ├── use-steps.ts           ← expo-sensors педометр
│       │   ├── use-notifications.ts   ← expo-notifications + scheduling
│       │   └── use-file-import.ts     ← expo-document-picker
│       ├── stores/                    ← Zustand: useTaskStore, useHabitStore, usePetStore, ...
│       ├── services/                  ← api.ts (fetch wrapper), voice.ts, notifications.ts
│       ├── utils/                     ← dates, format, quotes (600+ мотивационных цитат)
│       ├── constants/                 ← colors, taskCategories, priorities, goalAreas
│       └── types/                     ← общие TypeScript-типы
│
└── packages/
    └── server/                        ← Fastify + Prisma backend
        ├── prisma/
        │   ├── schema.prisma          ← все модели (User, Task, Habit, Pet, Achievement...)
        │   └── migrations/
        ├── src/
        │   ├── index.ts               ← точка входа: Fastify + плагины + регистрация роутов
        │   │
        │   ├── routes/                ← REST endpoints — один файл на домен
        │   │   ├── auth.ts            ← /auth/register, /auth/login, /auth/refresh
        │   │   ├── tasks.ts           ← /tasks CRUD + /complete
        │   │   ├── habits.ts          ← /habits + /habits/:id/log + /habits/stats/:month
        │   │   ├── goals.ts           ← /goals/weekly, /goals/yearly
        │   │   ├── finance.ts         ← /finance/expenses, /finance/incomes, /finance/budget
        │   │   ├── journal.ts         ← /journal/:date
        │   │   ├── steps.ts           ← /steps
        │   │   ├── voice.ts           ← /voice/process, /voice/assistant (старый pipeline)
        │   │   ├── conversation.ts    ← /conversation/send (новый tool-use engine)
        │   │   ├── chat.ts            ← /voice/chat + /chat/history (встроенный AI-чат)
        │   │   ├── vision.ts          ← /vision/analyze-food, /save-food, /food/today,
        │   │   │                        /food/analysis, /analyze-schedule, /capture-tasks,
        │   │   │                        /verify-exercise, /import-schedule
        │   │   ├── pet.ts             ← /pet + /pet/feed + /pet/play + /pet/revive
        │   │   ├── achievements.ts    ← /achievements + /achievements/claim/:id
        │   │   ├── arena.ts           ← бои с питомцем
        │   │   ├── challenge.ts       ← челленджи (верификация через vision.ts)
        │   │   ├── import.ts          ← /import/file — загрузка xlsx/csv/ics/pdf
        │   │   ├── events.ts          ← /events (CalendarEvent CRUD)
        │   │   ├── integrations.ts    ← /integrations/google-calendar/connect,
        │   │   │                        /telegram/connect, /apple-health
        │   │   ├── export.ts          ← /export/csv/:module, /export/pdf/report, /story
        │   │   ├── contacts.ts        ← адресная книга (входит в контекст AI)
        │   │   ├── calendar-sync.ts   ← двусторонняя синхронизация с Google/Apple
        │   │   ├── travel.ts          ← бронирование и поиск (будущее)
        │   │   ├── documents.ts       ← пользовательские документы
        │   │   ├── tags.ts            ← произвольные теги
        │   │   ├── dependencies.ts    ← связи задач/целей
        │   │   ├── shared-spaces.ts   ← общие пространства для команд/семей
        │   │   ├── quick-add.ts       ← быстрый ввод с AI-парсером
        │   │   ├── prioritization.ts  ← AI-приоритизация задач
        │   │   ├── subscription.ts    ← платёжные статусы
        │   │   ├── briefing.ts        ← утренние/вечерние брифинги
        │   │   ├── notifications.ts   ← управление уведомлениями
        │   │   ├── app-info.ts        ← метаданные клиента
        │   │   └── life-analysis.ts   ← сводная аналитика по всем модулям
        │   │
        │   ├── services/              ← бизнес-логика, переиспользуется между роутами
        │   │   ├── conversation-engine.ts  ← ⭐ Claude tool-use loop (38 инструментов)
        │   │   ├── action-executor.ts      ← маппинг namespace-действий в Prisma вызовы
        │   │   ├── external-apis.ts        ← weather, FX, news, Telegram + fetchWithTimeout
        │   │   ├── telegram-bot.ts         ← Telegraf, отправляет команды в action-executor
        │   │   ├── voice-pipeline.ts       ← Whisper STT → Claude NLU → tool dispatch
        │   │   ├── assistant-personality.ts← выбор стиля (friendly/strict/calm/toxic)
        │   │   ├── intent-parser.ts        ← парсинг голосовых команд в JSON
        │   │   ├── vision-service.ts       ← обёртка Claude Vision
        │   │   ├── pet-engine.ts           ← расчёт здоровья, XP, левел-ап, смерть/воскрешение
        │   │   ├── achievements-engine.ts  ← разблокировка бейджей/костюмов/тем
        │   │   ├── notifications-scheduler.ts ← push + расписания
        │   │   ├── calendar-sync-service.ts ← Google/Apple OAuth → CalendarEvent
        │   │   └── briefing-generator.ts   ← утро/вечер с AI-комментарием
        │   │
        │   ├── middleware/
        │   │   ├── auth.ts            ← JWT verify → request.userId
        │   │   ├── security.ts        ← registerSecurityHeaders + rateLimiter
        │   │   ├── error-handler.ts   ← ⭐ registerErrorHandler (Zod + Prisma + 404)
        │   │   └── validate.ts        ← Zod → ValidationError
        │   │
        │   ├── lib/                   ← инфраструктурный слой, без бизнес-знаний
        │   │   ├── errors.ts          ← ⭐ AppError + ErrorCode + sanitizeForLog + normalizeError
        │   │   ├── logger.ts          ← attachLogger(pino), скрывает секреты и stack в проде
        │   │   ├── async-handler.ts   ← requireUserId + tryAsync<T> ([val, null]|[null, err])
        │   │   └── errors.test.ts     ← 28 юнит-тестов (Vitest)
        │   │
        │   └── ai/                    ← промпты и конфиги моделей
        │       ├── system-prompts.ts  ← JARVIS-личность, стили общения
        │       └── tool-definitions.ts← описание инструментов для Claude tool-use
        │
        ├── package.json               ← scripts: dev/build/start/test
        └── tsconfig.json
```

---

## 3. Поток запроса (server)

```
HTTP request
    │
    ▼
onRequest: globalApiLimiter (120/min per IP, Redis-free in-memory LRU)
    │
    ▼
onRequest: securityHeaders (HSTS, X-Frame-Options, CSP)
    │
    ▼
preHandler: authMiddleware → verify JWT → request.userId
    │
    ▼
preHandler: validate(ZodSchema) → ValidationError на невалидные данные
    │
    ▼
Route handler
    │  ├── Throw AppError напрямую (preferred)
    │  └── Throw любую Error (нормализуется автоматически)
    ▼
app.setErrorHandler (registerErrorHandler):
    │  ├── normalizeError()      ← Prisma/Anthropic/Abort → AppError
    │  ├── sanitizeForLog()      ← redact password/token/JWT
    │  ├── log (5xx → error, 4xx → warn)
    │  └── toErrorResponse()     ← { ok:false, error, message, code, requestId, details? }
    ▼
JSON response
```

### Почему централизованный error handler важен
- **Нет дубликатов `try/catch + reply.status(500)`** в 30+ роутах.
- **Секреты не утекают в логи** (sanitizeForLog вычищает `Bearer`, `sk-*`, JWT, поля password/token/secret/cookie).
- **Стабильный клиентский таксономия** — мобилка switch-ит по `code`, а не парсит строки.
- **Бэкомпат** — старые клиенты продолжают читать `error` и `message` (flat fields).

---

## 4. Обработка ошибок — полная карта

### Слои
1. **`lib/errors.ts`** — типы, нормализация, сериализация
2. **`middleware/error-handler.ts`** — Fastify plugin, setErrorHandler + setNotFoundHandler
3. **`lib/logger.ts`** — обёртка над pino с sanitize-хуком
4. **`lib/async-handler.ts`** — хелперы для роутов (`requireUserId`, `tryAsync`)

### Классы ошибок
| Класс                | Код                        | Status | Когда бросать                                 |
|----------------------|----------------------------|--------|-----------------------------------------------|
| `ValidationError`    | VALIDATION_FAILED          | 400    | Zod или ручная валидация провалилась          |
| `AuthError`          | AUTH_REQUIRED / FORBIDDEN  | 401/403| Нет токена / нет прав                         |
| `NotFoundError`      | NOT_FOUND                  | 404    | Запись не существует                          |
| `ConflictError`      | CONFLICT                   | 409    | Дубликат / нарушение уникальности             |
| `RateLimitError`     | RATE_LIMITED               | 429    | Превышен лимит                                |
| `ExternalApiError`   | EXTERNAL_API_FAILED/TIMEOUT| 502/504| Внешний API упал или затаймаутил              |
| `AiModelError`       | AI_MODEL_FAILED            | 503    | Claude/Whisper отказал                        |
| `DatabaseError`      | DATABASE_ERROR             | 500    | Prisma P10xx, транзакция упала                |
| `AppError` (base)    | INTERNAL_ERROR             | 500    | Непредвиденное                                |

### Автоматические маппинги в `normalizeError()`
- `Prisma P2002` → `ConflictError`
- `Prisma P2025` → `NotFoundError('Запись')`
- `Prisma P10xx` → `DatabaseError`
- `Anthropic APIError` → `AiModelError`
- `AbortError` / `err.message.includes('timeout')` → `ExternalApiError(timeout=true)`
- прочее → `AppError(INTERNAL_ERROR)`

### Формат ответа клиенту
```jsonc
{
  "ok": false,
  "error": "validation",          // ← legacy short key (mobile switch)
  "message": "Email обязателен",  // ← legacy user-facing string
  "code": "VALIDATION_FAILED",    // ← new stable taxonomy
  "details": { "field": "email" },
  "requestId": "req-a1b2c3"
}
```

### Sanitizer — что скрывается
**Ключи (регексы):** `password`, `token`, `secret`, `api_key|apiKey`, `authorization`, `cookie`, `session`, `credit_card`, `ssn`, `cvv`.
**Значения:** `Bearer <...>`, `sk-[A-Za-z0-9]{20,}`, JWT `eyJ...`.
Длинные строки (>500 символов) усекаются до 500, массивы — до 20 элементов, вложенность — до 6 уровней.

---

## 5. AI / Conversation Engine

`services/conversation-engine.ts` — сердце приложения. Работает так:

1. `POST /conversation/send { message, mode }` с JWT.
2. `buildInitialContext(userId)` собирает полный срез жизни пользователя:
   - задачи на сегодня, привычки (done/total), события, лимиты бюджета, траты,
   - серию без пропусков, прогресс недели, годовые цели,
   - питание за сегодня и за неделю (`nutritionToday`/`nutritionWeekly`).
3. Контекст кешируется в LRU (`Map` + TTL 30с + max 500 записей + фоновый sweep каждые 60с).
4. `buildSystemPrompt(ctx)` формирует JARVIS-персонажа с учётом стиля (`friendly/strict/calm/toxic`).
5. Claude вызывается с инструментами (38 штук: create_task, complete_habit, analyze_diet, get_finance_advice, ...).
6. Цикл tool_use: Claude → JSON-инструмент → `executeTool()` → результат → Claude → ... → финальный текст.
7. `invalidateContextCache(userId)` после любой мутации.
8. Ответ TTS через expo-speech на мобильном.

### Мобильный JARVIS (continuous mode)
`hooks/use-voice-conversation.ts` — state machine с VAD:
- Кнопка "Режим общения" → активирует continuous listening.
- VAD ловит конец фразы → отправка в Whisper → `/conversation/send` → TTS ответ → авто-рестарт listening.
- Стоп-фразы: "стоп", "хватит", "выключись" → выход из continuous.
- Idle timeouts различаются в `once` и `continuous` режимах.

---

## 6. Тесты

- `packages/server/src/lib/errors.test.ts` — 28 тестов, покрывают:
  - все классы ошибок (status + code + details);
  - `sanitizeForLog` (ключи, значения, truncate, max-depth, примитивы);
  - `normalizeError` (Prisma P2002/P2025/P10xx, APIError, AbortError/timeout, unknown throws);
  - `toErrorResponse` (legacy flat + new code + requestId + sanitized details).

Запуск: `cd packages/server && npm test`.

### План расширения тестов
- `conversation-engine.getCachedContext` — LRU eviction, TTL expiry, sweep unref.
- `security.rateLimiter` — поведение на границах окна.
- `vision.save-food` + `/food/today` — E2E с in-memory Prisma (через pg-mem).
- `pet-engine` — расчёт здоровья/XP/смерти/воскрешения.

---

## 7. Критические инварианты (НЕ нарушать)

1. **JWT_SECRET ≥32 символов** — проверяется на старте, иначе `process.exit(1)`.
2. **CORS whitelist** — не `origin: true`. В dev допустимы localhost/expo URLs.
3. **bodyLimit = 256KB** по умолчанию, per-route override только где реально нужно (`vision.ts` для фото).
4. **Rate limit** — глобально 120/min, auth 3-30/min, vision с отдельным лимитом.
5. **Никогда не удалять функционал** — user rule: "Запрещено что либо удалять, только заменять с сохранением функционала".
6. **Темы оформления НЕ добавлять** — user rule.
7. **Все тексты UI/ошибок — на русском**.
8. **Offline-first на мобильном** — если сеть недоступна, мутация сохраняется в MMKV и отправляется при следующем онлайне.
9. **LRU cache в conversation-engine** — MAX 500 записей, TTL 30с, sweep каждые 60с (через `setInterval().unref()`, не блокирует shutdown).
10. **fetchWithTimeout** — ВСЕ внешние fetch обязаны использовать обёртку с AbortController (timeout 8с по умолчанию).

---

## 8. Как добавить новый роут

1. Создай `src/routes/<domain>.ts` с `export const <domain>Routes: FastifyPluginAsync = async (app) => { ... }`.
2. Импортируй `validate` и опиши Zod-схему для body/params.
3. Для авторизованных роутов — `preHandler: [app.authenticate]` и читай `request.userId`.
4. Не делай свой `try/catch` — бросай `AppError` или дай ошибке всплыть.
5. Валидируй ввод Zod. На кривых данных Zod сам бросит, middleware превратит в `ValidationError`.
6. Регистрируй в `src/index.ts`: `await app.register(<domain>Routes)`.
7. Если роут мутирует — вызови `invalidateContextCache(userId)` после успеха.
8. Если нужны тесты — клади рядом `<domain>.test.ts`.

---

## 9. Deploy

- **Сервер:** Railway (Dockerfile). `railway.toml` задаёт health-check на `/health`.
- **База:** Railway PostgreSQL. Миграции через `npm run db:migrate:deploy` в pre-deploy hook.
- **Секреты:** Railway → Variables. JWT_SECRET, DATABASE_URL, ANTHROPIC_API_KEY, GROQ_API_KEY, TELEGRAM_BOT_TOKEN, CORS_ORIGINS.
- **Мобильное:** Expo EAS Build → TestFlight + Google Play Internal Testing.

---

## 10. Что ещё нужно доделать

- [ ] Мобильные critical issues: API timeout wrapper, auth race condition, startListening guard.
- [ ] Расширить тесты на `conversation-engine`, `pet-engine`, `rateLimiter`.
- [ ] E2E тест одного критичного флоу (регистрация → создание задачи → голосовое отмечание).
- [ ] Мониторинг в проде: Sentry или Railway logs → Loki.
- [ ] Миграция на transactional outbox для интеграций (сейчас потеря событий при ретраях возможна).
