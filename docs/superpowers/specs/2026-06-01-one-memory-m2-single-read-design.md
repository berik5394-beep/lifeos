# ОДНА ПАМЯТЬ — M2: Один писатель (single writer) — Design Spec

**Status:** DRAFT (REWRITTEN после checkpoint-находки) → awaiting Berik review
**Author:** Claude (brainstormed with Berik 2026-06-01)
**Часть инициативы:** ОДНА ПАМЯТЬ (M1 capture ✅ prod → **M2 single-writer** → M4 commitment-reliability). Бывший «M3 remove-legacy» сворачивается СЮДА (legacy убирается на записи).

## 0. ВАЖНО — почему спека переписана (checkpoint)
Первая версия M2 («переключить ЧТЕНИЕ на v2») оказалась **редундантной**. Доказано по коду:
- Есть ОДНА таблица `Memory`. И legacy `captureMemory`, и v2 `recordEvent` (вкл. M1) пишут в неё (`prisma.memory.create`).
- v2-строки: `source:'v2-episodic'`, `expiresAt:null` → проходят фильтр чтения.
- `getRelevantMemories` читает ВСЕ строки без фильтра по source → **уже** возвращает v2/M1-данные.
→ **Чтение уже единое.** Строить `getRelevantV2Memories` не нужно. Berik 2026-06-01 выбрал реальную задачу: **«Один писатель».**

## 1. Реальная проблема — ДВА писателя в одну таблицу пишут РАЗНОЕ
- **legacy `captureMemory`** (`jarvis-orchestrator.ts:182` цикл по `extracted.memories` + `:666`): структурные **извлечённые факты** `{type,content,details,tags,importance}`. Делает **дедуп** (`shouldOverwriteContent` + дубликат-запрос) + **embedding** (`storeEmbedding`→`embedDocument`, vector). Качественный писатель.
- **v2 `captureV2InBackground`** (`v2-capture.ts:104`): `recordEvent({type:'message', content: text, entityRefs})` — **сырое сообщение** одним episodic-событием. Плюс entities (граф) + mood. **БЕЗ дедупа, БЕЗ embedding.**
- **M1 `captureActivity`** (`tool-activity-summary.ts:175`): action-события через `recordEvent`. **БЕЗ дедупа, БЕЗ embedding.**

Итог: двойная запись фактов чата + дубли-строки + v2/action-строки ищутся только FTS (нет вектора).

## 2. Цель M2
**ОДИН write-путь** в `Memory` с лучшим из обоих (episodic-поля v2 + дедуп + embedding legacy). Все источники (чат-факты, episodic-событие, action-события M1) пишут через него. Потом отключаем legacy `captureMemory`. Чтение (`getRelevantMemories`) НЕ трогаем — уже единое.

## 3. Архитектура (single writer, флаг-гейт)
**Новый флаг `isV2WriteEnabled(userId)`** (env `FEATURE_V2_WRITE`, форма как у сиблингов). off → сегодняшняя двойная запись (байт-в-байт). on → один писатель (legacy captureMemory НЕ вызывается).

### 3.1 Компонент 1 — `writeMemory(userId, input)` (единый писатель)
Расширить путь записи (в `episodic-memory.ts` рядом с `recordEvent`, либо новый `memory-writer.ts`), вобрав смарты legacy:
- Пишет в `Memory` с episodic-полями (validAt/invalidAt/entityRefs/mood/source) — как `recordEvent` сейчас.
- **Дедуп:** портировать `shouldOverwriteContent` + дубликат-запрос из `memory-service.captureMemory` → update-in-place (importance=max, обновить content/details) ИЛИ create. (Чистую часть `shouldOverwriteContent` переиспользуем как есть — она уже в memory-service.)
- **Embedding:** портировать `storeEmbedding`/`embedDocument` → эмбедить на запись. **Условно по стоимости:** эмбедим контент с recall-ценностью (чат-факты, importance≥N); высокочастотные дешёвые action-события (`source` экшена) можем НЕ эмбедить (FTS хватает) — knob в `input` (напр. `embed?: boolean`, default по типу). Бюджет: 1 embed-вызов на «ценную» запись.
- Best-effort, никогда не роняет горячий путь (как сейчас recordEvent/captureActivity).

### 3.2 Компонент 2 — все источники через единый писатель
- **Чат извлечённые факты:** `jarvis-orchestrator.ts:182` цикл → `writeMemory` (с теми же `{type,content,details,tags,importance}`) вместо `captureMemory`. `:666` preference-write → `writeMemory`.
- **Чат episodic-событие:** `v2-capture.ts:104` `recordEvent` → уже единый писатель (recordEvent = writeMemory или зовёт его).
- **Action-события M1:** `captureActivity`→`recordEvent` → автоматически получают дедуп (и опц. embedding).
- Всё за флагом `isV2WriteEnabled`: on → captureMemory не вызывается; off → как сейчас.

### 3.3 Что НЕ трогаем
Чтение (`getRelevantMemories`) — без изменений (уже единое). Извлечение фактов (`extracted.memories` из intent-parser) — оставляем как есть, меняем только КУДА оно пишет. Поведение/личность/инструменты/v2-enrichment секции — не трогаем. Entity-граф/mood/axes ветки captureV2 — без изменений.

## 4. Деградация / безопасность
- writeMemory best-effort → сбой записи = факт не записан в этот раз (не крэш), как сейчас.
- Флаг off = текущая двойная запись (мгновенный откат).
- Дедуп/embedding — перенос ПРОВЕРЕННОЙ legacy-логики, не новая (риск низкий).

## 5. Тесты
- `shouldOverwriteContent` — уже покрыт (legacy); переиспользуем.
- pure-часть нового writeMemory (выбор update-vs-create по дубликату; embed-knob по типу) — unit без сети.
- structural: orchestrator:182/:666 зовут `writeMemory` (не `captureMemory`) под флагом; captureV2/captureActivity идут через единый писатель; off-путь = legacy.
- Базовая сюита (~1913) зелёная. Zero `vi.mock`. createAnthropic() only (embedding — существующий путь embeddings.ts).

## 6. Rollout (по явному слову Berik)
1. Локальные коммиты per-step, tsc+vitest зелёные, `FEATURE_V2_WRITE` off (втёмную).
2. Push → deploy. 3. Флаг `FEATURE_V2_WRITE=user-{berik}`.
4. **SMOKE (по факту БД):** написать боту факт («Серик переехал в Астану») → проверить ОДНУ строку в Memory (не дубль, с embedding); повторить факт → апдейт, не вторая строка; спросить бота вспомнить → находит. Создать задачу кнопкой → action-строка. Затем `FEATURE_V2_WRITE=all`.
5. **Follow-up (после подтверждения):** удалить функцию `captureMemory` + мёртвый код (когда флаг доказан). Read оставляем.

## 7. Non-Goals
- ❌ Менять ЧТЕНИЕ (`getRelevantMemories`) — уже единое.
- ❌ Менять извлечение фактов (intent-parser) — только место записи.
- ❌ Удаление таблицы Memory (она и есть единая память; не удаляем).
- ❌ Поведение/личность/инструменты/enrichment.
- ❌ Миграция старых фактов (выбрасываемые, подтверждено Berik).

## Self-review checklist
- [x] Спека переписана под факт «чтение уже единое» (checkpoint). Реальная цель — один ПИСАТЕЛЬ.
- [x] Покрыты ВСЕ 3 источника записи (чат-факты, episodic-событие, action-события) + дедуп + embedding.
- [x] Флаг `FEATURE_V2_WRITE` (off=байт-в-байт), обратимо; удаление captureMemory — follow-up после доказательства.
- [x] Переиспуем проверенную legacy-логику (shouldOverwriteContent/storeEmbedding), не пишем новую с нуля.
- [x] Стоимость embedding ограничена knob'ом (не эмбедим дешёвые высокочастотные action-события).

**Awaiting Berik review → writing-plans.**
