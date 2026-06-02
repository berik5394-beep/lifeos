# Коуч по накоплениям — Design (deadline-aware pacing + reactive-on-expense)

**Дата:** 2026-06-02
**Статус:** утверждён Berik (brainstorm 2026-06-02), готов к writing-plans
**Трекинг:** #170 «коуч по накоплениям»

---

## 1. Цель и контекст

Связать **деньги ↔ годовую финансовую цель-сумму ↔ проактивный совет**: бот должен говорить «при текущем темпе не успеешь к сроку — откладывай X/мес» и реагировать на конкретные траты, которые бьют по цели. Это первая **реальная кросс-доменная фича** поверх единой памяти (M1+M2, done+prod).

### Что УЖЕ есть (переиспользуем, не строим заново)
- `reflector-service.ts` → `gatherReflectorFacts` уже читает реальные `Income`/`Expense` (окно 90 дн → /мес) и `YearlyGoal.target` финансовой цели.
- `reflector-core.ts` → `reflect()` уже эмитит детерминированные фин-инсайты: `cashflow_negative` (тратишь больше чем зарабатываешь) и `goal_horizon_*` (но только грубо: «≥30 лет»).
- Sonnet перефразирует инсайт в стиль ассистента (цифры не трогает); Insight-стор + `deliverTopInsight` (≤1 пуш/день) + `runReflectorDaily` (идемпотентно, tz-корректно) — всё работает.

### Реальные дыры (это и есть фича)
1. **Нет срока + темпа.** Цель знает сумму, но не дату. Ловит только 30+-летний горизонт. Не скажет «к декабрю не хватит 600к — откладывай 250к/мес».
2. **Не реагирует на конкретный расход** (только дневной батч).

### Принцип «одна голова» (ключевое)
Все способы ввода расхода сходятся в одну точку — `runRegistryTool('add_expense')`:
```
фото/скрин → finance-vision → подтверждение → runConfirmedAction → runRegistryTool('add_expense')
текст «потратил 5000» ─────────────────────────────────────────→ runRegistryTool('add_expense')
голос ────────────────────────────────────────────────────────→ runRegistryTool('add_expense')
```
Коуч читает таблицу `Expense` и вешается на точку схождения → **фото = текст = голос**, никакого спец-кода по способу ввода. Мобильная кнопка-расход идёт через REST-роут (`POST /finance/expenses`) — в цель тоже попадает (рефлектор суммирует `Expense`), просто там нет чата для inline-строки (слой мобилы — позже).

---

## 2. Объём (scope)

**В объёме:**
- #1 deadline-aware pacing (срок + темп + «надо откладывать X/мес»).
- #2 реактивный коуч после расхода, гейтнутый («только когда бьёт по цели»).

**Вне объёма (опциональные follow-up, Berik выбрал 1+2):**
- #3 `get_goal_progress` on-demand consistency — почти бесплатно (вызвать то же ядро), но отдельно.
- #4 явный «хочу накопить 3 млн к декабрю» одной фразой как отдельный сетап — `decompose_goal` это и так покрывает.

---

## 3. Подход C — одно чистое ядро + тонкие адаптеры

Новый pure-модуль `savings-pace.ts` — единственное место с математикой. Три тонких потребителя зовут его и берут готовые числа:
1. **Рефлектор** (проактивный, раз в день).
2. **Реактивный хук** после `add_expense`/`add_income`.
3. (опц.) `get_goal_progress` (on-demand) — вне ядра объёма.

Почему не отдельный сервис: дублировал бы сбор доход/расход/target, который рефлектор уже делает → две головы про «деньги↔цель» = фрагментация, которую убиваем.

---

## 4. Модель данных

- `YearlyGoal.target Float?` — **уже есть** (числовая сумма цели, напр. 3 000 000; ставится через `decompose_goal`).
- **Новое:** `YearlyGoal.targetDate DateTime?` — срок. Миграция **аддитивная nullable** (безопасна, прод через `migrate deploy`). Если `null` → коуч берёт **31 декабря** `year` как срок по умолчанию.
- **Новых таблиц нет.** «Накоплено» (`savedSoFar`) = `Σ(Income) − Σ(Expense)` с начала года, считается на лету.

**Допущение (явное):** профицит = сбережения (весь доход−расход идёт в цель). Принято Berik. Если позже окажется грубо — заводим отдельный учёт «отложил» (вариант #2 модели накоплений, отклонён сейчас как YAGNI).

---

## 5. Чистое ядро `savings-pace.ts`

Без БД/AI. Тестируется раз. `computeSavingsPace(facts) → SavingsPace`.

### Вход
```ts
interface SavingsPaceFacts {
  target: number;       // сумма цели (₸); <=0 → no_target
  targetDate: Date;     // срок (дефолт 31 дек подставляет адаптер)
  savedSoFar: number;   // Σ(Income) − Σ(Expense) с начала года (может быть < 0)
  monthlyPace: number;  // текущий темп сбережений/мес = (Σinc90 − Σexp90)/3 (может быть <= 0)
  now: Date;
}
```

### Выход
```ts
interface SavingsPace {
  monthsLeft: number;       // max(0, (targetDate − now)/среднемесяц)
  remaining: number;        // target − savedSoFar
  requiredMonthly: number;  // monthsLeft>0 ? max(0,remaining)/monthsLeft : remaining (lump, без Infinity)
  projected: number;        // savedSoFar + monthlyPace * monthsLeft
  paceGap: number;          // requiredMonthly − monthlyPace (>0 = надо больше)
  shortfall: number;        // target − projected (>0 = не хватит к сроку)
  progressPct: number;      // target>0 ? savedSoFar/target*100 : 0
  status: 'no_target' | 'reached' | 'stalled' | 'behind' | 'on_track' | 'ahead';
}
```

### Логика статуса (детерминированный порядок, без NaN/деления на ноль)
1. `target <= 0` → **`no_target`** (про горизонт молчим).
2. `savedSoFar >= target` → **`reached`**.
3. `monthsLeft <= 0` (срок сегодня/прошёл, цель не добрана) → **`behind`** (`requiredMonthly = remaining` — нужно всё сразу; message говорит «срок прошёл»).
4. `monthlyPace <= 0` (не копишь) → **`stalled`** (при текущем темпе никогда).
5. `projected >= target * 1.10` → **`ahead`**.
6. `projected >= target` → **`on_track`**.
7. иначе → **`behind`** (выдаём `requiredMonthly` + `paceGap`).

`monthsLeft = max(0, (targetDate.ms − now.ms) / (30.44 * 86_400_000))`.
`requiredMonthly`: при `monthsLeft <= 0` = `remaining` (не делим на ноль).

### Юнит-тесты (pure)
on_track / behind (проверка requiredMonthly + paceGap) / stalled (pace<=0) / reached (saved>=target) / ahead (projected>=110%) / no_target (target=0) / срок прошёл (monthsLeft=0, без Infinity) / savedSoFar<0 (перерасход) / границы.

---

## 6. Проактивный путь (раз в день, через рефлектор)

- **`gatherReflectorFacts`** (`reflector-service.ts`) — в `ReflectorFacts` добавить `savedSoFar` (Σinc − Σexp с начала года) и `targetDate` (из фин-цели; дефолт 31 дек). `monthlyPace = monthlyIncome − monthlyBurn` (уже есть).
- **`reflect()`** (`reflector-core.ts`) — блок «≥30 лет» (`goal_horizon_far`/`goal_horizon_stalled`) заменить на вызов `computeSavingsPace`. Эмитим по статусу:
  - `behind` → severity ~6-7, scope `finance:goal_pace`: «Цель «{text}» ({target}₸) к {срок}: при темпе будет ~{projected}₸, не хватит {shortfall}₸. Надо откладывать {requiredMonthly}₸/мес (сейчас ~{monthlyPace}₸).»
  - `stalled` → severity ~7, scope `finance:goal_pace`: «при нулевых/отрицательных сбережениях цель не приближается — сначала вывести поток в плюс.»
  - `on_track` / `ahead` / `reached` → **молчим** (хорошие новости не пушим каждый день; покажем on-demand).
- **`cashflow_negative`** (тратишь > зарабатываешь) — **оставляем как есть** (ортогонально, важно).
- Доставка/перефразировка/кап — **без изменений** (Sonnet-стиль, Insight-стор, `deliverTopInsight` ≤1/день, `runReflectorDaily` идемпотентен).
- **Флаг (rollback):** `reflect()` ветвится по `facts.pacingEnabled` (= `isV2SavingsCoachEnabled(userId)`, выставляет `reflector-service`). Off → старый блок «≥30 лет», **байт-в-байт сегодня**. On → новый pacing-блок выше. Так весь фичер (проактив + реактив) откатывается одним флагом.
- **Совместимость:** даже при on — нет цели с `target` → `no_target` → молчит (как сегодня).

---

## 7. Реактивный путь (после расхода) + установка срока

### 7a. Хук `maybeSavingsCoachLine(userId, now): Promise<string | null>`
- Новый `savings-coach.ts`. Вызывается из `jarvis-orchestrator.ts` после `add_expense`/`add_income` в **двух** точках схождения: `runConfirmedAction` (подтверждённые: фото/голос/текст-с-confirm) и прямая EXECUTABLE-ветка. DRY: один хелпер на оба места.
- Собирает те же факты → `computeSavingsPace` → **гейт** (чистый `shouldNudgeOnExpense`, юнит-тест):
  ```
  if alreadyCoachedToday → false                 // дневной дедуп (см. ниже)
  if status ∉ {behind, stalled} → false
  goalBudget = monthlyIncome − requiredMonthly   // макс. трат/мес чтобы успевать
  monthOverBudget = monthToDateExpense > goalBudget
  largeSingle = monthlyIncome > 0 && expenseAmount >= 0.10 * monthlyIncome
  return monthOverBudget || largeSingle
  ```
  где `monthToDateExpense` = Σ(Expense) с начала текущего месяца (локальная TZ); `monthlyIncome` = Σ(Income 90д)/3. (Проратация бюджета по дню месяца — тюнинг плана, не дизайна.)
- Гейт прошёл → короткая **детерминированная** строка дописывается к ответу бота (пример: «Это уже выводит месяц за темп к цели — чтобы успеть к {срок}, дальше лучше попридержать.»). **Без Sonnet-перефразировки** — горячий путь расхода держим быстрым и дешёвым; стиль учитываем выбором шаблона по `assistantStyle` (без AI-вызова).
- Нет цели/`target` → `null` (молча). Любая ошибка/таймаут → `try/catch` → `null`: **расход никогда не ломается**. Честно про латентность: хук переиспользует `gatherReflectorFacts` (несколько Prisma-запросов ради DRY, §3) + tz-findUnique + дедуп-чтение — ответ чуть задерживается (индексированные агрегаты по `userId,date`, порядок десятков мс), это НЕ «1-2 запроса». Для интерактивного ответа приемлемо; флаг off → хук выходит на первой строке без запросов. Опц. оптимизация: передавать tz из оркестратора, убрав отдельный findUnique.
- Сумму расхода хук читает по тем же синонимам, что `add_expense` (`sum/cost/price→amount`): оркестратор отдаёт СЫРОЙ вход (нормализация имён — в `runRegistryTool`), поэтому алиасы резолвятся в хуке, иначе `largeSingle` не сработает на естественных именах.

### 7b. Дневной дедуп — «одна голова про цель в день»
- Общий per-day маркер через Insight scope **`finance:goal_pace`**. Если за локальные сутки уже был такой инсайт (проактивный ИЛИ реактивный) → второй путь молчит.
- Реактивный хук, когда говорит, пишет лёгкий маркер scope `finance:goal_pace` (`deliveredAt=now`, чтобы не быть ещё и запушенным) → следующий реактив/дневной за сегодня молчит. Точная работа со строкой — в плане.

### 7c. Установка срока в цель
- `target` уже ставит `decompose_goal` (планировщик извлекает число).
- Добавляем: тот же разбор **парсит дату** из текста цели («…к декабрю», «к концу года», «до июня 2027») → пишет `targetDate`. Нет даты → `null` → дефолт 31 дек. Маленькое дополнение к существующему извлечению (`planner-service.ts`), **не новый инструмент**. + unit на хелпер парсинга даты.

---

## 8. Структура файлов

| Файл | Действие | Ответственность |
|---|---|---|
| `src/services/savings-pace.ts` | 🆕 | Чистое ядро: `computeSavingsPace` + типы |
| `src/services/savings-pace.test.ts` | 🆕 | Юнит (все статусы, границы, без NaN) |
| `src/services/savings-coach.ts` | 🆕 | `maybeSavingsCoachLine` + pure `shouldNudgeOnExpense` |
| `src/services/savings-coach.test.ts` | 🆕 | Гейт unit + структурный на проводку |
| `src/services/reflector-core.ts` | ✏️ | Блок «30 лет» → вызов `savings-pace`; статусы behind/stalled |
| `src/services/reflector-service.ts` | ✏️ | Факты: + `savedSoFar` + `targetDate` |
| `src/services/jarvis-orchestrator.ts` | ✏️ | Вызов хука после add_expense/add_income (2 точки), дописать к reply |
| `src/services/planner-service.ts` (или decompose-путь) | ✏️ | Парсинг даты цели → `targetDate` |
| `prisma/schema.prisma` + миграция | ✏️ | `YearlyGoal.targetDate DateTime?` (аддитивная nullable) |
| `src/lib/feature-flags.ts` | ✏️ | `isV2SavingsCoachEnabled` (`FEATURE_V2_SAVINGS_COACH`) |

---

## 9. Флаг и откат

- Один новый флаг **`FEATURE_V2_SAVINGS_COACH`** (та же форма `(all|true|user-X)` что у соседей).
- **Off → байт-в-байт сегодня:** рефлектор использует старый блок «30 лет», реактивной строки нет. Чистый on/off всей фичи.
- Колонка `targetDate` безвредна, пока флаг off.
- Покрывает обе поверхности: своп pacing в рефлекторе И реактивный хук.

---

## 10. Тестирование

- **Pure unit:** `computeSavingsPace` (ядро) + `shouldNudgeOnExpense` (гейт).
- **Структурные** (readFileSync+grep, как в кодбазе): факты рефлектора несут savedSoFar/targetDate; orchestrator зовёт хук в 2 точках; флаг гейтит; reflect() зовёт savings-pace.
- **Без новых AI-вызовов** (перефразировку рефлектора переиспользуем). Zero `vi.mock`. `createAnthropic()` only.
- База ~2010 тестов остаётся зелёной; `tsc` чист.

---

## 11. Выкатка и SMOKE

- Локальные коммиты по шагам; push/deploy/флаг — только по явному слову Berik.
- Миграция `targetDate` — аддитивная, прод через `migrate deploy` (проверенный путь).
- **SMOKE (по факту БД, по слову Berik):** поставить фин-цель с `target`+`targetDate` (напр. «разбери цель накопить 100к к концу месяца») → добавить расходы ботом **текстом И фото** → проверить: (а) реактивная строка появляется когда гейт срабатывает; (б) дневной Insight рефлектора scope `finance:goal_pace` с советом по темпу; (в) реальные `Expense`-строки (фото = текст).

---

## 12. Non-goals / YAGNI

- Не трогаем модель «накоплено» сложнее, чем доход−расход (отдельная копилка — отклонено).
- Не делаем on-demand `get_goal_progress` consistency и явный one-liner сетап в этом объёме (опц. follow-up).
- Не делаем мобильный UI inline-строки (слой представления — при сборке приложения).
- Деньги остаются `Float` (целые тенге точны; Decimal отклонён ранее).
