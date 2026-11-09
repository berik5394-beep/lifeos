# Аудит логики: инструменты ↔ мозг ↔ проактивность — 2026-11-08

**Вопросы Berik:** все ли инструменты взаимодействуют и влияют друг на друга? как работает проактивность, хорошо ли? все заявленные инструменты работают? у всех один мозг?

**Метод (код не менялся):**
- код на `main` = `d41170d` (это и задеплоено: Railway `54ceadf5 SUCCESS 05:54Z`);
- тесты сервера: **unit 3396 ✅ (299 файлов)**, **integration 568/569** (1 флейк, см. §6);
- прод: переменные и флаги Railway, логи ночного деплоя `3e6f5839` (жил 8 ч 26 мин, 19:47Z→04:13Z) и текущего;
- сверка со вчерашним аудитом `2026-11-07-brain-hands-interconnection-audit.md` (27 пунктов плана) — что реально закрыто.

Пути: `S/` = `packages/server/src/`, `M/` = `apps/mobile/`.

---

## 0. Короткие ответы

| Вопрос | Ответ |
|---|---|
| **Один мозг у всех?** | **Да.** Все каналы команд — текст, голос, разговор без рук, утренние чипы, «Отбой», Telegram — идут в один `handleMessage` (`S/routes/chat.ts`, `voice.ts:71,188`, `conversation.ts`, `telegram-bot.ts`). В мобилке локального исполнения команд не осталось. Все 60 инструментов — в одном реестре, один аудит ToolCall, одна память. **Оговорка:** кроме оркестратора есть ещё 5 «рассказчиков» (бриф, нуджи, «объясни вкладку», «каким я тебя вижу», «Разбор»), которые читают ту же БД, но собирают контекст **тремя разными способами** → могут разойтись в деталях (§3). |
| **Инструменты взаимодействуют и влияют друг на друга?** | **На пути через мозг — да, два слоя.** Слой A: каждое действие (и с экрана, и голосом) пишет в одну память, мозг видит последние события на каждом ходу. Слой B: посчитанные пересечения (трата→лимит/цель/запас денег, задача→ёмкость дня+конфликт с встречей, привычка→цель, сон→продуктивность, сделка→доход+монеты, ставка часа→цена встречи) + 29 детекторов. **Дыра:** действие **с экрана** (тап) не даёт мгновенной реакции робота — реакция приходит позже (бриф/нудж/следующий разговор). Единственная реактивная строка REST (`warning` по лимиту) мобилкой **не показывается** (§4). **Шаги из «Здоровья» мозг не читает** (§4). |
| **Проактивность работает? Хорошо?** | **Работает:** планировщик тикает каждые 10 мин, за ночь 2 доставки (5+1 инсайтов на 3 юзеров), ошибок 0, кроны (настроение/паттерны/Google) без сбоев. 29 детекторов + 9 плановых уведомлений. **«Хорошо» — пока не доказано на людях:** за ночь ни одного обращения к мозгу (`/voice/chat` = 0); у нового пользователя без данных сработает только «как ты?». Лимиты доставки (≤1 пуш/день, ≤3 облачка/день) — осознанно скромные. Масштаб: тик 11,8 с на 3 юзеров → на 100 ≈ 6–7 мин, на 1000 — не влезет в 10-минутный интервал (отложено Berik «при росте»). |
| **Все заявленные инструменты работают?** | **58 из 60 — да** (зарегистрированы, zod на входе, 12 денежных/исходящих под «да», аудит, память). **Не работают в проде:** `search_flights` — нет `TRAVELPAYOUTS_TOKEN` в Railway (инструмент честно падает, агент говорит «не могу»); «Забыли пароль» по почте — нет `RESEND_API_KEY` (через Telegram работает). **Требуют действия юзера:** `send_email`/`get_email_triage` — переподключить Google с правом на почту. **Без тестов по имени:** `list_obligations`, `set_hour_rate`. |

---

## 1. Что закрыто из вчерашнего плана (27 пунктов) — проверено по коду

| Блок | Пункты | Статус | Доказательство |
|---|---|---|---|
| A. Сломано в проде | 1–5 | ✅ все | `5b148cf`: mood-retention `updatedAt` (за ночь `[cron:…]` ошибок 0); `/tasks/prioritize` (`M/stores/task-store.ts:273`); `prerequisiteTaskId` (`:294`); чипы и «Отбой» через `chat-store.sendMessage` (`M/hooks/use-morning-greeting.ts:78`, `M/app/(tabs)/index.tsx:396`); Telegram-403 → `Integration.active=false` (за ночь `[push] telegram mirror failed` = 0) |
| B. Все пишут в память | 6–9 | ✅ все | `fa1321a`: quick-add, vision, import, deals, room, tags, profile; `summarizeToolAction` на все write-инструменты, `notFound/error` не пишется; WeekNote модель+роут |
| C. Мозг читает всё | 10–14 | ✅ все | `d1b25f9`: дневник целиком, бриф с доходом/запасом/целями недели, `GET /nudges/next` (мобилка опрашивает при открытии — в логах есть), Google-синк в планировщике (`S/services/proactive-scheduler.ts:113-131`), read-инструменты `get_habits/get_journal/get_balance/list_decisions` |
| D. Команда с любого места | 15–18 | ✅ | `1b0d126`: `CommandLayout` через `screenLayout` (`M/navigation/index.tsx`), `NO_BAR` = только дом/чат/разговор/вход (`M/services/command-bar.ts`); `Keyboard.dismiss()` в `chat-input-row.tsx:37`; разговор → `bump`+`openPanel` |
| D. Мёртвый код | 19 | ❌ открыт | `M/hooks/use-voice.ts:557` ветка `/voice/process` жива, но оба вызова `useVoice` идут с `transcribeOnly:true` → недостижима. Безвредно |
| E. Качество мозга | 20–27 | ✅ все | `complete_task` при 2+ → `ambiguous` (`S/tools/complete-task.ts:44`); `Idempotency-Key` (`S/lib/idempotency.ts` + finance/tasks/events); `cache_control` ×2 (агент + парсер); дедлайн 48 с (`S/lib/agent-deadline.ts`, вчера); честная ошибка распознавания; гард чисел; флаг-выключенный инструмент → не успех; `Number(amount)` до confirm; `captureInBackground` → `memoriesOnly` после `create_task` |

Итог: **26 из 27 закрыты за сутки**, в проде с утра.

---

## 2. Инструменты: 60 заявлено = 60 работают (с оговорками)

Реестр `S/tools/index.ts:82-150`, 60 файлов = 60 записей, дубли и не-boolean `needsConfirm` роняют сервер на старте (гард есть).

**Глаза (read, 19):** get_today, get_weather, get_budget, get_free_slots, get_habits, get_journal, get_balance, list_decisions, get_monthly_plan, get_tasks, get_calendar, get_email_triage, recall_person, get_weekly_plan, get_trip, search_flights, get_goal_progress, list_obligations, list_deals.

**Руки (write, 29):** create/complete/cancel_task, clear/defer_overdue, complete_habit, complete_multiple_habits, create_habit, create_weekly_goal, create_monthly_goal, create_event, journal_entry, decompose_goal, remember_entity, link_relationship, end_relationship, set_birthday, set_person_type, set_hour_rate, suggest_goal, update_goal_progress, log_goal_progress, create/settle/cancel_obligation, create_deal, update_deal, set_sales_plan, create_skill, apply_insight.

**Под «да» (needsConfirm, 12):** add_expense, add_income, delete_expense, edit_expense, delete_income, set_balance, clear_overdue, defer_overdue, log_decision, review_decision, send_telegram, send_email.

**За флагом (в проде все флаги = all, 44/44):** сделки ×4, долги ×4, решения ×2, баланс, отношения, create_event/create_task частично.

| Инструмент | Работает в проде? | Почему |
|---|---|---|
| `search_flights` | ❌ | `S/integrations/travelpayouts.ts:12` требует `TRAVELPAYOUTS_TOKEN` — в Railway его **нет** → всегда `TravelpayoutsError` → агент честно отказывает. Инструмент при этом **предлагается агенту** на каждом ходу (место в промпте) |
| `send_email`, `get_email_triage` | ⚠️ после переподключения Google | `requires: google_oauth`, без него структурный «не подключено» (не падение). В проде `GOOGLE_CLIENT_ID/SECRET` есть; у Berik scope почты ещё не выдан (вчерашний хвост) |
| `send_telegram` | ✅ | `TELEGRAM_BOT_TOKEN` есть |
| `get_weather` | ✅ | open-meteo без ключа (`S/services/external-apis.ts:85`) |
| «Забыли пароль» по почте | ❌ | `S/lib/mailer.ts` → `RESEND_API_KEY` нет (и `MAIL_FROM`). Путь через Telegram-код работает |
| Остальные 55 | ✅ | zod, userId из JWT, аудит, память |

**Покрытие тестами по имени инструмента** (сколько `*.test.ts` упоминают имя): `create_task` 19, `add_expense` 18, `add_income` 15, `complete_habit` 13 … **`list_obligations` 0, `set_hour_rate` 0**; по 1 файлу: apply_insight, cancel_obligation, create_habit, delete_income, get_balance, get_budget, get_habits, get_journal, get_monthly_plan, get_weather, list_deals, list_decisions, set_sales_plan.

---

## 3. «Один мозг»: команды — да; рассказчики — три разных сборщика контекста

**Команды (мозг = `handleMessage`, `S/services/jarvis-orchestrator.ts`):**
- мобилка: `POST /voice/chat` и `/voice/chat/stream` (`S/routes/chat.ts`), `/voice/process` и `/voice/assistant` (`voice.ts:71,188`), разговор без рук (`conversation.ts`);
- Telegram: текст и голос (`telegram-bot.ts`);
- мобилка после ответа делает `bump()` → 14 экранов/сторов перечитывают данные; `openPanel` открывает вкладку с любого экрана.
- Локального исполнения интентов в мобилке нет (`handleVoiceAction` удалён; в `chat-store.ts:354,397` `case 'add_expense'` — только текст подтверждения, не запись).

**Рассказчики вне оркестратора (LLM-генерация по тем же таблицам):**

| Генератор | Контекст берёт из | Гард чисел |
|---|---|---|
| Утренний бриф `morning-brief.ts` | `reflection-context` + runway/day-load/goal-pace/kanban | ✅ |
| Нуджи `v2-proactivity-engine.ts` | `reflection-context` + детекторы | ✅ слот-гард |
| Чат-контекст `v2-enrichment.ts` | `reflection-context` + 20 кросс-доменных модулей | промпт ANTIFAB + лог чисел |
| «Объясни вкладку» `robot-explain.ts` | **свои** запросы (`lib/user-context`) | ✅ |
| «Каким я тебя вижу» `portrait.ts` | **свои** (`about-me` + оси) | ✅ |
| «Разбор» `life-truth-analyzer.ts` | **свои** запросы + стрик; **единственный, кто читает шаги** | ⚠️ частично |

Вывод: мозг один по памяти и по командам; но «что робот думает о дне» собирается тремя сборщиками. Пример расхождения: «Разбор» учитывает шаги, бриф и чат — нет. Это не ошибка сейчас, это риск на будущее: любой новый домен нужно проводить в 3 места.

---

## 4. Взаимовлияние инструментов

**Слой A — одна память (28→1).** `captureActivity` стоит на всех мозговых инструментах (`runRegistryTool`) и, после вчерашнего блока B, на всех REST-путях, включая TapToAdd/quick-add, фото, импорт, сделки, комнату, теги, профиль. `recentEvents()` → врезка в контекст каждого хода. ✅

**Слой B — посчитанные пересечения (живые читатели, file):**

| Когда | Проверяет | Говорит | Где |
|---|---|---|---|
| add/edit/delete_expense | лимит категории, цель накоплений, запас денег | «80 %/100 % лимита», «съедает цель», runway | `S/tools/_finance.ts`, `goal-impact/`, `runway/` |
| create_task | ёмкость дня (Σ оценок минут vs свободно), конфликт со встречей | «задач на ~X ч, свободно ~Y» | `S/tools/create-task.ts` (flag=5 ветвей), `day-load.ts`, `schedule-conflict/` |
| create_event | пересечение с задачами по времени | «не успеешь», перенос | `schedule-conflict/conflict.ts` |
| complete_habit | привязка к годовой цели, серия | «к цели X, серия N» | `goal-habits/` |
| journal (сон/энергия) | продуктивность vs сон | energy-link | `energy-link/` |
| deals won | доход + монеты | | `deals/service.ts` → `onDealWon` |
| set_hour_rate | цена встречи, «передать Айгуль?» | | `time-value.ts` (вчера) |
| complete_task / habit / journal | монеты, уровень дружбы | +10/+5 | `coins.ts` — вызывается и из REST, и из инструментов ✅ |
| недельный/месячный план, долги, решения, люди, ДР | детекторы | нуджи | §5 |

**Дыры взаимовлияния:**
1. 🟠 **Действие с экрана → реакции робота «здесь и сейчас» нет.** REST `POST /tasks|/habits/:id/log|/finance/expenses` не считают day-load/конфликт/цель, только пишут память. Единственная реактивная вещь в REST — `budgetInfo.warning` в ответе `POST /finance/expenses` (`S/routes/finance.ts:174-188`), и мобилка её **не показывает** (`M/app/(tabs)/finance.tsx` — `warning` только как цвет шкалы). Итог: записал трату тапом сверх лимита — робот промолчит до следующего тика/брифа/разговора.
2. 🟠 **Шаги не доходят до мозга.** `POST /steps` пишет `StepLog` (сборка №20 + «Здоровье»), читает его только `life-truth-analyzer.ts`. В `reflection-context`, брифе, enrichment и детекторах `stepLog` — 0 вхождений. Сон из «Здоровья» → дневник → читается ✅, шаги — нет.
3. 🟡 Мобилка показывает реакцию робота на экранные действия только для уровня дружбы (`room-store.ts:147 showNudge`) — монеты «+N» в комнате, и всё.

---

## 5. Проактивность — как устроена и что видно в проде

**Движок (`S/services/v2-proactivity-engine.ts`, 1779 строк), 29 детекторов:**
birthday, memorial, check_in («как ты?» без повода), commitment_due, deal_next_step_due, deal_stale, deal_step_overdue, sales_plan_behind, decision_review, energy_link, goal_habit_stall, goal_impact, goal_no_progress, identity_growth, journal_low (N дней тяжело), monthly_goal_stall, weekly_goal_stall, mood_shift, neglected_key_person, obligation_due, open_loop_pileup (просрочки+привычки+канбан), person_meeting, relationship_link, runway_low, skill_opportunity, stale_entity, strategic_drift (только воскресенье), streak_break.

**Доставка:** `deliverTopInsight` — **≤1 пуш/день**, самый тяжёлый; receptive-hour (критичные ≥0.8 обходят); адаптивный порог по вовлечённости; дедуп по `scopeKey` на N дней; **в приложении ≤3 облачка/день** через `GET /nudges/next` при открытии (`IN_APP_NUDGES_PER_DAY = 3`); ответ «да» уходит мозгу с контекстом.

**Плановые уведомления (`proactive-notifications.ts`):** встреча за 1 ч (с брифом «что обещал/кто должен») и за 30 мин, задача за 30 мин, лимит бюджета, привычки, утренний бриф, вечерний итог, «завтра» заранее, недельный итог. iOS Time-Sensitive для встреч/задач (сборка №20).

**Планировщик:** тик 10 мин; юзеры = с пушем/Telegram + активные за 14 дней без канала (им только облачко); кроны: mood-retention (сутки), pattern-extraction (неделя), bot-traits, Google Calendar раз в час на юзера.

**Прод за ночь (деплой `3e6f5839`, 8 ч 26 мин):**
- `[scheduler] tick done: 5 delivered, 3 users, 11803ms` и `1 delivered, 3 users, 5510ms` — две доставки; остальные тики без доставки (так и логируется — только при delivered>0).
- `[cron:*]` ошибок 0 (вчерашний падающий mood-retention починен), `telegram mirror failed` 0, warn/error 0, 5xx 0.
- Запросы: только мобилка Berik (`/tasks`, `/deals`, `/habits`, `/nudges/next` ×5, `/notifications/briefing` ×5, `/memory/portrait` ×2…). **`/voice/chat` = 0, `/voice/assistant` = 0** — к мозгу ночью никто не обращался.
- Флаги: 44 в коде = 44 в Railway; 43 `=all`, `FEATURE_V2_CRON=true` (код принимает `true` как `all`, но одна переменная выбивается из ряда).

**Оценка «хорошо ли»:**
- ✅ Надёжно: без ошибок, идемпотентно по дню, не спамит.
- ⚠️ Мало видно пользователю: 1 пуш + 3 облачка в день при 29 детекторах — большинство инсайтов умирает недоставленными. Это осознанный выбор «не навязываться», но проверить на друзьях, не слишком ли тихо.
- ⚠️ Для нового пользователя без данных (как «Лейла») первые дни сработает только `check_in` — остальным нечего считать. Онбординг не кормит детекторы.
- ⚠️ Нет сигнала качества: ни одной реакции друзей на нуджи в логах, `/insights/feedback` не вызывался. Хорошо или плохо — узнаем только по людям.
- ⚠️ Масштаб: обработка последовательная, 3 юзера = 12 с. «Потом, при росте» — но порог ~80–100 активных юзеров, дальше тик не успевает за 10 мин.

---

## 6. Тесты и один флейк, похожий на настоящий баг

- unit: **3396 ✅**, 7 skipped.
- integration (реальный Postgres): **568 ✅ / 1 ❌** → при одиночном запуске ✅ (флейк).
- Упавший: `S/services/memory-dedup-forgotten.it.test.ts` — «после «Неправда» похожий факт создаётся новой видимой записью» получил `updated` вместо `created`.
- Вероятная причина (не доказана, нужен тест с подменой времени): `forgetMemory` ставит `invalidAt = new Date()` **часами приложения**, а дедуп в `writeMemory` фильтрует `invalidAt IS NULL OR invalidAt > NOW()` **часами Postgres** (`S/services/episodic-memory.ts:197`). Если БД отстаёт от Node хоть на миллисекунды (под нагрузкой / другой контейнер / в проде другая машина), только что «забытая» запись ещё считается живой → новый факт **сливается в забытую и остаётся невидимым**. Сценарий пользователя: нажал «Неправда» → тут же сказал правильно → робот «не запомнил».
- Безопасный фикс (не делал): в дедупе считать забытым любое `invalidAt IS NOT NULL` с запасом (`invalidAt > NOW() + interval '5 seconds'`), либо передавать «сейчас» из приложения.

---

## 7. Что хорошо (на что опираться)

- Один `handleMessage` для всех каналов; мобилка — только транспорт. Реестр из 60 инструментов с гардами на старте; деньги и исходящие — под «да» с consume-once на Postgres и `Idempotency-Key`.
- Слой A памяти закрыт полностью со вчера; слой B — 9 живых пересечений с тестами на реальной БД.
- Проактивность не падает, не спамит, честна по числам (гарды на брифе, нуджах, пояснениях, портрете).
- 26 из 27 вчерашних пунктов закрыты за сутки и уже в проде; тестов 3964, все зелёные кроме одного флейка.

## 8. Что делать дальше (по важности; без правок в этом аудите)

1. 🟠 **Реакция на экранные действия:** показать `budgetInfo.warning` в мобилке (уже приходит) и/или гонять `create_task`/`log habit`/`expense` из REST через те же реактивные функции (`maybeDayLoadLine`, `analyzeBudgetAfterExpense`) и отдавать строку роботу. Иначе «влияют друг на друга» только когда говоришь с роботом.
2. 🟠 **Шаги в мозг:** `StepLog` в `reflection-context` (вчера/сегодня, цель шагов) → бриф/enrichment/детектор «мало двигаешься N дней». Данные уже льются с «Здоровья».
3. 🟡 **Флейк-баг дедупа** (§6): тест с подменой `NOW()` + фикс сравнения.
4. 🟡 `TRAVELPAYOUTS_TOKEN` поставить или убрать `search_flights` из предложений агенту (сейчас занимает место в промпте и всегда падает). `RESEND_API_KEY`+`MAIL_FROM` — для «Забыли пароль» по почте.
5. 🟡 Тесты на `list_obligations`, `set_hour_rate`; `FEATURE_V2_CRON` → `all`.
6. 🟡 Один сборщик контекста: `robot-explain`, `portrait`, `life-truth` перевести на `reflection-context`, чтобы «Разбор», бриф и чат не расходились.
7. ℹ️ Дать друзьям поговорить с роботом и посмотреть `[jarvis:timing]`, `numguard`, `/insights/feedback` через 3–4 дня — без этого «хорошо ли» не ответить.
8. ℹ️ Мёртвая ветка `/voice/process` в `use-voice.ts` — убрать при случае.
