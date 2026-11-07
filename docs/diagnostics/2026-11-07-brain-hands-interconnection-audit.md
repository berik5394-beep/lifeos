# Аудит «все инструменты ↔ один мозг» (2026-11-07)

> Вопросы Berik: (1) связаны ли все инструменты с мозгом и друг с другом; (2) работает ли мозг; (3) уходят ли команды с любого места.
> Метод: 4 параллельных чтения кода (записи→мозг, чтение мозгом, точки входа команд, конвейер мозга) + мои выборочные проверки каждой ключевой находки по file:line + логи и флаги прода (Railway). **Код не менялся.** Прод-БД напрямую не читал (запрос заблокирован политикой) — выводы по БД только из логов.
> Сверено с `AUDIT-2026-06-11-brain-hands.md`: главная находка того аудита (второй мозг на голосовой кнопке) **ЗАКРЫТА** (voice-one-brain 2026-11-05, `routes/voice.ts:70`), TZ в интент-слое **ЗАКРЫТА**. Остальное — статус ниже.

Пути: `S/` = `packages/server/src/`, `M/` = `apps/mobile/`.

---

## 0. Короткие ответы

| Вопрос | Ответ |
|---|---|
| Все инструменты пишут в мозг? | **Нет.** Ядро (задачи, привычки, расходы/доходы, лимиты, цели, дневник, события, долги) — да. **Не пишут:** сделки и план продаж, быстрое добавление задачи, фото-захват и импорт расписания, комната/монеты, теги, зависимости задач, Google-синк, профиль/настройки. Заметки недели — вообще не уходят на сервер. |
| Мозг читает все инструменты? | **Нет.** В чате и брифе есть задачи, привычки, расходы↔лимит, цели, долги, люди, сделки, канбан, конфликты, сон↔продуктивность. **Слепые зоны:** настроение и энергия из дневника (читается только сон), доходы/баланс в брифе, недельные/месячные цели в брифе, заметки недели, фокус-сессии, монеты. Нуджи не видны в приложении (только 1 пуш в день). |
| Мозг работает? | **Да, в проде жив:** все 44 флага `=all`, планировщик тикает (`1 delivered, 4 users`), 5xx за сутки нет. **Но:** крон `mood-retention` падает каждый день (NOT NULL `updatedAt`); зеркало в Telegram спамит 403 заблокировавшему боту; 4 старые дыры открыты (двусмысленный `complete_task`, идемпотентность денег, «Говорите громче» при сбое сервиса, нет prompt-кэша). |
| Команды уходят с любого места? | **Нет.** Строка «Скажи роботу» + микрофон есть только на двух страницах дома (инструменты/комната) и в истории чата. **Нет на:** Настройках, Канбане, Фокусе, Камере, Ганте, Life-insights, Импорте и всех остальных пуш-экранах. Ответы утренних чипов («Планы», «Бюджет», «Мотивация») **выбрасываются** — пользователь их не видит. |

---

## 1. Живой прод (Railway, 2026-11-07)

- **Флаги:** 44 `FEATURE_V2_*` в коде ↔ 44 в Railway, все `=all`. Выключенных и мёртвых нет. По умолчанию (без env) любой флаг = OFF (`S/lib/feature-flags.ts:15-23`) — важно для локальной разработки: локально мозг «тупее» прода.
- **Трафик к мозгу за сутки:** `/voice/assistant` ×2, `/notifications/briefing` ×4, `/notifications/register-token` ×4. Это тесты Berik; друзей ещё нет. 5xx — 0.
- **Планировщик:** `[scheduler] proactive scheduler armed (tick 10m)`, `tick done: 1 delivered, 4 users, 10747ms` — проактивность доставляет.
- 🔴 **Крон `mood-retention` падает каждый день:**
  ```
  [cron:mood-retention] top-level failure: PrismaClientKnownRequestError:
  Raw query failed. Code: 23502. Failing row contains (…, daily_agg, null, -0.21, 0.4, neutral, {}, null, 2026-05-30, null)
  ```
  Причина: `S/services/cron/mood-retention-cron.ts:98-108` — raw `INSERT INTO "MoodSnapshot" (id, userId, source, valence, arousal, emotion, recordedAt)` **не задаёт `updatedAt`**. В Prisma `@updatedAt` — поле уровня приложения, у колонки в проде нет DB-default (миграция `CREATE TABLE IF NOT EXISTS … DEFAULT CURRENT_TIMESTAMP` не применилась — таблица уже существовала). Самая старая неагрегированная строка — **2026-05-30** → агрегация не сработала ни разу за 5 месяцев; сырые снимки настроения копятся, 30-дневная ретенция не работает. `withCronLock` считает запуск успешным (ошибка проглочена внутри `runMoodRetention`) → ретрай только через 24 ч.
  **Фикс:** добавить `"updatedAt"` и `NOW()` в INSERT (1 строка) + тест на raw-SQL; опционально DB-default колонке миграцией.
- 🟠 **Зеркало в Telegram спамит:** `[push] telegram mirror failed: 403: Forbidden: bot was blocked by the user` ×10 за сутки. `S/services/push-service.ts:~160` зовёт `sendTelegramTo` для каждого нуджа; 403 только логируется (`telegram-bot.ts:753`). **Фикс:** на 403 «blocked by the user» ставить `Integration.active=false` для telegram (и не слать дальше). Бот — тестовый стенд (правило Berik), так что главное — не тратить попытки.
- `Telegram бот: 409 (overlap деплоя)` — норма при перекате, ретрай есть.

---

## 2. Записи → мозг (отчёт «кто что сделал»)

Хук памяти для REST — `captureActivity` (`S/services/tool-activity-summary.ts:178` → `recordEvent` → `writeMemory`). Для мозговых инструментов — `runRegistryTool` → `auditToolCall` (все 54) + `captureActivity(summarizeToolAction)` (только 8).

### 2.1 Пишут в память ✅
tasks (create/update/delete/complete/kanban — `S/routes/tasks.ts:176,219,246,272,312`), habits (+log `habits.ts:69,104,125,159`), finance (expenses/incomes/budget `finance.ts:190,209,250,266,313`), goals weekly/yearly (`goals.ts:88,114,132,178,202,220`), journal (`journal.ts:95` — **только числа сон/энергия/настроение, без `notes`**), events (`events.ts:149,216,250`), obligations add/settle (`obligations.ts:45,61`), чат/голос (через оркестратор `jarvis-orchestrator.ts:256,273`).

### 2.2 НЕ пишут в память ❌ (мобилка до них достаёт)
| Маршрут | Где | Почему важно |
|---|---|---|
| `POST /tasks/quick-add` | `S/routes/quick-add.ts:28` (создаёт задачу, capture нет) | Это **основной путь TapToAdd** на экране Задачи и в Канбане («К выполнению») — самые частые записи задач не попадают в память |
| `POST /deals`, `PUT /deals/:id`, `POST /deals/:id/income`, `PUT /sales-plan` | `S/routes/deals.ts:62,68,80,101`; в `S/services/deals/*` ни одного capture | Сделки — новый модуль, мозг не помнит ни одной стадии; доход по сделке обходит `income_added` |
| `POST /vision/save-captured-tasks`, `POST /vision/import-schedule` | `S/routes/vision.ts:303,332` (`createMany`) | Фото-захват и импорт расписания создают пачки задач молча |
| `POST /import/file`, `DELETE /import/:id` | `S/routes/import.ts:358,502` | то же |
| `DELETE /obligations/:id` | `obligations.ts:69` | add/settle пишут, cancel — нет |
| `POST /room/buy`, `PUT /room` | `S/routes/room.ts:104,155` | робот не знает, что ему купили/переставили |
| `POST/PUT/DELETE /tags*` | `S/routes/tags.ts:30-105` | |
| `POST /tasks/:id/dependencies` | `S/routes/dependencies.ts:47` | + **баг:** мобилка шлёт `{prerequisiteId}` (`M/stores/task-store.ts:282`), сервер ждёт `prerequisiteTaskId` (`dependencies.ts:9`) → 400 всегда |
| `POST /tasks/ai-prioritize` | мобилка `M/stores/task-store.ts:269`; на сервере только `/tasks/prioritize` (`S/routes/prioritization.ts:33`) | **404** — кнопка AI-приоритизации не работает |
| `PATCH /auth/profile`, `/integrations/*`, `/contacts/sync`, `/shared-spaces/*`, `DELETE /chat/history` | | стиль ассистента/имя/время подъёма меняются без следа в памяти |

Монеты: `onTaskCompleted/onHabitDone/onJournalWritten/onDealWon` (`S/services/coins.ts`) — только начисляют, памяти не пишут.

### 2.3 Вообще не уходят на сервер (local-only, мозг слеп)
- **Заметки недели** (планер: заметки/улучшить/благодарность/победы) — `M/hooks/use-week-notes.ts:45`, MMKV. Это рефлексия юзера — ценнейший сигнал для «друга», и мозг его не видит вовсе. Нет ни модели, ни маршрута.
- Вода `M/app/(tabs)/habits.tsx:883`, фокус/помодоро `M/stores/focus-store.ts:86-155`, тумблеры уведомлений `M/app/settings/index.tsx:359-371`, `wakeUpTime` локально (`services/wake-up-notification.ts:39`; на сервер уходит только через `PATCH /auth/profile`).

### 2.4 Мозговые инструменты: память пишут только 8 из 43 write-инструментов
`summarizeToolAction` (`S/services/tool-activity-summary.ts:60-143`) знает только `create_task, complete_task, add_expense, add_income, complete_habit, complete_multiple_habits, journal_entry, create_event`. **Не попадают в память:** `cancel_task, create_habit, create_weekly/monthly_goal, update/log_goal_progress, edit/delete_expense, delete_income, set_budget, set_balance, create/update_deal, set_sales_plan, create/settle/cancel_obligation, decompose_goal, log_decision, suggest_goal, set_birthday, set_person_type, …`. ToolCall-аудит при этом есть у всех 54.
- `complete_task` «не найдена» возвращается как успех (`S/tools/complete-task.ts:42` `notFound:true`), а `summarizeToolAction` результат не смотрит → в память пишется «Выполнил задачу «X»», бейдж действий считает успех.
- Не аудируются как ToolCall: `commit_goal`, `applyReschedule`, доход по сделке, `captureInBackground`-задачи, travel-план (`jarvis-orchestrator.ts:680,692,711,233,1089-1163`).
- ⚠️ Возможный дубль задач: на агентном пути `captureInBackground` (`jarvis-orchestrator.ts:1693`) идёт **без** `memoriesOnly` и создаёт извлечённые задачи (`:230-247`), даже если агент в этом же ходу уже выполнил `create_task`. На прямом интент-пути `memoriesOnly:true` стоит (`:1333,1368`). В рантайме не проверено.

---

## 3. Что мозг ЧИТАЕТ (чтение поперёк доменов)

Базовый контекст чата (`S/services/assistant-service.ts:106-170`, всегда): задачи сегодня, привычки+логи, события сегодня (из БД), Σрасходов месяца vs Σлимитов, годовые/недельные/месячные цели, стрик, память, последние 3 нуджа. v2-блок (`S/services/v2-enrichment.ts`, все флаги `=all`): долги, деньги↔цель, runway, сон↔продуктивность, решения, цель↔привычки, задача↔событие-конфликт, открытые петли (просрочки+привычки+**канбан**), сделки, люди/ДР/встречи, комната (мебель), тон-по-настроению.

| Домен | Чат | Бриф | Проактивность | Read-tool агента |
|---|---|---|---|---|
| Задачи / просрочки / канбан | ✅ | ✅ | только внутри open-loop-pileup | `get_tasks` (без канбана) |
| Привычки | ✅ | счётчики | streak_break, goal_habits_stall | ❌ нет инструмента |
| Расходы ↔ лимит | ✅ | ✅ | goal_impact, runway; перерасход лимита — только legacy-пуш | `get_budget` |
| Доходы / баланс / runway | ✅ (runway) | **❌** | runway_low | только Σ в `get_budget` |
| Годовые цели (target/pace) | ✅ | 1 отстающая | ✅ 3 детектора | `get_goal_progress` |
| Недельные / месячные цели | ✅ | **❌** | weekly/monthly_stall | ✅ |
| Сделки / план продаж | ✅ | только шаги | ✅ 4 детектора | `list_deals` |
| Дневник: сон | ✅ (energy-link) | ❌ | energy_link | ❌ |
| **Дневник: настроение, энергия, notes** | **❌** (настроение берётся из тона чата, не из дневника) | **❌** | **❌** | ❌ |
| Календарь (БД) | сегодня | 1-е событие | person_meeting | ✅ |
| **Google Calendar** | только после **ручной** синхронизации (`S/routes/integrations.ts:124`); планового пула нет | | | ❌ |
| Долги | ✅ | ✅ | ✅ | ✅ |
| Люди / связи | ✅ | ❌ | ✅ 4 | `recall_person` (ContactCache+память, **не граф Entity**) |
| Решения | ✅ | ❌ | ✅ | ❌ (только write) |
| Комната / монеты | мебель; монеты ❌ | ❌ | ❌ | ❌ |
| **Заметки недели, фокус-сессии, шаги** | ❌ нет модели / не читается | ❌ | ❌ | ❌ |

Кросс-домен, который реально есть (file:line): деньги↔цель `S/services/goal-impact/goal-impact.ts:54-85`; runway `runway/runway.ts:35-58`; сон↔продуктивность `energy-link/energy-link.ts:41-110`; привычки↔цель `goal-habits/health.ts:15-28`; люди↔долги↔встречи `relationship-link`, `person-types/*`; задача↔событие `schedule-conflict/conflict.ts:21-59`; ёмкость день/неделя/месяц `day-load/week-load/month-load + capacity-fit`; канбан↔просрочки↔привычки `open-loops.ts:31-39`; настроение→тон `moodToneDirective`, `suppressPressureNudges`.
**Чего нет:** настроение/энергия дневника ни с чем не пересекаются; шаги ни с чем; календарная нагрузка↔сон.

### Доставка нуджей
`deliverTopInsight` (`S/services/insight-store.ts:187-270`) — **≤1 пуш в день**. В приложении нуджи **не показываются**: `GET /notifications/briefing` (`S/routes/notifications.ts:72-168`) их не отдаёт, мобилка `/insights` не запрашивает (grep по stores/hooks/app — 0). Итог: 25 детекторов → пользователь видит максимум одну строку в день, и только если разрешил пуши.

---

## 4. Команды с любого места

Реальный конвейер (не тот, что в старых комментариях): микрофон/текст → `useVoice({transcribeOnly:true})` (`M/hooks/shared-voice.tsx:31`) → `useUtterance.handle` → `chat-store.sendMessage` → **`POST /voice/chat`** (`M/stores/chat-store.ts:85`) → `handleMessage`. После ответа `bump()` (`chat-store.ts:109,203`) → перечитывают Сегодня/Задачи/Привычки/Цели/Финансы/Календарь/Сделки/монеты комнаты. `openPanel` обрабатывается в `M/app/home/index.tsx:79-87`. Подтверждения денег — `ChatReplyBubble` с кнопками на обеих страницах дома и в истории чата. **Это работает.**

### Дыры
1. 🔴 **Строка команд только на доме.** `ChatInputRow` смонтирован один раз в `M/app/home/index.tsx:119`. Пуш-экраны **без** микрофона и текста: Настройки, Интеграции, Импорт, Экспорт, Подписка, Теги, Общие пространства, Legal, **Камера (TaskCapture), Фокус, Канбан, Гант, Life-insights, Импорт расписания**. Пользователь должен выйти назад. Фикс: вынести `ChatInputRow` + `SharedVoiceProvider` в корневой оверлей над стеком (как уже сделано с единым микрофоном), либо монтировать строку на каждом пуш-экране.
2. 🔴 **Ответы утренних чипов выбрасываются.** `M/hooks/use-morning-greeting.ts:66-79` возвращает текст ответа, `M/components/voice/morning-greeting.tsx:110-116` вызывает `onChipPress(); onDismiss()` и **результат игнорирует**. «Планы на сегодня / Бюджет / Мотивация» → ответа нет ни на экране, ни голосом. Чипы идут в `/voice/assistant`, минуя chat-store: нет облачка, истории, `bump()`, `pendingAction` (сервер подменяет его текстом `voice.ts:194-196`).
3. 🟠 **«Отбой»** (`M/app/(tabs)/index.tsx:389-405`) — тоже мимо chat-store: ответ только в модалке `EveningRitual`, без `bump()`, pending теряется.
4. 🟠 **Облачко ответа скрыто, пока открыта клавиатура** на странице инструментов (`M/app/home/tools-page.tsx:214,225` `!kbOpen`), а `ChatInputRow` клавиатуру после отправки не прячет (`Keyboard.dismiss` — 0 вхождений). 9-секундный таймер идёт → ответ на напечатанную команду может исчезнуть невидимым. Подтверждения выживают (таймера нет).
5. 🟠 **Голосовой разговор** (`M/hooks/use-voice-conversation.ts`, «ЛайфОС, давай поговорим») не применяет результат: нет `bump`, `pendingAction`, `openPanel` → созданное в разговоре появится на вкладках только через 30 с после возврата.
6. 🟡 `openPanel` на скрытую панель (Цели/Финансы выключены в ui-store, Сделки без флага) молча открывает «Сегодня» (`M/app/home/index.tsx:60,86`).
7. 🟡 Дневник и его сводка на «Сегодня» **не перечитываются по `bump()`** (`M/app/journal/index.tsx:268-294`, `(tabs)/index.tsx:279-281`) — сказал «спал 7 часов» → дневник не обновился.
8. 🟡 Голосовой путь не проверяет `isLoading` (`M/hooks/shared-voice.tsx:50`) — вторая команда может наложиться на первую.
9. 🧹 Мёртвый код: `/voice/process` в UI не вызывается (оба `useVoice` — `transcribeOnly`), `planVoiceFollowUp/askToConfirm` в `use-voice.ts:608-612`, `useOpenPanel` (0 вызовов), стек-маршруты Dashboard/Tasks/Deals/Habits/Goals/Finance/Journal/Calendar никто не `navigate`'ит.

---

## 5. Конвейер мозга (`handleMessage`, `S/services/jarvis-orchestrator.ts:753→778`)

Цепочка: кризис-гейт (regex, `:795-813`) → pending-FSM (слоты/подтверждение/отмена, consume-once `:816-930`) → `getUserTimezone` → `parseIntent` (детерминированный regex → Haiku `INTENT_MODEL`, при падении `unknown` `ai/intent-parser.ts:494-504`) → `open_panel`/`plan_travel`/`start_dictation` → исполняемые интенты через `runRegistryTool` (деньги → confirm) → чат-путь: история+контекст+эмоции → v2-enrichment (таймаут 2500 мс) → Hermes-скиллы → `runAgent` (Sonnet, ≤3 раунда инструментов, ретрай при «не могу записать») → честный отказ при сбое с нужными инструментами → `captureInBackground` → `saveTurn`. Все 54 инструмента зарегистрированы (ни одного лишнего/потерянного), 11 с `needsConfirm`.

### Статус старых находок (AUDIT-2026-06-11)
| | Статус | Где |
|---|---|---|
| Второй мозг на голосовой кнопке (CRITICAL) | ✅ **ЗАКРЫТО** | `routes/voice.ts:70` → `handleMessage`; `handleVoiceAction` удалён |
| TZ «сегодня/завтра» в интент-слое (HIGH) | ✅ **ЗАКРЫТО** | `ai/intent-parser.ts:3,353-366,417,455` через `civilDayRefs(tz)`. **Остаток** серверного UTC-«сегодня» вне мозга: `routes/quick-add.ts:33-34` (**тот самый TapToAdd!**), `routes/travel.ts:97`, `prioritization.ts:56`, `import.ts:255`, `planner-service.ts:508`, `life-truth-analyzer.ts:587` |
| M1 жадный habit-regex | 🟡 частично | `intent-parser.ts:315` тот же; смягчено fallback'ом в `complete-habit.ts:44-69` (строгий матч задачи → иначе в чат-агент). Разбиение по «и» всё ещё режет «сделал отчёт и презентацию» на две привычки |
| Р2 `complete_task` при 2+ совпадениях | ❌ **ОТКРЫТО** | `tools/complete-task.ts:34-39` → `matchOpenTask` берёт самую свежую молча; строгий `matchTaskByWholeWords` есть, но не используется здесь |
| Р1 идемпотентность денег | ❌ **ОТКРЫТО** | `add-expense.ts`/`add-income.ts` — ключа нет; consume-once закрывает только двойное «да» |
| M2 «Говорите громче» при сбое сервиса | ❌ **ОТКРЫТО** | `routes/voice.ts:289-299`, `conversation.ts:190-203`: 200 + `text:''` и фраза, винящая юзера, при 429/5xx/нет ключа Groq (в Telegram честнее: `telegram-bot.ts:474`) |
| M4 prompt caching | ❌ **ОТКРЫТО** | `cache_control` — 0 вхождений; системные промпты intent (~70 строк) и агента + схемы 54 инструментов шлются каждый раз |
| M3 латентность | ❌ **ОТКРЫТО** | нет дедлайна на `handleMessage`; единственный таймаут — Anthropic-клиент 60 с × `maxRetries 2` (`lib/anthropic.ts:19-20`); Fastify без `requestTimeout` (`index.ts:81-85`). В инцидент Anthropic один ответ может висеть минуты |

### Новое
- **Слой честности неравномерен.** Числовой гард есть только у брифа (`morning-brief.ts:85→134`); у нуджей — слот-проверка (`v2-proactivity-engine.ts:218`); у чата — только промпт `ANTI_FABRICATION_BLOCK` + реальный счётчик просрочек. **Без проверки чисел** генерируют: основной ответ чата, `robot-explain.ts:272`, Haiku-fallback нуджей (`:1633`), `reflector-v2/synthesize.ts:33`, `reflector-service.ts:205`, `smart-booking.ts:161,366`, `skill-runner.ts:52`, `life-truth-analyzer.ts:716`, резолвер данных `send_telegram` (`:1241`).
- Инструменты, выключенные флагом (`log_decision`, `set_balance`, …), возвращают `{error:'функция отключена'}` как **успех** → считаются выполненными действиями в аудите/бейдже.
- LLM-путь `add_expense/add_income`: `Number(input.amount)` без проверки (`:1285,1297`) → возможное подтверждение «NaN ₸», zod ловит только после «да».
- `complete_task` notFound = успех (см. §2.4).
- Голый `prisma.chatMessage.count` в кризис-гейте (`:802`), `getRecentHistory`/`gatherAssistantContext`/`getToolCounts`/`pendingStagedSince` без catch → при сбое БД 500 вместо честного «я сейчас не в сети».
- Комментарий `tools/index.ts:122` врёт: `createSkillTool` «needsConfirm:true», в коде `false`.
- `withCronLock`: `runMoodRetention`/`runPatternExtraction` глотают ошибки → упавший суточный/недельный крон не ретраится до следующего окна (ровно это и видно в проде, §1).

---

## 6. План исправлений (по приоритету; оценки — чистое время)

**A. Сломано сейчас (чинить первым)**
1. `mood-retention` NOT NULL `updatedAt` — 1 строка + тест (30 мин). §1
2. `/tasks/ai-prioritize` → 404 (мобилка ↔ `/tasks/prioritize`) — путь (15 мин). §2.2
3. Зависимости задач: `prerequisiteId` ↔ `prerequisiteTaskId` → 400 (15 мин). §2.2
4. Ответы утренних чипов выбрасываются — провести чипы и «Отбой» через `chat-store.sendMessage` (облачко, история, `bump`, подтверждения) (1–2 ч). §4.2–4.3
5. Telegram-зеркало на 403 → `Integration.active=false` (30 мин). §1

**B. «Все инструменты пишут в мозг» (закрыть отчёт 28→1)**
6. `captureActivity` в `quick-add`, `vision/*`, `import/*`, `deals/*` + `sales-plan`, `room/*`, `obligations delete`, `tags`, `auth/profile` (2–3 ч). §2.2
7. `summarizeToolAction`: покрыть остальные 35 write-инструментов (таблица «тип → фраза»), смотреть `result` (`notFound`/`error` → не писать «выполнил») (2 ч). §2.4
8. TapToAdd `quick-add`: «сегодня» по TZ юзера (`civilDayRefs`) — тот же баг, что чинили в мозге (30 мин). §5
9. Заметки недели на сервер: модель `WeekNote` + `PUT /week-notes/:weekStart` + capture + чтение в enrichment и брифе (это рефлексия юзера — лучший сигнал для «друга») (полдня). §2.3

**C. «Мозг читает всё» (1→28)**
10. Дневник целиком в контекст/бриф/проактивность: настроение+энергия+notes последних 3–7 дней (сейчас только сон) (2 ч). §3
11. Бриф: доходы/баланс/runway, недельные и месячные цели (1 ч). §3
12. Нуджи в приложение: отдавать в `/notifications/briefing` (или `/insights`) и показывать облачком робота / лентой — иначе 25 детекторов видны как 1 пуш в день (полдня). §3
13. Google Calendar: плановая подтяжка в планировщике (сейчас только ручная кнопка) (2 ч). §3
14. Read-tools агенту: привычки/логи, дневник, баланс, список решений, граф людей (`recall_person` не читает Entity) (3 ч). §3

**D. «Команда с любого места»**
15. `ChatInputRow` + `SharedVoiceProvider` в корневой оверлей над стеком (или на каждый пуш-экран): Настройки, Канбан, Фокус, Камера, Гант, Life-insights, Импорт (2–3 ч). §4.1
16. `Keyboard.dismiss()` после отправки + не прятать облачко при клавиатуре / не стартовать таймер, пока клавиатура открыта (30 мин). §4.4
17. Голосовой разговор: `bump` + `pendingAction` + `openPanel` (1 ч). §4.5
18. Дневник и сводка «Сегодня» по `bump()`; `openPanel` на скрытую панель → показать панель или сказать почему (1 ч). §4.6–4.7
19. Снести мёртвый код: `/voice/process`-ветка в `use-voice.ts`, `useOpenPanel`, мёртвые стек-маршруты (правило «не удалять» — заменить на явный редирект/комментарий) (1 ч). §4.9

**E. Качество мозга (старые долги)**
20. `complete_task` при 2+ совпадениях → «какую из…?» (`matchTaskByWholeWords` уже есть) (1 ч). §5
21. Идемпотентность денег: ключ `(userId, amount, category, минута, текст)` или `clientRequestId` с мобилки (2 ч). §5
22. Честная ошибка распознавания: различать тишину и сбой Groq (30 мин). §5
23. `cache_control` на системные промпты intent/агента (1 ч, −30–50 % токенов на ход). §5
24. Дедлайн `handleMessage` (напр. 25 с) + `requestTimeout` Fastify + мгновенный ack «думаю…» в мобилке (2 ч). §5
25. Числовой гард (как `briefNumbersHonest`) на `robot-explain`, Haiku-fallback нуджей, reflector-синтез (2 ч). §5
26. Выключенный флагом инструмент → `ok:false`, не успех; `Number(amount)` проверять до confirm (30 мин). §5
27. `captureInBackground` на агентном пути → `memoriesOnly`, если агент уже создал задачу в этом ходу (30 мин). §2.4

Итого A ≈ 3–4 ч, B ≈ 1.5 дня, C ≈ 1.5 дня, D ≈ 1 день, E ≈ 1.5 дня.

---

## 7. Что реально хорошо (на что опираться)
- Один мозг для всех каналов: мобилка (чат/голос/ассистент), Telegram, разговор — всё через `handleMessage`; мобильного «второго мозга» больше нет.
- Все 54 инструмента зарегистрированы, zod на входе, `userId` только из JWT, 11 денежных/исходящих под confirm, consume-once pending на Postgres.
- Кросс-домен живёт и включён для всех: деньги↔цель, runway, сон↔продуктивность, привычки↔цель, люди↔долги↔встречи, задача↔событие, ёмкость дня/недели/месяца, канбан↔просрочки, тон по настроению.
- Честность: числовой гард брифа, слот-гард нуджей, честные отказы при сбое агента, `is_error` на упавших инструментах.
- `bump()` после каждой команды перечитывает 8 экранов — сказанное на одной вкладке видно на другой.
- Планировщик и проактивность работают в проде; 5xx за сутки нет.
