# ОДНА ПАМЯТЬ — M2: Единое чтение (read from v2 only) — Design Spec

**Status:** DRAFT → awaiting Berik review
**Author:** Claude (brainstormed with Berik 2026-06-01)
**Часть инициативы:** ОДНА ПАМЯТЬ (M1 capture ✅ prod → **M2 single-read** → M3 remove-legacy → M4 commitment-reliability).

## 1. Контекст и решение
M1 (захват всего в v2) — в проде, v2 теперь полная (включая кнопки-действия). Сейчас мозг ЧИТАЕТ память из **двух** источников параллельно: legacy `getRelevantMemories` (семантический поиск по плоской Memory) + v2-enrichment (фиксированные секции). M2 переключает **чтение релевантных фактов на v2** и убирает legacy-feed.

**Подтверждено Berik (2026-06-01):**
- Накопленные legacy-факты — **тестовые, выбрасываемые**; миграция прошлых фактов НЕ нужна (ни Berik, ни Aydana).
- **Поведение/личность/стили/терапевт/кризис-safety/инструменты/логика/приложение — НЕ трогаются** (это код промпта/личности, не таблица Memory). M2 меняет ТОЛЬКО источник «релевантных прошлых фактов».
- Решение: **SWAP** (флаг on → читаем ТОЛЬКО v2; off → сегодняшнее legacy). Не additive. M3 (удаление legacy) — сразу следом, безопасным порядком.

## 2. Что читается из legacy сейчас (3 точки)
Все через `getRelevantMemories(userId, text, n)` из `services/memory-service.ts`:
1. **Главный канал промпта:** `gatherAssistantContext` → `ctx.memories` → `ai/jarvis-prompt.ts:183-187` (`slice(0,15)`). Источник: `assistant-service.ts:128` `getRelevantMemories(text, 20)`.
2. Инструмент `tools/recall-person.ts:34` `getRelevantMemories(name, 6)`.
3. Инструмент `tools/get-goal-progress.ts:140` `getRelevantMemories(memQuery, 5)`.

v2-enrichment (`services/v2-enrichment.ts`) даёт ФИКСИРОВАННЫЕ секции (identity/patterns/mood/recent-entities/axes/tone) — НЕ relevance-поиск. Значит legacy `getRelevantMemories(text)` = «вспомнить релевантное к реплике»; v2-recall надо построить.

## 3. Архитектура M2 (SWAP, флаг-гейт)
**Новый флаг `isV2ReadEnabled(userId)`** (env `FEATURE_V2_READ`, форма как у сиблингов: `all`/`none`/`user-X`). Default **off** → байт-в-байт сегодня. Отдельный от `FEATURE_V2_MEMORY` (тот гейтит захват+enrichment, уже `all`) — чтобы чтение включить независимо: собрать втёмную → флипнуть для Berik → SMOKE → all.

### 3.1 Компонент 1 — `getRelevantV2Memories(userId, text, limit)` (новый `services/v2-recall.ts`)
- Переиспользует существующую v2-инфру:
  - **entity-graph** `resolveEntity` (FTS+embedding hybrid — «как legacy getRelevantMemories») → релевантные entities (люди/вещи/места) по `text`.
  - **episodic** query-методы (`services/episodic-memory.ts`) → релевантные/недавние события (факты-действия, включая кнопки из M1).
- Возвращает `{ content: string }[]` — строки, аналогичные legacy-памяти (формат под `jarvis-prompt:187` `- ${m.content}` не меняется).
- **Чистая сборка-часть** (ранжирование/слияние/дедуп/limit) выносится в pure-функцию `assembleV2Recall(entities, events, limit)` → юнит-тест без сети.
- **Best-effort, НИКОГДА не бросает** (сбой/пусто → `[]`). Без legacy-fallback (это SWAP): пустой recall в ход — не крэш; флаг off — откат.

### 3.2 Компонент 2 — переключить 3 точки (флаг-гейт)
- `gatherAssistantContext`/`ctx.memories`: `isV2ReadEnabled` → наполнить `ctx.memories` из `getRelevantV2Memories`; иначе legacy `getRelevantMemories`. (Минимальная правка источника, формат промпта неизменен.)
- `recall_person`: флаг → v2-recall (entity/episodic); иначе legacy.
- `get_goal_progress`: флаг → v2-recall; иначе legacy.

### 3.3 Поведение НЕ трогаем
`jarvis-prompt`/`assistant-personality`/`therapeutic-mode`/стили/кризис — без изменений. v2-enrichment фиксированные секции — без изменений (остаются сверху). Меняется только наполнение `ctx.memories` + 2 recall-инструмента.

## 4. Деградация / безопасность
- v2-recall best-effort → сбой = пустой recall в этот ход (бот не крэшится, просто меньше вспомнил). Флаг off = мгновенный откат к legacy.
- Поведение/деньги/инструменты не затронуты by-construction (не трогаем их код).

## 5. Тесты
- `assembleV2Recall` — pure unit (entities+events → ожидаемые строки, дедуп, limit, пустые входы → []).
- `getRelevantV2Memories` — structural (never-throws обёртка, использует resolveEntity + episodic).
- 3 точки — structural: флаг-ветка `isV2ReadEnabled` присутствует, off-путь = legacy без изменений.
- Базовая сюита (~1913) зелёная. Zero `vi.mock`. createAnthropic() only (M2 Claude не добавляет; embedding — существующий путь).

## 6. Rollout (по явному слову Berik)
1. Локальные коммиты per-step, tsc+vitest зелёные, `FEATURE_V2_READ` off (втёмную).
2. Push → deploy. 3. Флаг `FEATURE_V2_READ=user-{berik}`.
4. **SMOKE:** спросить бота вспомнить (а) прошлый факт из чата, (б) человека (recall_person), (в) что говорил о цели (get_goal_progress) — бот вспоминает из v2 нормально. Сравнить ощущение с legacy.
5. Ок → `FEATURE_V2_READ=all`.
6. **M3 следом:** удалить legacy (Memory table, captureMemory, getRelevantMemories) — отдельная спека, после аудита всех консьюмеров Memory-таблицы.

## 7. Non-Goals
- ❌ Удаление legacy-таблицы/captureMemory/getRelevantMemories — это **M3** (следом).
- ❌ Миграция старых фактов (выбрасываемые, подтверждено Berik).
- ❌ Изменение поведения/личности/инструментов/v2-enrichment секций.
- ❌ Новая embedding-инфра (переиспользуем episodic/entity resolve).

## Self-review checklist
- [x] Только чтение (SWAP на v2), поведение не трогаем. Удаление = M3.
- [x] Флаг-гейт `FEATURE_V2_READ` (off=байт-в-байт), отдельный от FEATURE_V2_MEMORY.
- [x] Pure `assembleV2Recall` + structural тесты, zero vi.mock, never-throws.
- [x] 3 legacy-read точки перечислены и покрыты.
- [x] Безопасный порядок: build v2-recall → swap → SMOKE → M3 delete (не delete-first).

**Awaiting Berik review → writing-plans.**
