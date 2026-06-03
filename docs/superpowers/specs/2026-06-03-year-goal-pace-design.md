# Горизонт ГОД — пейсинг измеримых целей — Design (финал движка)

**Дата:** 2026-06-03
**Статус:** одобрено Berik (framing: пейсинг; scope: Y1+Y2 одним срезом)
**Контекст:** последний горизонт движка. День/неделя/месяц = «перегруз ёмкости» (capacity-fit). Год = ПЕЙСИНГ: годовая цель оживает — «прочитал 25 книг» → бот обновляет прогресс и говорит, успеваешь ли к концу года. Зеркало savings-coach, но для любой измеримой НЕ-денежной цели. Деньги-цели остаются у savings-coach (НЕ трогаем).

## 0. Блокер, который этот срез закрывает
`YearlyGoal.progress` сегодня НИКОГДА не обновляется (нет инструмента, нет голос-пути; ставится 0 при создании). Без захвата прогресса пейсинг читал бы 0 → всегда «отстаёшь» → шум. Поэтому срез = Y1 (захват) + Y2 (коуч).

## 1. Конвенции (фиксируем неоднозначность)
- `YearlyGoal.progress` = **процент 0..100** (де-факто: PUT-роут валидирует 0..100, дисплей `Math.round(progress)%`). НЕ меняем тип/конвенцию по коду.
- `YearlyGoal.target` = абсолют (50 книг, 10 кг, 1000 слов). `targetDate` = дедлайн (`?? 31 дек текущего года`, как savings-coach).
- Старт отсчёта темпа = `goal.createdAt` (цель могла появиться в середине года).
- «Измеримая» = `target != null`. «Денежная» (исключаем) = `isMoneyGoal(area, target)` = `/financ|финанс/i.test(area) && target != null` (та же логика, что reflector FIN_RE).

## 2. Y1 — захват прогресса

### 2.1 Инструмент `update_goal_progress` (`src/tools/update-goal-progress.ts`)
Args (zod): `{ goalQuery: string, value: number, valueIsPercent?: boolean }`. `.describe()` для агента: «обнови прогресс годовой измеримой цели — напр. ‘прочитал 25 книг’, ‘сбросил 3 кг’, ‘выучил 400 слов’. value=число, valueIsPercent=true если это уже проценты».

Handler:
1. Резолв цели: `prisma.yearlyGoal.findMany({ where: { userId, year: <текущий локальный год>, target: { not: null }, goalText: { contains: goalQuery, mode: 'insensitive' } } })`, затем отфильтровать `!isMoneyGoal(area, target)`.
2. **0 совпадений** → `{ message: 'Не нашёл измеримую годовую цель про «<goalQuery>». Скажи точнее или поставь цель.' }` (без записи).
3. **>1** → `{ message: 'Какую цель обновить: «A» / «B»? Уточни.' }` (без записи).
4. **1** → `pct = clamp(0,100, valueIsPercent ? value : (target>0 ? value/target*100 : 0))`; `prisma.yearlyGoal.update({ where:{id}, data:{ progress: pct } })`. (value = новый КУМУЛЯТИВНЫЙ итог, напр. «прочитал 25 книг» = всего 25.)
5. Ответ: `Отметил по «<goalText>»: <value> из <target> (<round(pct)>%).` + (если флаг) реактивная строка пейсинга `maybeGoalPaceLine`.
6. `captureActivity(userId, { type:'goal_progress_updated', content })` — как прочие write-tools (M1 паттерн).

Регистрация в `src/tools/index.ts` (рядом с suggest_goal). `needsConfirm:false` (инструмент сам решает: неоднозначность → уточнение без записи).

## 3. Y2 — пейсинг-коуч (`src/services/goal-pace.ts`)

### 3.1 Чистые
- `isMoneyGoal(area: string, target: number | null): boolean` — `/financ|финанс/i.test(area) && target != null`.
- `computeGoalPace(g: { target: number; targetDate: Date | null; progress: number; createdAt: Date }, now: Date): { status, requiredMonthly, currentMonthly, done, monthsLeft, monthsElapsed }` — `done = g.progress/100*g.target`; `targetDate = g.targetDate ?? Dec31(year(now))`; `monthsElapsed = max(0,(now - createdAt)/MS_PER_MONTH)`; `currentMonthly = monthsElapsed >= MIN_ELAPSED_MONTHS ? done/monthsElapsed : 0`; затем `computeSavingsPace({ target, targetDate, savedSoFar: done, monthlyPace: currentMonthly, now })` (reuse). Возвращает статус + requiredMonthly + currentMonthly + done + monthsLeft. `MIN_ELAPSED_MONTHS = 0.5` (раньше — мало данных, темп не считаем).
- `describeGoalPace(goalText, pace, target): string | null` — null если status ∈ {reached, on_track, ahead, no_target}. Иначе (behind/stalled): `📚 «<goalText>»: <round(pace.done)> из <target>, осталось ~<round(pace.monthsLeft)> мес — нужно ~<round(pace.requiredMonthly)>/мес, твой темп ~<round(pace.currentMonthly)>/мес. Поднажми.` (Гард «мало данных» — в `maybeGoalPaceLine`/рефлекторе: skip если `monthsElapsed < MIN_ELAPSED_MONTHS`, не в describe.)

### 3.2 Сбор + реактив
- `gatherMeasurableGoals(userId, now)` → измеримые не-денежные годовые цели текущего года (`target != null`, `!isMoneyGoal`).
- `maybeGoalPaceLine(userId, goalId, now)` — флаг `isV2YearLoadEnabled` → null; best-effort try/catch→null; берёт цель, `computeGoalPace`, `describeGoalPace`; дедуп `prisma.insight.count({ scopeKey:'goal:pace:'+goalId, source:'goal_pace', createdAt:{gte:dayStart} })`; пишет Insight (scope/scopeKey/source `goal_pace`/severity 4/deliveredAt) с `.catch`; return line. Зеркало `maybeSavingsCoachLine`.

### 3.3 Проактив — дневной рефлектор
Additive best-effort ветка (под флагом): для каждой измеримой не-денежной цели → `maybeGoalPaceLine`-эквивалент как InsightCandidate (scopeKey `goal:pace:{goalId}`, source 'reflector' или 'goal_pace'). Минимальное касание reflector-core/reflector-service — одна ветка, не ломает money-путь.

## 4. Флаг / изоляция / ошибки
- `isV2YearLoadEnabled` (env `FEATURE_V2_YEAR_LOAD`, форма как isV2MonthLoadEnabled). Off → инструмент пишет прогресс, но НЕ дописывает пейсинг; рефлектор-ветка молчит.
- НЕ трогаем `savings-pace.ts`/`savings-coach.ts` (только импортируем `computeSavingsPace`). Рефлектор — одна additive ветка под флагом, best-effort.
- Прогресс пишется ВСЕГДА (даже флаг off) — это полезная починка сама по себе.
- Best-effort: пейсинг никогда не валит инструмент.

## 5. Тестирование (zero vi.mock; структурные readFileSync+grep)
- `isMoneyGoal` юнит (finance+target→true; finance без target→false; career→false).
- `computeGoalPace` юнит: behind (мало done за прошедшее время), on_track, reached (done≥target), target=0 guard, monthsElapsed<MIN→currentMonthly=0.
- `describeGoalPace` юнит: behind→строка с «нужно ~X/мес» + «твой темп»; on_track/ahead/reached→null; мало данных→null.
- Units: value=25 absolute, target=50 → progress 50; valueIsPercent=true value=50 → 50.
- `update-goal-progress` структурно/юнит: 0 совпадений→текст без записи; >1→уточнение без записи; 1→update + ответ; деньги-цель исключена.
- Структурные: флаг гейт в tool+goal-pace; дедуп `source:'goal_pace'`; рефлектор-ветка присутствует; реестр tools/index содержит update_goal_progress.
- Изоляция grep: `savings-pace.ts`/`savings-coach.ts` не изменены.
- Полная сюита (база 2158) зелёная + tsc 0.

## 6. Инварианты
- Деньги-цели исключены из пейсинга (savings-coach владеет) — нет двойного коуча.
- Измеримость: `target != null` — иначе skip (неизмеримые «выучить английский» не пейсим).
- Прогресс = % (одна конвенция), round-trip done=pct/100*target.
- Дедуп vs own source `goal_pace`.
- Флаг off = пейсинг молчит, прогресс пишется.
- savings не тронут; reflector — additive best-effort.

## 7. Дисциплина выката
Атомарные TDD-задачи (test→red→impl→green→tsc→commit). Независимое ревью на диффе (особое внимание: reflector-ветка не ломает money-путь; tool не пишет при неоднозначности). Push/deploy/флаг — только по «пуш и деплой». Без миграции (поля target/targetDate/progress/createdAt уже есть).
