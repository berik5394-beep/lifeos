# «Обязательства» (Obligations) — Design

> Brainstormed + одобрено Berik 2026-06-03 (подход A — first-class модель).
> Quality bar «умный Джарвис», YAGNI. Scope = SERVER ONLY (`packages/server`).
> Белое пятно рынка: персональный CRM-как-память с обязательствами, поверх нашего
> v2-мозга (память + проактивность + кросс-домен). Конкуренты (Monica/Kindred/
> PingCRM) — CRUD-CRM без мозга; мы реюзаем то, чего у них нет.

## Проблема / ценность
Деловому человеку (и не только) нужно **не ронять мяч в отношениях**: что он
обещал людям и что обещали ему — действие или деньги, с дедлайном. Сегодня у нас
есть граф людей и фоновый детектор «commitment», но обязательство **не привязано к
человеку**, **без реального срока**, **не двунаправленное** и **не управляемо
списком**. Эта фича закрывает дыру и даёт киллер-связку людей↔деньги↔цели.

## Что УЖЕ есть (реюз, не строим заново)
- `Entity(type='person')` + `EntityRelationship` — люди и связи.
- `ContactCache` — контакты + ДР.
- `v2-proactivity-engine.ts` — движок нунджей + детекторы (`detectCommitmentDue`,
  `detectStaleEntity`), гейты, шаблоны под стиль.
- confirm-FSM (`PendingAction`/`setPendingAction`/`takePendingAction` — атомарный,
  Fix #1) — для подтверждения авто-захвата и денег.
- Инструменты-паттерн (tool-registry + `normalizeToolArgs` — алиасы + относит. даты).
- v2-enrichment (вливание контекста в системный промпт) + `withTimeout`.
- Money-инструменты `add_income`/`add_expense` (money-safe через confirm).
- Тест-БД харнес (поведенческие тесты на реальной БД) — построен 2026-06-03.

## Цель slice 1
First-class `Obligation` (оба направления, action+money) + ручной и
авто-подтверждаемый захват + проактивный детектор due/overdue + предложение
записать доход/расход при закрытии денежного + enrichment в контекст мозга +
поверхность через бот/голос. Всё за флагом, off = байт-идентично сегодня.

## Не-цели (slice 1)
Мобайл-UI (слой представления — при сборке приложения), делегирование команде,
вложение договоров/документов, повторяющиеся обязательства, авто-закрытие,
исходящие сообщения третьим лицам (ассистент пишет ТЕБЕ, не Ахмету).

## Архитектура (одна фраза)
`Obligation` поверх графа людей; захват = ручной инструмент + авто-предложение
через confirm-FSM; проактивность = новый детектор в v2-движке; деньги = предложение
add_income/add_expense через confirm (money-safety не обходим); открытые
обязательства вливаются в контекст мозга. За флагом `isV2ObligationsEnabled`.

## Данные — модель `Obligation`
```prisma
model Obligation {
  id             String    @id @default(cuid())
  userId         String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  // Идиоматично (context7/Prisma 6): опциональная СВЯЗЬ relation+scalar, НЕ голый
  // String?. onDelete: SetNull — если человека-сущность удалят, обязательство
  // живёт, линк обнуляется, остаётся денормализованное personName.
  personEntityId String?
  person         Entity?   @relation("EntityObligations", fields: [personEntityId], references: [id], onDelete: SetNull)
  personName     String                        // имя пишем всегда (резолв Entity — best-effort)
  direction      String                        // 'i_owe' | 'owed_to_me'
  kind           String                        // 'action' | 'money'
  description    String                        // «прислать договор» / «вернуть долг»
  amount         Float?                         // только kind='money'
  currency       String?   @default("₸")
  dueDate        DateTime? @db.Date             // «к пятнице» → дата (parseDate)
  status         String    @default("open")     // 'open' | 'done' | 'cancelled'
  source         String                         // 'manual' | 'ai_suggested'
  note           String?
  createdAt      DateTime  @default(now())
  settledAt      DateTime?

  @@index([userId, status, dueDate])
  @@index([userId, personEntityId])
}
```
Back-relations: `User.obligations Obligation[]` и `Entity.obligations Obligation[]
@relation("EntityObligations")`. **Миграция идемпотентная** (CREATE TABLE IF
NOT EXISTS + guarded FK через DO/pg_constraint — как reconcile-миграция сегодня),
`onDelete: Cascade` сразу. Добавить `Obligation` в guard-тест удаления аккаунта
(`auth-delete-coverage.test.ts`) — он user-owned.

**Почему `personEntityId` опционален + `personName` денормализован:** обязательство
может прозвучать про человека, которого ещё нет в графе («должен Серику»), не хотим
блокировать запись на резолв сущности. Имя пишем всегда; линк к Entity —
best-effort (резолвим через существующий `resolveEntity`, если нашли).

## Компоненты (файлы, относительно `packages/server/src/`)
| Файл | Ответственность |
|---|---|
| `services/obligations/types.ts` | типы `Obligation`, `Direction`, `Kind`, `ObligationStatus` + чистые хелперы (`isOverdue(dueDate, now)`, `obligationLabel`, `normalizeDirection`) |
| `services/obligations/postgres-impl.ts` | `createObligation`, `listObligations(filter)`, `settleObligation`, `cancelObligation`, `openObligationsForContext` (топ-N) |
| `services/obligations/index.ts` | singleton-аксессор + re-exports |
| `tools/create-obligation.ts` | ручной инструмент (через registry + normalizeToolArgs); `needsConfirm` для авто-кандидата |
| `tools/list-obligations.ts` | список (открытые / по человеку / просроченные) |
| `tools/settle-obligation.ts` | закрыть; если money → вернуть «предложение» add_income/add_expense |
| `tools/cancel-obligation.ts` | отменить |
| `services/obligations/extract-obligation.ts` | haiku-классификатор «есть ли в реплике обещание/долг» → кандидат (для авто-захвата) |

## Поток данных
```
Реплика юзера → (авто) extract-obligation → кандидат → setPendingAction(confirm)
   → юзер «да» → createObligation(source='ai_suggested')
Реплика «запиши: я должен Серику договор к пятнице» → create_obligation tool (manual)
proactive-scheduler tick → detectObligationDue(userId) → нундж (стиль) → ТЕБЕ
chat → enrichment: openObligationsForContext → системный промпт (мозг видит)
settle money-обязательство → ПРЕДЛОЖЕНИЕ add_income/add_expense (confirm) → запись
```

## Проактивность
Новый детектор `detectObligationDue` в `v2-proactivity-engine.ts` (рядом с
commitment/stale): кандидаты — `status='open'` с `dueDate` сегодня/просрочен ИЛИ без
срока, но «висит» давно. Источник нунджа `obligation_due`, шаблоны под стиль:
- друг: «Ты обещал Серику договор — срок был вчера. Закрыл?»
- строгий: «Обязательство перед Сериком просрочено на 1 день. Сделай.»
- токсичный: «Договор Серику обещал — где он? Слово держим или как?»
Для `owed_to_me` — напоминает ТЕБЕ + предлагает **черновик** сообщения человеку (ты
сам отправишь). Третьим лицам ассистент НЕ пишет. Гейтинг — общий (как сейчас).

## Деньги-связка (кросс-домен)
`settle_obligation` для `kind='money'` возвращает предложение: `owed_to_me` →
`add_income(amount)`, `i_owe` → `add_expense(amount)`. Идёт через **существующий
confirm + add_income/add_expense** (ноль авто-записи, money-safety цела). В контексте
мозг может связать: «тебе должны 500к — это 20% годовой цели-суммы».

## Enrichment
`openObligationsForContext(userId)` → топ-N по близости срока → блок в системный
промпт ассистента (как axes/память). Обёрнут `withTimeout` (best-effort, не блокирует
чат). За флагом.

## Поверхность / rollout
Канал-независимый мозг (модель+инструменты+проактивность+enrichment). Сейчас —
**бот/голос**: natural language («что я кому должен?», «кто мне должен?») + Telegram
команда `/obligations` (список открытых, сгруппирован по направлению). Мобайл-UI —
не-цель slice 1 (подключим при сборке приложения).

## Флаг
`isV2ObligationsEnabled(env, userId)` в `feature-flags.ts`, env
`FEATURE_V2_OBLIGATIONS`, форма `(all|true|user-X)`. Off → инструменты не
регистрируются/детектор не запускается/enrichment пуст → байт-идентично сегодня.

## Обработка ошибок
- Деньги — только confirm (ноль авто-Income/Expense).
- Авто-захват — только предложение (без «да» не пишем); экстрактор soft-fail.
- Проактивность/enrichment — try/catch + `withTimeout`, не ломают чат.
- `dueDate` парсится строго (как в tasks: regex/parseDate), мусор → null + переспрос.

## Тестирование
- **Pure-юнит:** `isOverdue`, `normalizeDirection`, `obligationLabel`, парсер
  кандидата экстрактора (action/money/garbage).
- **Поведенческие (новый тест-БД харнес):** `obligations.it.test.ts` — create →
  list(open) → settle → статус done; **cross-user изоляция** (B не видит/не закрывает
  обязательства A); money-settle возвращает предложение нужного направления.
- **Структурные:** регистрация 4 инструментов во флаг-гейте, детектор в движке,
  флаг в feature-flags, `Obligation` в auth-delete guard-тесте.
- Baseline-сьют (~2200 unit + 11 integration) остаётся зелёным.

## Rollout-дисциплина
Коммит на шаг (trailer Co-Authored-By). Миграцию — руками идемпотентно (.env=прод).
Push/deploy/флаг — ТОЛЬКО по явному слову Berik. Флаг включаем сначала на Berik.
SMOKE: боту «я должен Айгуль отчёт к завтра» → «да» → `/obligations` показывает →
`settle` → (money) предложение add_expense.
