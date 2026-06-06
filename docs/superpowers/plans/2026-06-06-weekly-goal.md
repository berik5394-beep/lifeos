# create_weekly_goal + проактивный детектор — spec+plan (audit P2 #2, вариант Б)

**Goal:** из чата «моя цель на неделю — X» персистится в WeeklyGoal; мозг видит её каждым ходом (живой weeklyPlan-ридер); + проактив «конец недели, цель не закрыта → напомни». Одобрено Berik (вариант Б).

Server-only, без флага для tool (аддитивный, как create_habit); детектор — под FEATURE_V2_PROACTIVITY (уже all). Commit-per-step. Push/deploy — по слову.

## Паттерны (file:line)
- weekStart (SSOT): assistant-service.ts:146-147 — `Date.UTC(ly,lm-1,localDay)` затем `−((getUTCDay()+6)%7)` = UTC-полночь понедельника лок. недели. → вынести в `localWeekStartUTC(tz)` (lib/tz.ts), assistant-service переключить на неё (write↔read совпадут по построению).
- Живой читатель: assistant-service weeklyPlan (`where weekStart:d`) → AssistantContext.weeklyPlan → промпт. Новая цель сразу видна. get_weekly_plan tool тоже читает.
- Tool-шаблон: create-habit.ts (needsConfirm:false, дедуп, order=max+1, defineTool, register index.ts).
- Проактив-зеркало: v2-proactivity-engine.ts — NudgeSource union (:19), scoreSignificance switch (:64), TEMPLATES (:163), detectGoalNoProgress (:755), detectCandidates Promise.allSettled (:904), localDayOfWeek/getUserTimezone для «пятница/суббота».

## Задачи (TDD)

### T1 — `localWeekStartUTC(tz, at?)` (lib/tz.ts) + рефактор assistant-service (SSOT)
Pure: лок.дата → UTC-полночь понедельника. Тест: Almaty середина недели → понедельник 00:00Z той даты; воскресенье поздно лок. → всё ещё понедельник ТЕКУЩЕй (не следующей). Затем assistant-service.ts:146-147 заменить inline на `localWeekStartUTC(tz)` (то же значение — поведенческий тест gather не меняется). Коммит.

### T2 — `create_weekly_goal` tool (+ register + it)
Input `{goalText:string}` (aliases goal/text/title→goalText). needsConfirm:false. Handler: weekStart=localWeekStartUTC(tz); дедуп (skip если есть WeeklyGoal этой недели с тем же нормализованным goalText → вернуть «уже есть»); order=max(order)+1; create. Ответ «Цель недели записана: X. Сейчас N целей на эту неделю.» it-тест (real prisma): пишет на правильный weekStart; **кросс-домен** — gatherAssistantContext().weeklyPlan содержит цель (живой ридер); дедуп; cross-user. Коммит.

### T3 — `detectWeeklyGoalStall` проактив-детектор + проводка
Зеркало detectGoalNoProgress: читает user.timezone + WeeklyGoal текущей недели; если localDayOfWeek(tz)∈{5,6} (пт/сб) И есть незакрытые цели → NudgeCandidate{source:'weekly_goal_stall', payload:{open:N, total:M, sample:goalText}, toneHint:'gentle'}. Проводка: + 'weekly_goal_stall' в NudgeSource, scoreSignificance case (return ~0.6), TEMPLATES {gentle/supportive}, detectWeeklyGoalStall в detectCandidates allSettled. Тесты: пт + незакрытая → кандидат; среда → нет; всё закрыто → нет; exhaustiveness (union покрыт). Коммит.

### T4 — verify + независимое ревью
tsc + full suite зелёные; ревью (weekStart write↔read SSOT, дедуп, день-недели TZ-aware, детектор не спамит, exhaustiveness). Доклад + предложить деплой.
