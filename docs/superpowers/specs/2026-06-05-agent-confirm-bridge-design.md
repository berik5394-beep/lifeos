# Agent Confirm-Bridge — Design Spec

**Дата:** 2026-06-05
**Автор:** Berik + Claude (brainstorming)
**Статус:** одобрено Berik (4 секции, подход 1 + детерминированный текст + обновление инварианта)
**Скоуп:** SERVER-only (`packages/server`). Прод-хот-пас + security-инвариант — независимое ревью ОБЯЗАТЕЛЬНО.

## Проблема (доказана на проде)

`needsConfirm:true` инструменты реестра **недостижимы через чат**. Агент-цикл (`claude-agent.ts`) фильтрует `tool_use` по `localNames` (= `agentToolNamesForUser` = только `needsConfirm:false`). Когда модель зовёт confirm-инструмент (`set_balance`, `log_decision`, `review_decision`, `clear_overdue`, `defer_overdue`, `create_skill`), его `tool_use` **выпадает** из `toolUses` → не исполняется → цикл рвётся → остаётся преждевременный текст модели («Записываю!»). Legacy intent-parser знает только `add_expense`/`add_income`/`send_telegram`, остальные confirm-tools не покрывает.

**Доказательство:** прод-диагностика у Berik — `CashSnapshot=0`, `Decision=0`, `cancelledTasks=0` несмотря на бот-«успех». Юнит/it-тесты зелёные, потому что зовут handler напрямую, минуя чат-мост.

## Решение (подход A → механика 1: callback-инъекция)

Дать агенту **видеть** confirm-инструменты как «proposable», но при их `tool_use` — **НЕ исполнять**, а через инжектируемый callback `onConfirmTool(tool, args)` застейджить pending-action и вернуть **детерминированный** confirm-текст. На «да» — существующий `peekPendingAction → runConfirmedAction → runRegistryTool` (уже generic, ничего нового в исполнении).

**Money-safety инвариант (обновлён):** было — «агент НЕ ВИДИТ confirm-tools». Стало — «агент видит, но в цикле их НЕ ИСПОЛНЯЕТ: исполняемый набор (что реально гоняет `runRegistryTool` внутри цикла) остаётся `needsConfirm:false`; confirm-tools только предлагаются → стейдж → «да»». Деньги/записи в агент-цикле автоматически **не исполняются никогда**.

## Секция 1 — Проекции инструментов (`src/tools/index.ts`)

Существующие `agentToolSchemasForUser` / `agentToolNamesForUser` (фильтр `needsConfirm===false`) — **не трогаем** (это исполняемый набор). Добавляем ПАРНЫЕ проекции:
- `confirmToolSchemasForUser(userId)` — `needsConfirm===true` + integration-фильтр (как у исполняемых), → схемы для показа агенту.
- `confirmToolNamesForUser(userId)` — `needsConfirm===true` имена, → confirm-набор для распознавания в цикле.

Инвариант-комментарий обновить: «два набора — executable (`needsConfirm:false`, гоняются в цикле) и proposable (`needsConfirm:true`, только стейдж). Фильтр исполнения = executable-набор, ИНВАРИАНТ money-safety тут».

## Секция 2 — Перехват в агент-цикле (`src/services/claude-agent.ts`)

1. Чистый хелпер (в `claude-agent.ts` или соседнем pure-модуле, exported для теста):
   ```ts
   export function partitionToolUses(
     blocks: Array<{ type: string; name: string; id: string; input: unknown }>,
     execNames: Set<string>,
     confirmNames: Set<string>,
   ): { executable: ToolUseBlock[]; confirmProposals: ToolUseBlock[] }
   ```
   — делит `tool_use` блоки на исполняемые и confirm-предложения; прочие игнор.
2. `runAgent` сигнатура: добавить опциональный `onConfirmTool?: (tool: string, args: Record<string, unknown>) => Promise<string>`.
3. `toolList`: если `localTools && userId` — добавить И `confirmToolSchemasForUser(userId)` (агент видит обе группы). `confirmNames = onConfirmTool ? confirmToolNamesForUser(userId) : empty` (без callback — старое поведение, confirm-схемы не показываем).
4. В цикле после получения response: `partitionToolUses(response.content, localNames, confirmNames)`. Если `confirmProposals.length > 0` И `onConfirmTool`:
   - берём **первый** proposal, `const prompt = await onConfirmTool(p.name, p.input)`.
   - возвращаем `prompt` как финальный ответ (не пушим tool_result, НЕ исполняем proposal, цикл стоп). Read-tools этого раунда в этот ход не гоняем.
5. Исполняемые (`executable`) обрабатываются как сейчас (`runRegistryTool`). Если confirm-proposal есть — он приоритетнее: стейджим и выходим (один confirm-tool за ход).

Без `onConfirmTool` (или без `localTools`) — поведение **байт-идентично** старому (confirm-схемы не добавляются, `confirmNames` пуст).

## Секция 3 — Стейдж + детерминированный текст (`src/services/jarvis-orchestrator.ts`)

- Чистый `buildConfirmPrompt(tool: string, args: Record<string, unknown>): string` (exported, unit-тест):
  - спец-кейсы: `set_balance` → «Записать текущий баланс {balance} ₸? Напиши «да» — сохраню.»; `clear_overdue` → «Убрать ВСЕ просроченные задачи? Напиши «да».»; `defer_overdue` → «Перенести ВСЕ просроченные на сегодня? Напиши «да».»; `log_decision` → «Записать решение «{title}»? Напиши «да».»; `review_decision` → «Зафиксировать исход «{title}» ({verdict})? Напиши «да».».
  - generic-фоллбэк: «Выполнить действие {tool}? Напиши «да» — сделаю.».
- В `handleMessage`, при вызове `runAgent`, передаём:
  ```ts
  onConfirmTool: async (tool, args) => {
    const prompt = buildConfirmPrompt(tool, args);
    await setPendingAction(userId, tool, args, prompt);
    return prompt;
  }
  ```
- На «да» — **существующий** путь `peekPendingAction` (start ~445) → `runConfirmedAction` (generic `runRegistryTool`). Pending хранит `{action: tool, input: args}` — совместимо с текущим форматом. **Ничего нового в исполнении.**

## Секция 4 — Money-safety + тесты

- **Инвариант-guard (структурный):** в `claude-agent.ts` confirm-proposal НЕ доходит до `runRegistryTool` — тест grep'ом проверяет, что исполнение только для `executable`/`localNames`, а `confirmProposals` → `onConfirmTool` (не `runRegistryTool`).
- **Pure-юнит:** `partitionToolUses` (исполняемые/confirm/игнор-прочее; пустые наборы); `buildConfirmPrompt` (спец-кейсы + generic, без падений на кривых args).
- **Интеграционный (тест-БД, без агента):** стейдж→«да»→исполнение — `setPendingAction(userId,'clear_overdue',{},...)` затем эмуляция «да» через `runConfirmedAction(userId,'clear_overdue',{})` → реально отменяет просрочки. (Сам `runAgent` зовёт Anthropic → без vi.mock цикл не гоняем; покрываем стейдж и исполнение по отдельности + pure-хелперы.)
- **Структурный:** `onConfirmTool` проброшен в `runAgent` из orchestrator; `confirmToolSchemasForUser` добавлен в toolList за `localTools`; исполняемый набор (`needsConfirm===false` фильтр) не изменён.
- Baseline зелёный; tsc чисто. **Независимое code-reviewer ревью ОБЯЗАТЕЛЬНО** (security + hot-path): инвариант (confirm не исполняется в цикле), off=идентично без callback, pending-формат совместим, нет money-bypass.

## Rollout

Коммит на шаг (trailer `Co-Authored-By: Claude Opus 4.8 (1M context)`). После независимого ревью — push + deploy (по слову Berik; без флага — это исправление прод-поведения, но критичное → деплой осознанно). SMOKE: «на счету 500000» → «Записать баланс 500000? да» → «да» → реально пишется (CashSnapshot+1); «убери все просроченные» → confirm → «да» → cancelled растёт; «реши: …» → confirm → «да» → Decision+1.

## Не в скоупе

- Перевод `add_expense`/`add_income` со старого ручного пути на новый мост (работают — не трогаем; YAGNI).
- Batch-подтверждение нескольких confirm-tools за раз (по одному).
- Мобильные экраны для balance/decisions (отдельная инициатива).
- Расхождение «бот сказал 121, в БД 9» — отдельная мелкая проверка (вне этого фикса).
