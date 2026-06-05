# log_goal_progress — чек-ин прогресса нечисловой цели (фикс HOLLOW)

**Дата:** 2026-06-05 · **Автор:** Claude + Berik · SERVER-only.

## Проблема (аудит P1 HOLLOW)
`suggest_goal` пишет духовную цель (`area='spirituality'`, `target=null`) — реально.
НО двинуть её прогресс нечем:
- `update_goal_progress` фильтрует `target:{not:null}` → нечисловую цель не находит.
- `detectGoalNoProgress` (v2-proactivity-engine.ts:755) читает ВСЕ цели по
  `updatedAt`, нудит после 14 дней молчания — включая духовные.
→ Вечный укор «14 дней без прогресса» без способа ответить = мёртвое обещание.

## Решение (keystone, реюз — без новой модели)
Новый агент-инструмент `log_goal_progress`: качественный чек-ин по любой годовой
цели (особенно нечисловой). Недостающий писатель оживляет уже-существующий
читатель `detectGoalNoProgress` — тот же паттерн, что set_budget ↔ budget-warning.

### Контракт
- Вход: `{ goalQuery: string(2..120), note: string(2..500), percent?: number(0..100) }`.
- aliases: goal/query→goalQuery, text/comment→note, progress→percent.
- needsConfirm:false, sideEffects:'write'. Без флага (новый инструмент всем).

### Handler
1. Резолв: `yearlyGoal.findMany {userId, year=текущий(tz), goalText contains goalQuery insensitive}` — БЕЗ target-фильтра. 0 → честный месседж; >1 → спросить какую.
2. `prisma.yearlyGoal.update data:{ progress: percent!=null ? clamp(0..100) : g.progress }` — запись (даже тем же значением progress) форсит `@updatedAt` → нуда `detectGoalNoProgress` сбрасывается. Managed-поле не трогаем вручную.
3. `captureActivity('goal_progress_logged', «Прогресс по «{goalText}»: {note}{ (pct%)}»)` → память (единый мозг видит духовный прогресс).
4. Ответ: «Записал прогресс по «{goalText}»: {note}.»[+ « Прогресс {pct}%.»] + мягкая строка.

### Кросс-домен
- Оживляет `detectGoalNoProgress` для нечисловых целей (честный цикл «нуда → ответ»).
- Заметка → captureActivity → память (духовное↔единый мозг), бот ссылается позже.

### Money-safety
Цели/духовное — не деньги. Деньги по-прежнему через confirm-FSM. Здесь — нет.

## Тесты
it (тест-БД): находит нечисловую цель (target=null), где update_goal_progress
пасует; percent→progress кламп; updatedAt сдвигается (нуда гаснет); ambiguity→ask;
0 целей→honest; cross-user изоляция; путь runRegistryTool (строковый percent).
Структурный: создаётся в ALL_TOOLS.

## Rollout
Коммит на шаг. Push/deploy — по слову Berik. Без флага. Baseline ~2473 unit зелёный.
