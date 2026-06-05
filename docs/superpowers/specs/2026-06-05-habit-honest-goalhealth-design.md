# complete_habit: честность + умный матч + кросс-домен привычка↔цель — Дизайн-спека

> Аудит-дыра P0 (FAKE): бот рапортует «отметил привычку», а HabitLog не пишется.
> Чиним + СРАЗУ строим кросс-пересечение привычка↔цель↔серия (директива Berik
> «как с финансами»). Berik одобрил дизайн 2026-06-05 (форк: глубоко — здоровье цели).

## Цель (одно предложение)
Отметка привычки всегда РЕАЛЬНА (или честный отказ, не враньё), умно находит
привычку несмотря на морфологию, и связывает выполнение с целью — давая
проактивный сигнал «цель проседает, привычки к ней буксуют».

## Root cause (доказано: 3 успешных complete_habit, HabitLog=0)
- `src/tools/complete-habit.ts:36` матч = голый `name:{contains}` (substring). Рус.
  морфология ломает («зарядку»≠«зарядка») → findFirst=null.
- `:44` `return {notFound:true}` БЕЗ throw → auditToolCall=success → agent-loop
  (claude-agent.ts:254) отдаёт модели JSON без is_error → модель врёт «Отметил ✅».
- При совпадении запись честная (`habitLog.upsert`).
- Механизм honesty подтверждён: claude-agent.ts:255-272 — при **throw** инструмента
  loop ставит `is_error:true` + `{ok:false,error}` → модель видит провал.
- HabitLog читают 7 сервисов (pet-streak, streak-service, proactive-notifications,
  life-truth-analyzer, profile-synthesizer, procedural-memory, v2-proactivity) →
  честная запись АВТО-восстанавливает серию/питомца/брифинги (строить не надо).

## Границы (scope)
- SERVER-only (`packages/server`).
- Часть 1-2 (честность + матч) = ФИКС вранья → шипим ВСЕМ, БЕЗ флага.
- Часть 3 (кросс-домен привычка↔цель) = новый сигнал → за флагом
  `isV2GoalHabitsEnabled`, off=байт-идентично.
- НЕ в этом срезе: create_habit (отдельная дыра P1), update_goal_progress.

## Компоненты

### 1. Честность (без флага)
- `complete_habit` handler: убрать `return {notFound}`. Если matchHabit вернул null →
  `throw new Error(buildNotFoundMessage(query, activeHabits))`:
  - есть привычки: «Не нашёл привычку «{query}». Сейчас у тебя: {имена через запятую}. Какую отметить?»
  - нет привычек: «У тебя пока нет привычек. Хочешь завести?»
  → claude-agent ставит is_error:true → модель честно переспрашивает.
- `complete_multiple_habits` handler: для каждого имени — matchHabit. Найденные →
  upsert HabitLog (реально). Если НИ ОДНО не найдено → throw (как выше, со списком).
  Если найдены частично → success-результат с явным полем `notFound: [имена]` И в
  message «Отметил: A, B. Не нашёл: C — это что-то из {список}?» (частичная запись
  реальна, поэтому НЕ throw).

### 2. Умный матч — `src/tools/_habit-match.ts` (чистый, юнит)
- `normalizeHabit(s: string): string` — lowercase, trim, убрать пунктуацию,
  схлопнуть пробелы, лёгкий рус-стем: отрезать ОДНО хвостовое окончание из набора
  `['ую','юю','ого','его','ами','ями','ах','ях','ой','ою','у','ю','а','я','ы','и','е','о']`
  ТОЛЬКО если основа остаётся ≥3 символов (защита от пере-стемминга).
- `matchHabit(query: string, habits: {id:string; name:string}[]): {id;name} | null`:
  тиры (первый сработавший побеждает):
  1. точное по normalizeHabit (q === norm(name));
  2. одно нормализованное содержит другое (norm(name).includes(nq) || nq.includes(norm(name))), длина основы ≥3;
  3. токен-оверлап: ≥1 общий нормализованный токен (split по пробелу, каждый стеммим);
  4. fuzzy: Левенштейн(nq, norm(name)) ≤ max(1, floor(len/4)) — близкая опечатка.
  Если несколько кандидатов на одном тире — берём с минимальной дистанцией; при
  ничьей — null (неоднозначно → честный отказ со списком, не угадывание).
  Тяжёлые семантические случаи («бег»→«Утренняя пробежка») НЕ матчатся → честный
  not-found+список (это страховка, не баг).
- Хелпер `levenshtein(a,b)` внутри файла (чистый).

### 3. Кросс-домен привычка↔цель↔серия (флаг `isV2GoalHabitsEnabled`)
- `src/services/goal-habits/health.ts`:
  - `buildGoalHabitHealth(userId, now): Promise<GoalHabitHealth[]>` — цели
    (`prisma.yearlyGoal.findMany` за текущий год) с привязанными АКТИВНЫМИ привычками
    (`habit.findMany where goalId in goalIds, active:true`); по каждой цели:
    linkedHabitCount, lastCompletionDate (max HabitLog.date completed по этим habitId),
    daysSinceLastCompletion. STALLING = linkedHabitCount≥1 И daysSinceLastCompletion≥3
    (или ни одной отметки никогда при возрасте цели ≥3 дн).
  - чистые хелперы вынести в `goal-habits/types.ts` (computeStall(rows)->stalling[],
    pickWorstStall — макс daysSince). Юнит-тестируемы.
- **Текст-связка** в `complete_habit` success: если у привычки есть goalId И
  isV2GoalHabitsEnabled → дописать к message: « — это к цели «{goalText}», серия {N} дней»
  (goalText из join Habit→YearlyGoal; N из streak-service — реюз; всё best-effort,
  сбой не ломает отметку). Без флага — message прежний (off=identical).
- **Проактивный детектор** `detectGoalHabitStall(userId)` в v2-proactivity-engine:
  ранний `if(!isV2GoalHabitsEnabled)return[]`; buildGoalHabitHealth → pickWorstStall →
  NudgeCandidate `source:'goal_habits_stall'`, payload{goalText, days, habitCount},
  toneHint:'gentle'. union+TEMPLATES(gentle/supportive)+scoreSignificance(≥0.6)+
  register в detectCandidates + exhaustiveness-тест. Чинит захардкоженный goalsBehind:0
  реальным числом «привычки к цели буксуют N дней».
- **Enrichment-врезка** `formatGoalHabitSection` в v2-enrichment.ts за флагом
  (поле goalHabits последним, как memorials): «Цель «X»: привычки буксуют N дней».

### Тон/UX
- Честный отказ — дружелюбный, со списком и вопросом (не сухое «не найдено»).
- Стиль ассистента к этим текстам применяется штатно (это не мемориал — смягчать
  принудительно не нужно).

## Тесты
- **Pure** (`_habit-match.test.ts`): normalizeHabit (зарядку→зарядк, чтение→чтени);
  matchHabit («отметь зарядку»→«Зарядка»; «читать»→«Чтение» через токен/стем;
  «xyz»→null; неоднозначность→null; опечатка «зарядка»vs«зарядка»→fuzzy match).
  + goal-habits/types.test.ts (computeStall: ≥3дн без отметок→stall; pickWorst).
- **Поведенческий** (`complete-habit.it.test.ts`, тест-БД): привычка «Зарядка»,
  complete_habit{name:'зарядку'} → HabitLog запись есть (морфо-матч работает);
  complete_habit{name:'несуществует'} → THROWS (Error, не success); goal-привычка →
  message содержит «к цели»; buildGoalHabitHealth ловит буксующую цель (привычка к
  цели, 0 отметок 4 дня) и игнорит свежую; cross-user.
- **Структурный** (`goal-habits-wiring.test.ts`): goal_habits_stall в NudgeSource+
  TEMPLATES+scoreSignificance+detectCandidates; detectGoalHabitStall ранний флаг-гейт;
  complete-habit.ts больше НЕ содержит `return {.*notFound` без throw (regex-гард честности);
  enrichment-врезка за флагом; flag isV2GoalHabitsEnabled.
- Baseline вся сюита зелёная (~2494 unit); tsc чисто каждый таск; zero vi.mock.

## Money-safety
Привычки — не деньги. Ноль денежных записей. (Часть 3 read-only кроме уже-честной
HabitLog-записи из части 1.)

## Rollout
- Коммит на шаг; push/deploy/флаг — по слову Berik; флаг сразу all (правило).
- SMOKE: «отметь зарядку» (морфология) → реальная запись + «к цели… серия N»;
  «отметь несуществующую» → бот честно «не нашёл, у тебя: …, какую?»; через 3 дня
  пропусков привычки к цели → проактивный нудж «цель проседает».
- После деплоя: прод-проверка HabitLog растёт (read-only).

## Открытые мелочи (решены)
- STALL порог = 3 дня. Стем отрезает ТОЛЬКО при основе ≥3 символов.
- Неоднозначный матч → null (честный отказ, НЕ угадывание).
- Текст-связка и детектор — за одним флагом isV2GoalHabitsEnabled; честность+матч — без флага.
