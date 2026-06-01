# ОДНА ПАМЯТЬ — M1: Захват всего через инструменты — Design Spec

**Status:** DRAFT → awaiting Berik review
**Author:** Claude (brainstormed with Berik 2026-06-01)
**Quality bar:** «Умный Джарвис», один мозг. YAGNI. Money-safe. Degrade-safe.
**Часть инициативы:** «ОДНА ПАМЯТЬ / ЦЕЛЬНОЕ ПРИЛОЖЕНИЕ» (4 под-проекта: **M1 захват всего** → M2 единое чтение → M3 снос legacy → M4 надёжность commitment→действие). Этот документ — только M1.

---

## 1. Контекст и цель

**Север инициативы (язык Berik):** Память = **голова**, инструменты = **руки**. Всё приложение крутится на ОДНОЙ памяти с её блоками. Что бы юзер ни сделал — поставил задачу (духовную / финансовую / поездку / встречу — это категории, не отдельные системы), записал расход, рассказал историю — **всё хранится в одном доступном месте**. В любой момент робот-компаньон достаёт оттуда: календарь с отмеченными днями, текущие задачи, напоминание «что сделал / что не сделал». Робот **проактивен** и **никогда** не говорит «инструмент недоступен» или «не помню» — он друг и помнит ВСЁ (про Камилу, про маму, задачи, цели, расходы, встречи). Голова и руки — одно целое.

Эту картину даёт вся инициатива (M1 голова-полная → M2 единое чтение → M3 снос старой → M4 руки реально исполняют). Этот документ — **M1**.

LifeOS = AI-друг с памятью. Сейчас **две памяти параллельно**:
- LEGACY (`Memory` + `memory-service.captureMemory`, всегда вкл, плоская, кормит промпт через `ctx.memories.slice(0,15)` в `jarvis-prompt.ts:187`).
- v2 (5 tiers + entity graph + reflector, `captureV2InBackground` + enrichment-блок, флаг `FEATURE_V2_MEMORY=all`).

**Проблема, которую решает M1:** в v2 пишет **только chat-пайплайн** (telegram/voice/chat → `handleMessage`). Прямые mobile-CRUD действия (создал задачу/расход/привычку/цель/журнал/событие **кнопкой**) в v2 **НЕ попадают** — проверено: ни один роут не зовёт `captureV2InBackground`. Память неполная → друг «не знает» половину жизни юзера.

**Цель M1:** каждое значимое действие приложения **И** каждый инструмент пишут событие в v2. v2 становится **полным** — фундамент для M2 (единое чтение) и M3 (снос legacy). Legacy в M1 **не трогаем** (бот не должен терять контекст).

**Решения Berik (2026-06-01, brainstorm):**
- ✅ Механизм = **C: всё через инструменты**. Mobile write-роуты идут через тот же слой инструментов, что и чат. Один слой действий = одно место захвата.
- ✅ Глубина = **лёгкое эпизодическое событие** для структурных CRUD (без Claude-вызова на каждый тап). Полное извлечение сущностей (Claude) остаётся только для свободного текста чата.
- ✅ Объём первой спеки = **все core-модули сразу**; план раскладывается помодульно (каждый модуль — рабочий закоммиченный срез).

---

## 2. Архитектура

### 2.1 Гибрид: один захват с двух сторон в ОДНУ память

**Решение Berik (2026-06-01):** мобильные роуты и чат-инструменты в коде **разошлись** — роуты богаче (у `POST /tasks` есть parentId/IDOR, notes, kanbanStatus, recurrence, теги, подзадачи; `complete` — toggle с XP питомца; расходы считают budgetInfo; события ищут конфликты). Загонять роуты в существующие чат-инструменты = либо сломать контракт приложения, либо тащить логику роутов (вкл. питомца, которого удаляем) в инструменты. Поэтому M1 — **гибрид**: голова (память) ОДНА, питается с двух сторон, руки остаются на местах.

```
chat-агент / voice ─► runRegistryTool ─► audit ─► parse ─► handler (write)
                                              │
                                              └─► [A] после write-инструмента:
                                                  fire-and-forget captureActivity(v2 episodic)

mobile-роут ─► auth+zod ─► (своя логика+Prisma, как сейчас) ─► ответ
                              │
                              └─► [B] один вызов captureActivity(v2 episodic), fire-and-forget

свободный текст чата ───────► v2 full extraction (как сейчас, без изменений)
```

- **[A]** покрывает все действия чат-инструментов (сегодня они в v2 НЕ пишутся).
- **[B]** покрывает все mobile-кнопки — роуты НЕ переписываем, добавляем **один** вызов захвата.
- Обе стороны пишут через **один** хелпер в **одну** v2-память. «Голова одна, руки докладывают».
- Полную миграцию роутов в инструменты (чистый «один слой действий») **откладываем** на потом (после удаления питомца) — отдельный под-проект, не M1.

### 2.2 Компоненты

**A. `summarizeToolAction(name, input, result, sideEffects)` — чистый хелпер** (новый файл `src/services/tool-activity-summary.ts`).
- Вход: имя инструмента, распарсенный input, результат handler, `sideEffects`.
- Выход: `{ type: string; content: string; importance?: number } | null`.
- `null` ⇒ не захватываем (read-инструменты `sideEffects !== 'write'`; неизвестные имена).
- Для каждого write-инструмента — человекочитаемая строка на русском:
  - `create_task` → `{ type: 'task_created', content: 'Создал задачу «{title}» на {date}{ , приоритет X}' }`
  - `complete_task` → `{ type: 'task_completed', content: 'Выполнил задачу «{title}»' }`
  - `add_expense` → `{ type: 'expense_added', content: 'Расход {amount} ₸ · {category}{ · merchant}' }`
  - `add_income` → `{ type: 'income_added', content: 'Доход {amount} ₸ · {source}' }`
  - `create_event` / `update_event` → `{ type: 'event_*', content: 'Встреча «{title}» {date}{ время}' }`
  - `journal_entry` → `{ type: 'journal_logged', content: 'Дневник: сон {h}ч, энергия {e}, настроение {m}' }`
  - `create_habit`/`update_habit`/`log_habit`/`complete_habit` → `habit_*`
  - `set_budget` → `budget_set`; `create/update_weekly_goal`, `create/update_yearly_goal` → `goal_*`
- Чистая, без сети/Prisma → **юнит-тестируется** (каждый кейс + null для read/неизвестных). Никогда не бросает.

**B. `captureActivity(userId, summary)` — общий fire-and-forget хелпер** (тот же файл `tool-activity-summary.ts`).
```
export function captureActivity(userId, summary /* {type, content, importance?} | null */) {
  if (!summary) return;
  if (!isV2MemoryEnabled(userId)) return;
  void recordEvent(userId, { type: summary.type, content: summary.content, importance: summary.importance })
    .catch((e) => console.warn('[capture] recordEvent failed', e));
}
```
- **Fire-and-forget** (`void … .catch`), как `captureInBackground` (правило 1.4 — не блокирует ответ). Сбой захвата НЕ ломает действие. За флагом `isV2MemoryEnabled`.
- `recordEvent` уже существует (`episodic-memory.ts`), вход `{type, content, importance?, mood?, …}`.

**C. Хук [A] в `runRegistryTool`** (chat/tool сторона) — после успешного исполнения write-инструмента:
```
const result = await auditToolCall(...);   // как сейчас
captureActivity(ctx.userId, summarizeToolAction(name, parsedInput, result, tool.sideEffects));
return result;
```
- Нужен доступ к `parsedInput` — вынести так, чтобы parsed-значение было видно после audit, **без изменения внешнего контракта** `runRegistryTool` (напр. `let parsedInput` снаружи, присвоить внутри audited-замыкания до вызова handler). Реализация в плане.

**D. Хук [B] в mobile-роутах** (mobile сторона) — каждый mutation-роут после успешной записи добавляет **один** вызов:
```
captureActivity(request.userId, { type: 'task_created', content: `Создал задачу «${data.title}» на ${data.date}` });
```
- Роут НЕ переписываем: вся текущая логика (parentId/IDOR, питомец, теги, budgetInfo, конфликты, формат ответа) остаётся. Добавляется одна строка захвата перед `return`.
- Каждый роут строит свой `{type, content}` (тот же словарь `type`, что и `summarizeToolAction`, для консистентности голоса памяти).

### 2.3 Money-safety (инвариант цел)
- Mobile-роуты денег (`POST /finance/expenses|incomes`) **не меняются** — та же валидация, тот же расчёт budgetInfo, тот же ответ. Добавляется только fire-and-forget захват факта в память. Инвариант «нет автономных денег у ИИ» не затронут: деньги вводит ЮЗЕР, ИИ только запоминает факт.
- Confirm-FSM денежного **чат**-пути не трогаем.

---

## 3. Объём захвата — без новых инструментов

Гибрид ⇒ **новые инструменты НЕ создаём, роуты НЕ переписываем.** Захват = один вызов `captureActivity` на каждой точке.

**[A] chat/tool сторона (хук в `runRegistryTool`):** автоматически ловит все существующие write-инструменты: `create_task, complete_task, add_expense, add_income, complete_habit, journal_entry, create_event` + любые будущие write-инструменты. Ничего поштучно прописывать не надо — `summarizeToolAction` мапит по имени.

**[B] mobile сторона — добавить `captureActivity` в эти mutation-роуты:**
| Роут | type | content (пример) |
|------|------|------------------|
| `POST /tasks` | `task_created` | Создал задачу «{title}» на {date} |
| `PATCH /tasks/:id/complete` | `task_completed` / `task_reopened` | Выполнил/вернул задачу «{title}» (по факту toggle) |
| `PUT /tasks/:id` | `task_updated` | Изменил задачу «{title}» |
| `PATCH /tasks/:id/kanban` | `task_kanban_moved` | Передвинул задачу «{title}» → {status} |
| `POST /finance/expenses` | `expense_added` | Расход {amount} ₸ · {category} |
| `POST /finance/incomes` | `income_added` | Доход {amount} ₸ · {source} |
| `POST /finance/budget` | `budget_set` | Лимит {category}: {limit} ₸ |
| `POST /habits` | `habit_created` | Новая привычка «{name}» |
| `PUT /habits/:id` | `habit_updated` | Изменил привычку «{name}» |
| `POST /habits/:id/log` | `habit_logged` | Отметил привычку «{name}» |
| `POST /journal` | `journal_logged` | Дневник: сон/энергия/настроение |
| `POST /goals/weekly` · `PUT /goals/weekly/:id` | `weekly_goal_*` | Цель недели «{text}» |
| `POST /goals/yearly` · `PUT /goals/yearly/:id` | `yearly_goal_*` | Годовая цель «{text}» |
| `PUT /events/:id` | `event_updated` | Встреча «{title}» {date} |

(Создание события `POST /events` уже захватывается, если идёт через `create_event`; если у роута своя запись — добавить `captureActivity` так же.)

**[C] DELETE-роуты (последняя, низкоприоритетная группа):** `DELETE /tasks/:id`, `/habits/:id`, `/finance/expenses/:id`, `/finance/incomes/:id`, `/goals/weekly/:id`, `/goals/yearly/:id`, `/events/:id` → `*_deleted` («Убрал X»). Можно отрезать без вреда ядру M1.

`summarizeToolAction` (для [A]) покрывает имена тех же типов, чтобы голос памяти был единым с [B].

---

## 4. Объём (границы M1)

**Входит:** core life-модули — задачи, привычки, цели (недельные+годовые), финансы (расходы/доходы/бюджет), журнал, события/встречи. Действия: **create / update / complete / log / delete** (удаление тоже = событие жизни «убрал встречу с X», чтобы голова была ПОЛНОЙ — «либо захватываем всё»). Плюс chokepoint-захват для ВСЕХ инструментов (включая существующие чат-инструменты — сегодня их действия в v2 не пишутся). Свободные рассказы юзера → v2 (уже работает, full extraction).

**Non-Goals (явно вне M1):**
- ❌ **M2/M3/M4** — единое чтение, снос legacy, надёжность commitment→действие. Отдельные спеки.
- ❌ **Полное Claude-извлечение сущностей на CRUD** — только лёгкое эпизодическое (Claude-извлечение остаётся для свободного текста).
- ❌ **steps** (`POST /steps`) — авто-сенсоры/HealthKit, высокочастотный шум; не пишем по-событийно. **Решение Berik: функцию шагомера/GPS/сенсоров убираем целиком — но отдельной чисткой ПОСЛЕ M1** (как калории). M1 их просто не захватывает.
- ❌ **Питомец и арена** — питомца НЕТ; арены НЕТ (на её месте будет комната робота за донат — **отложено**, слой представления). В памяти не участвуют.
- ❌ **Прочие не-core мутации**: челленджи, теги, shared-spaces, интеграции, auth-профиль, темы, documents, vision-capture, achievements. Инфраструктура/геймификация, не «события жизни».
- ❌ **Мобильный UI** (робот показывает календарь/задачи) — слой представления, при сборке приложения. M1 даёт сервер-данные, на которых этот UI потом строится.

---

## 5. Поток данных и деградация
- Действие (чат ИЛИ мобайл) → write выполнен → ответ юзеру **немедленно**; захват в v2 идёт фоном (fire-and-forget) через `captureActivity`.
- Сбой `recordEvent` / `summarizeToolAction` / `captureActivity` → лог + игнор; **действие и ответ юзеру не страдают**.
- Флаг `FEATURE_V2_MEMORY` off (для будущих юзеров/отката) → `captureActivity` проверяет `isV2MemoryEnabled(userId)`; off ⇒ захват не пишется, поведение байт-в-байт текущее.
- Роуты **не переписываются** — мобайл-контракт неизменен by-construction (добавляется одна строка захвата перед `return`).

---

## 6. Тестирование
- **`summarizeToolAction`** — pure unit: каждый write-инструмент → ожидаемый `{type, content}`; read-инструмент и неизвестное имя → `null`; не бросает на кривом input.
- **`captureActivity`** — structural/unit: `null`→no-op; за флагом `isV2MemoryEnabled`; `void recordEvent(…).catch(` (не await).
- **хук [A] в `runRegistryTool`** — structural: вызывает `captureActivity(ctx.userId, summarizeToolAction(...))`, не `await`, только после успешного исполнения.
- **хуки [B] в роутах** — structural (per-route): роут содержит `captureActivity(request.userId, { type: '<ожидаемый>' …})`; существующая логика/ответ роута не изменены (тест не трогает контракт — проверяет только наличие захвата).
- **money-safety** — существующая сюита зелёная; финанс-роуты не изменены по логике.
- Базовая сюита (~1860) зелёная. Zero `vi.mock`. `createAnthropic()` only (M1 Claude не добавляет). Структурные тесты через `readFileSync`+grep.

---

## 7. Rollout (явное одобрение Berik на каждый шаг)
1. Задачи локально, commit-per-step, `tsc`+`vitest` зелёные.
2. Push (на «пуш»). 3. Deploy. 4. Флаг уже `FEATURE_V2_MEMORY=all`.
5. **SMOKE (по факту БД):** создать задачу/расход **кнопкой в мобайле** (или прямым роут-вызовом) → проверить, что в v2 (episodic `MemoryEvent`/эквивалент) появилась строка события (НЕ нарратив, факт в БД). Затем спросить бота «что я сегодня делал» — он должен знать действие, сделанное вне чата.

---

## 8. Решения по границам (уточнено Berik 2026-06-01)
1. **Механизм = ГИБРИД** (а не полный C). Чат-инструменты → хук [A] в chokepoint; mobile-роуты → один вызов [B] `captureActivity`. Полная миграция роутов→инструменты **отложена** (после удаления питомца) — отдельный под-проект. Причина: роуты и инструменты разошлись; полный C ломает контракт приложения или тащит логику питомца в инструменты.
2. **Питомец / арена** — НЕТ. Вне M1.
3. **DELETE-действия** — включены (полнота «помнит всё»), но **низший приоритет** (последняя группа; можно отрезать).
4. **steps** — исключены из захвата; функцию шагомера/сенсоров удаляем отдельной чисткой ПОСЛЕ M1.
5. **Категории** (духовная/финансовая/поездка/встреча) — категории задач/целей/событий, отдельных модулей не требуют.

---

## Self-review checklist
- [x] Только M1 (захват); M2/M3/M4 — Non-Goals.
- [x] Гибрид (хук [A] chokepoint + [B] captureActivity в роутах) — по решению Berik; роуты не переписываем, контракт цел.
- [x] Money-safe (финанс-роуты не изменены). [x] Degrade-safe (fire-and-forget + флаг `isV2MemoryEnabled`).
- [x] Pure helper + structural тесты, zero vi.mock. Новых инструментов нет → нет response-shape риска.
- [x] Границы объёма явные; спорные (deletes/steps/не-core/механизм) решены с Berik, не молча.

**Approved by Berik (гибрид) → writing-plans.**
