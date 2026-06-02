# Коуч по накоплениям v2 — Portfolio + Главная цель + Trade-off

**Дата:** 2026-06-02
**Статус:** дизайн одобрен Berik (ждёт ревью спеки)
**Тип:** эволюция уже задеплоенной фичи (#170 savings-coach), флаг `FEATURE_V2_SAVINGS_COACH` уже `all`

## 1. Проблема и видение

Сейчас коуч рассуждает об **одной** цели за раз: `pickCoachableGoal` выбирает самую срочную незакрытую → `computeSavingsPace` → «отстаёшь, надо X₸/мес». Это не видит картину целиком.

Berik хочет (дословно): «лучше все! главная цель купить квартиру! месячная цель купить велик — бот говорит, либо мы опоздаем к цели квартире, либо ты должен догнать эту сумму за 2 месяца, типо каждый месяц ты должен откладывать на 50 тысяч больше, чтобы прийти к цели купить квартиру к концу года». И: «чем больше денег, тем она главнее, естественно для неё и срок будет дольше».

Три требования:
1. **Coach ALL** — коуч держит в голове все незакрытые фин-цели сразу, не одну.
2. **Главная цель (anchor)** — самая денежная цель = главная (у неё же длиннее срок). Остальные — near-term «месячные» цели, которые конкурируют за деньги.
3. **Trade-off reasoning** — проактивно считать, как траты и мелкие цели бьют по главной: «+Δ₸/мес или к сроку опоздаешь».

## 2. Правило якоря (главная цель)

**Главная = незакрытая фин-цель с наибольшим `target`.** Подтверждено Berik: «чем больше денег, тем главнее». Корреляция «больше сумма → дальше срок» держится естественно (квартира 800к/дек > велик 100к/июнь), поэтому отдельного поля для срока-приоритета не нужно.

- Ничего не мигрируем — правило чисто вычислимо из существующих `target`.
- Тай-брейк (равные target): более дальний `targetDate`, затем любой стабильно.
- **Non-goal сейчас:** явное ручное закрепление «сделай квартиру главной» (поле `priority`/`isPrimary` + команда). Fast-follow, не в этой итерации (YAGNI — данные Berik укладываются в эвристику).

## 3. Чистое ядро — `computePortfolioPace`

Новая чистая функция в `services/savings-pace.ts` (рядом с `computeSavingsPace`/`pickCoachableGoal`). Без БД/AI — вся «портфельная» математика здесь, тестируется раз, зовут оба потребителя.

### Вход
```ts
export interface PortfolioGoal {
  text: string;
  target: number;      // > 0
  targetDate: Date;
  saved: number;       // Σ(Income)−Σ(Expense) с floor(createdAt) этой цели
}
export interface PortfolioInput {
  goals: PortfolioGoal[]; // ВСЕ фин-цели с числовым target (закрытые отфильтрует ядро)
  capacity: number;       // monthlyIncome − monthlyBurn (текущий темп сбережений, может быть ≤0)
  now: Date;
}
```

### Выход
```ts
export interface GoalLeg {
  goal: PortfolioGoal;
  required: number;   // requiredMonthly из computeSavingsPace (на эту цель в одиночку)
  monthsLeft: number;
  status: SavingsStatus;
}
export type PortfolioStatus =
  | 'none'            // нет незакрытых целей → коуч молчит
  | 'on_track_all'    // capacity ≥ суммы нужного → молчит (хорошие новости не пушим)
  | 'stalled'         // capacity ≤ 0 → главная не приближается
  | 'anchor_at_risk'  // capacity < нужного на ГЛАВНУЮ (её одной не хватает)
  | 'collision';      // главную одну тянешь, но мелкие сверху не лезут
export interface PortfolioPace {
  status: PortfolioStatus;
  anchor: GoalLeg | null;          // главная (max target)
  competitors: GoalLeg[];          // остальные незакрытые, по убыванию required
  topCompetitor: GoalLeg | null;   // самый «давящий» (max required) — для строки
  capacity: number;
  requiredAnchor: number;          // anchor.required (0 если нет якоря)
  sumRequired: number;             // Σ required по всем незакрытым
  anchorDelta: number;             // max(0, requiredAnchor − capacity)
  collisionDelta: number;          // max(0, sumRequired − capacity)
}
```

### Логика
1. `unmet = goals.filter(g => g.target > 0 && g.saved < g.target)`.
2. Для каждой `unmet` → `leg = computeSavingsPace({target, targetDate, savedSoFar:saved, monthlyPace:capacity, now})` → `{required, monthsLeft, status}`.
3. `anchor = unmet с max target` (тай-брейк: дальше срок). `competitors = unmet \ anchor`, сорт по убыванию `required`. `topCompetitor = competitors[0] ?? null`.
4. `requiredAnchor = anchor.required`; `sumRequired = Σ leg.required`; `anchorDelta = max(0, requiredAnchor − capacity)`; `collisionDelta = max(0, sumRequired − capacity)`.
5. Статус (приоритет сверху вниз):
   - `unmet.length === 0` → `none`.
   - `capacity ≤ 0` → `stalled` (как сегодняшний stalled: при нуле/минусе главная не растёт).
   - `capacity ≥ sumRequired` → `on_track_all` (всё успеваешь).
   - `capacity < requiredAnchor` → `anchor_at_risk` (даже главную одну не вытягиваешь).
   - иначе (`requiredAnchor ≤ capacity < sumRequired`) → `collision` (главную тянешь, но мелкие сверху — нет).

### Краевые
- **Одна незакрытая цель** (она же якорь): `collision` невозможен (нет competitors) → ведёт себя как сегодняшний одно-целевой коуч (anchor_at_risk при нехватке, иначе on_track_all=молчит). Обратная совместимость для одно-целевого кейса.
- **Все закрыты / нет фин-целей** → `none` → молчок.
- Числа без NaN/Infinity (наследуем гарды `computeSavingsPace`: monthsLeft≥0, деление защищено).

## 4. Сообщения коуча (детерминированные шаблоны)

Числа из ядра (честность by construction). Reflector прогоняет через Sonnet-перефразировку (тон стиля ассистента, цифры НЕ меняются). Реактив отдаёт шаблон напрямую.

- **stalled:** `🏠 Главная «{anchor}» ({target}₸): при нулевых/отрицательных сбережениях она не приближается. Сначала вывести денежный поток в плюс.`
- **anchor_at_risk:** `🏠 Главная — «{anchor}» ({target}₸ к {срок}): надо ~{requiredAnchor}₸/мес, твой темп ~{capacity}₸ → не хватает ~{anchorDelta}₸/мес. Либо +{anchorDelta}₸/мес, либо к сроку опоздаешь.` + если есть `topCompetitor`: ` А «{topCompetitor}» сверху только отодвигает её.`
- **collision:** `🏠 На «{anchor}» ({target}₸) при темпе ~{capacity}₸/мес выходишь. Но «{topCompetitor}» ({tcTarget}₸ к {tcСрок}) требует ещё ~{tcRequired}₸/мес — вместе не вытянуть. Чтобы успеть к обеим, +{collisionDelta}₸/мес; иначе двигаем «{topCompetitor}».`
- **none / on_track_all:** ничего (молчим).

Пример на реальных прод-цифрах Berik (темп ≈51к): квартира 800к/31.12 нужна ~115к/мес, велик 100к/30.06 ~109к/мес → `capacity(51к) < requiredAnchor(115к)` → **anchor_at_risk**: «надо +64к₸/мес на квартиру, иначе опоздаешь; велик сверху только отодвигает».

## 5. Потребители

### 5a. Дневной рефлектор — `reflector-core.reflect()`
Ветка `pacingEnabled` (флаг on) сейчас зовёт `computeSavingsPace` по одной цели. Меняем на `computePortfolioPace(facts.financeGoals, monthlySavings, facts.now)`:
- `stalled` → insight `goal_pace_stalled` severity 7.
- `anchor_at_risk` → insight `goal_pace_behind` severity 6 (текст anchor_at_risk).
- `collision` → insight `goal_pace_collision` severity 6 (новый kind).
- `on_track_all`/`none` → молчим.
- scope/scopeKey остаётся `finance:goal_pace` (дедуп как один инсайт, ≤1/день).

Ветка `pacingEnabled === false` (флаг off) — **байт-в-байт старая** («30 лет» horizon-блок по одиночной цели). Сохраняем (rollback-safety).

### 5b. Реактив после расхода — `maybeSavingsCoachLine`
Сейчас: `gatherReflectorFacts` → одиночная цель → `computeSavingsPace` → гейт → строка. Меняем на: `computePortfolioPace(facts.financeGoals, capacity, now)` → гейт → строка из шаблона (§4).
- Гейт `shouldNudgeOnExpense` адаптируется: «говорить только когда бьёт по главной» — статус ∈ {`stalled`,`anchor_at_risk`,`collision`} И (`monthToDateExpense > goalBudget` ИЛИ `largeSingle` ≥10% дохода) И `!alreadyCoachedToday`. `goalBudget = monthlyIncome − requiredAnchor` (макс. трат/мес чтобы успевать к главной).
- Дедуп Insight scopeKey `finance:goal_pace` (как сейчас, общий с дневным, ≤1/день).
- Best-effort try/catch→null (расход никогда не ломается).

## 6. `ReflectorFacts` — изменение

Добавляем массив, **оставляем** старые одиночные поля для off-пути (rollback byte-identical):
```ts
financeGoals: { text: string; target: number; targetDate: Date; saved: number }[]; // НОВОЕ (on-path)
// СОХРАНЯЕМ (off-path «30 лет»): financeGoalTarget, financeGoalText, savedSoFar, targetDate
```
`gatherReflectorFacts` уже считает per-goal `saved` (массив `finCandidates` из фикса pickCoachableGoal) — отдаём его как `financeGoals`; одиночные поля продолжаем выводить через `pickCoachableGoal`/YTD-fallback (для off-пути). Минимальная правка.

## 7. Флаг / миграции / совместимость

- Флаг `FEATURE_V2_SAVINGS_COACH` (уже `all`). On → portfolio-логика. Off → старый «30 лет» (байт-в-байт).
- **Без миграций** (правило «главная = крупнейшая» схемы не требует).
- Внимание: флаг уже `all` → деплой сразу включит portfolio всем (нет «тёмного» периода). Это строгое улучшение одно-целевого коуча; верифицируем прод-фактами после деплоя.
- `pickCoachableGoal` НЕ удаляем — остаётся для вывода одиночной цели на off-путь (additive).

## 8. Тестирование

- **Pure unit `savings-pace.test.ts`** для `computePortfolioPace`:
  - пусто/все закрыты → `none`.
  - capacity ≤ 0 → `stalled`.
  - capacity ≥ sumRequired → `on_track_all`.
  - capacity < requiredAnchor → `anchor_at_risk` + `anchorDelta = requiredAnchor−capacity`.
  - requiredAnchor ≤ capacity < sumRequired → `collision` + `topCompetitor` = max required + `collisionDelta`.
  - anchor = max target (даже если competitor ближе по сроку/больше required).
  - одна цель → никогда `collision`; ведёт как одно-целевой.
  - кейс Berik (квартира 800к + велик 100к, capacity 51к) → `anchor_at_risk`, anchorDelta≈64к.
- **Structural** (`readFileSync`+grep): `reflect()` зовёт `computePortfolioPace` под `pacingEnabled`; off-ветка сохраняет старый horizon-блок; `maybeSavingsCoachLine` зовёт `computePortfolioPace`; `gatherReflectorFacts` отдаёт `financeGoals`.
- Сюита остаётся зелёной (2069 → +новые), tsc 0, zero vi.mock.

## 9. Non-goals (осознанно отложено)

- Ручное закрепление главной (поле + команда) — fast-follow.
- Конфигурируемое «догнать за ровно N месяцев» — выражаем дельту/мес (ядро); «за 2 месяца» — естественная производная, не строим отдельный механизм.
- Распределение бюджета между целями (waterfall/priority-allocation) — пока только anchor-centric trade-off.
- Не-финансовые цели в портфеле — только finance.

## 10. Файлы

- `services/savings-pace.ts` — +`computePortfolioPace` (+типы).
- `services/savings-pace.test.ts` — +unit.
- `services/reflector-core.ts` — `reflect()` pacing-ветка → portfolio; `ReflectorFacts` +`financeGoals`.
- `services/reflector-service.ts` — `gatherReflectorFacts` отдаёт `financeGoals`.
- `services/savings-coach.ts` — `maybeSavingsCoachLine` + `shouldNudgeOnExpense` → portfolio.
- структурные тесты (reflector-facts/coach).
