# Откат денег из чата — spec+plan (audit P2 #1)

**Goal:** из чата можно удалить/исправить расход и удалить доход — money-safe (confirm-FSM) + СРАЗУ кросс-домен (пересчёт бюджета в ответе). Закрывает дыру «деньги без отката = доверие».

**Approved by Berik (да).** Server-only. Без флага (аддитивные tools, как set_budget/create_habit). Commit-per-step. Push/deploy — по слову.

## Паттерны (из explore, file:line)
- needsConfirm: `add-expense.ts:28`. Гейт `jarvis-orchestrator.ts:843-846` (`toolConfirmRequired` → ставит pending, handler бежит ТОЛЬКО на «да» через `runConfirmedAction:327`→`runRegistryTool`). confirmText: `jarvis-orchestrator.ts:304-321` (добавить кейсы).
- Кросс-домен: `analyzeBudgetAfterExpense(userId, category)` (`_finance.ts:9-67`) → `{spent,budgetLimit,percentage,daysLeft,warning,dailyRemaining}`. add_expense дописывает `analysis.warning` (`add-expense.ts:49-56`).
- REST-логика: delete expense `finance.ts:200-214`, delete income `finance.ts:257-271` (findFirst userId+id → delete + captureActivity).
- Матч: зеркало `matchHabit` (`_habit-match.ts:56-100`). Модели: Expense{id,date,category,description,amount}, Income{id,date,source,amount}.
- Регистрация: `index.ts` import + ALL_TOOLS (секция «деньги needsConfirm»).
- Пассивный кросс-домен УЖЕ живой: runway (`runway.ts:33`) + goal-impact (`goal-impact.ts:52`) читают live expense-суммы → удалённый расход сам отражается.

## Задачи (TDD: test→red→impl→green→tsc→commit)

### T1 — `_expense-match.ts` (pure, зеркало habit)
`matchExpense(query, items:{id,description,category,amount}[]): match|null` — fuzzy по description+category (реюз нормализации/стема/левенштейна из _habit-match если экспортнуто, иначе тонкая копия). Сумма-точное совпадение = высший тир. Ничья→null. Тест: «еда»→расход еды, «5000»→по сумме, мусор→null.

### T2 — `delete-expense.ts` (+ register + confirmText + it)
Input `{last?:boolean, description?, amount?, category?}`. `needsConfirm:true`. Handler (на «да»): резолв — `last` или пусто → последний по [date desc, createdAt desc]; иначе amount-exact + matchExpense. Промах → **throw** «не нашёл расход, вот последние: …». Найдено → `prisma.expense.delete` (где userId+id). **Кросс-домен:** `analyzeBudgetAfterExpense(cat)` → message «Убрал расход {amount} на {cat}. Теперь {spent}/{limit}, осталось {limit-spent}». confirmText кейс. it-test: создать 2 расхода → delete last → удалён + ответ с пересчётом; cross-user (чужой не трогается); промах→throws.

### T3 — `edit-expense.ts` (+ register + confirmText + it)
Input `{newAmount:number, description?, amount?, category?, last?}`. Резолв как T2 → `prisma.expense.update({amount:newAmount})` → recompute → «Изменил: было {old}, стало {newAmount}. На {cat} теперь {spent}/{limit}». confirmText. it.

### T4 — `delete-income.ts` (+ register + confirmText + it)
Input `{last?, source?, amount?}`. Резолв (последний/матч source) → delete. message «Убрал доход {amount} ({source})». (бюджет не трогаем — доход; но runway пассивно отразит). confirmText. it.

### T5 — verify + ревью
tsc + full suite зелёные; независимое ревью (money-safety: confirm-gate, ownership/IDOR, throw-честность, кросс-домен живой). Доклад + предложить деплой.
