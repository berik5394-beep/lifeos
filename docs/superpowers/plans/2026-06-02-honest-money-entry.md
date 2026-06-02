# Honest Money Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расход/доход ВСЕГДА записывается через детерминированный confirm-FSM (или честный отказ), никогда не сочиняется — включая многошаговый ввод «я потратил 100000» → «компьютер» → «да».

**Architecture:** (1) чистый `detectMoneyIntent` ловит сумму даже без ключевого слова в начале и не дефолтит категорию; (2) если категория/источник отсутствуют — оркестратор ставит durable pending-состояние «жду слот» (`__awaitingCategory`/`__awaitingSource` в input JSON, без миграции), доспрашивает детерминированной строкой, на ответ → обычный confirm → «да» → реестр; (3) правило в промпт запрещает заявлять о записи без вызова инструмента. Деньги ловятся ДО agent-пути.

**Tech Stack:** packages/server, TypeScript strict, ESM NodeNext (`.js`), vitest (zero vi.mock), pure helpers + structural tests (readFileSync+grep).

**Дисциплина:** test→red→impl→green→`npx tsc --noEmit`→commit на каждый шаг. Команды из `packages/server`. Commit heredoc + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Базовая сюита **2087** зелёная. Money-safety НЕ ломать (запись только по «да»→реестр).

---

## Файлы

- **Modify** `src/ai/intent-parser.ts` — +export `MoneyIntent` тип, +export pure `detectMoneyIntent`; `parseIntent` зовёт её вместо inline money-regex.
- **Create** `src/ai/intent-parser-money.test.ts` — unit-таблица детекта.
- **Modify** `src/services/pending-actions.ts` — +export pure `awaitingSlot`.
- **Modify** `src/services/pending-actions.test.ts` — +unit `awaitingSlot`.
- **Modify** `src/services/jarvis-orchestrator.ts` — awaiting-slot ветка в pending-блоке; ask-slot в EXECUTABLE для add_expense/add_income без слота; импорт `awaitingSlot`.
- **Create** `src/services/jarvis-money-fsm.test.ts` — structural на оркестратор-проводку.
- **Modify** `src/ai/jarvis-prompt.ts` — анти-фабрикация правило в CORE.
- **Create** `src/ai/jarvis-prompt-guard.test.ts` — structural на правило.

---

## Task 1: Pure `detectMoneyIntent` (CHECKPOINT)

**Files:**
- Modify: `src/ai/intent-parser.ts`
- Test: `src/ai/intent-parser-money.test.ts`

- [ ] **Step 1: Написать падающий unit-тест**

Создать `src/ai/intent-parser-money.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectMoneyIntent } from './intent-parser.js';

describe('detectMoneyIntent — надёжный детект денег', () => {
  it('одним сообщением со словом в начале + категория', () => {
    expect(detectMoneyIntent('потратил 15000 на одежду')).toEqual({
      action: 'add_expense', amount: 15000, category: 'одежду', description: 'одежду',
    });
  });
  it('ведущее слово «я» (живой баг) — ловится, категория ОТСУТСТВУЕТ', () => {
    expect(detectMoneyIntent('я потратил 100000')).toEqual({
      action: 'add_expense', amount: 100000,
    });
  });
  it('«сегодня купил на 3000 продукты»', () => {
    expect(detectMoneyIntent('сегодня купил на 3000 продукты')).toEqual({
      action: 'add_expense', amount: 3000, category: 'продукты', description: 'продукты',
    });
  });
  it('число+«на» без глагола → расход', () => {
    expect(detectMoneyIntent('5000 на такси')).toEqual({
      action: 'add_expense', amount: 5000, category: 'такси', description: 'такси',
    });
  });
  it('доход с ведущим словом, источник отсутствует', () => {
    expect(detectMoneyIntent('я получил зарплату 350000')).toEqual({
      action: 'add_income', amount: 350000,
    });
  });
  it('доход с источником', () => {
    expect(detectMoneyIntent('доход 50000 от фриланса')).toEqual({
      action: 'add_income', amount: 50000, source: 'фриланса',
    });
  });
  it('голое число без глагола → null (не ловим любые числа)', () => {
    expect(detectMoneyIntent('100000')).toBeNull();
  });
  it('не-деньги → null', () => {
    expect(detectMoneyIntent('какие задачи на сегодня')).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `cd packages/server && npx vitest run src/ai/intent-parser-money.test.ts`
Expected: FAIL — `detectMoneyIntent` не экспортирован.

- [ ] **Step 3: Реализовать `detectMoneyIntent`**

В `src/ai/intent-parser.ts` ДО `export async function parseIntent` (~line 240) добавить:

```ts
export type MoneyIntent =
  | { action: 'add_expense'; amount: number; category?: string; description?: string }
  | { action: 'add_income'; amount: number; source?: string };

/**
 * Чистый детект денег. Расширен против старого inline-prefilter:
 *  - допускает ведущие слова до money-слова (`(?:[а-яё]+\s+){0,3}?`) —
 *    «я потратил», «сегодня купил на» (живой баг: «я потратил 100000»
 *    мимо якоря ^ → чат-агент сочинял запись);
 *  - НЕ дефолтит категорию/источник в 'other'/'доход' — отсутствует,
 *    если не указан (оркестратор доспросит через FSM).
 *  Консервативно: нужен money-глагол + число (голое «100000» → null).
 *  [а-яё] (НЕ \w — кириллица).
 */
export function detectMoneyIntent(text: string): MoneyIntent | null {
  let m = text.match(
    /^(?:[а-яё]+\s+){0,3}?(?:запиши\s+)?(?:доход|получил[аи]?|заработал[аи]?|пришла зарплата|зарплат[ауы]?|преми[яю])\s+(?:[а-яё]+\s+){0,2}?(?:на\s+)?(\d[\d\s]*)\s*(?:тенге|тг|₸|руб|рублей)?\s*(?:от|за|—|-)?\s*(.*)$/i,
  );
  if (m) {
    const amount = Number(m[1].replace(/\s/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      const source = m[2].trim();
      return source
        ? { action: 'add_income', amount, source }
        : { action: 'add_income', amount };
    }
  }
  m =
    text.match(
      /^(?:[а-яё]+\s+){0,3}?(?:запиши\s+)?(?:расход|потратил[аи]?|потрачено|трата|купил[аи]?\s+на)\s+(?:на\s+)?(\d[\d\s]*)\s*(?:тенге|тг|₸|руб|рублей)?\s*(?:на|за|—|-)?\s*(.*)$/i,
    ) || text.match(/^(\d[\d\s]{2,})\s*(?:тенге|тг|₸)?\s+на\s+(.+)$/i);
  if (m) {
    const amount = Number(m[1].replace(/\s/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      const rest = m[2].trim();
      return rest
        ? { action: 'add_expense', amount, category: rest, description: rest }
        : { action: 'add_expense', amount };
    }
  }
  return null;
}
```

- [ ] **Step 4: Зелёный + tsc**

Run: `cd packages/server && npx vitest run src/ai/intent-parser-money.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit (CHECKPOINT — чистый детект готов)**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/ai/intent-parser.ts packages/server/src/ai/intent-parser-money.test.ts && git commit -F - <<'EOF'
feat(money): pure detectMoneyIntent — robust detect, no 'other' default

Catches amount even when the money keyword isn't at message start
("я потратил 100000") via a leading-words prefix, and stops defaulting
category/source — they are absent when unspecified so the orchestrator can
slot-fill. Conservative: needs money verb + number ("100000" alone → null).
8 unit cases.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Wire `detectMoneyIntent` into `parseIntent`

**Files:**
- Modify: `src/ai/intent-parser.ts` (money block ~:130-156)

- [ ] **Step 1: Заменить inline money-regex на вызов**

В `src/ai/intent-parser.ts` заменить ВЕСЬ блок от `// add_income: "получил...` (~:130) до конца expense-блока (закрывающая `}` после `return { action: 'add_expense', ... }`, ~:156) на:

```ts
  // SSOT Step 6 + #189: деньги ловим детерминированно (чистый
  // detectMoneyIntent — расширенный детект, без 'other'-дефолта).
  // Чат-агент денег не видит → не сочиняет запись.
  const money = detectMoneyIntent(text);
  if (money) return money;
```

(Комментарий SSOT Step 6 выше — оставить.)

- [ ] **Step 2: Найти и починить тесты на старый 'other'-дефолт**

Run: `cd packages/server && grep -rn "category: 'other'\|category:'other'" src --include="*.test.ts"`
Для каждого совпадения, где тест парсит расход БЕЗ категории и ждёт `category: 'other'` — обновить ожидание: категория ОТСУТСТВУЕТ (`detectMoneyIntent('потратил 5000')` → `{ action:'add_expense', amount:5000 }`). Если совпадений нет — пропустить.

- [ ] **Step 3: Прогнать intent-parser тесты + tsc**

Run: `cd packages/server && npx vitest run src/ai/ && npx tsc --noEmit`
Expected: PASS (money-кейсы идут через detectMoneyIntent), tsc 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/ai/intent-parser.ts && git commit -F - <<'EOF'
feat(money): parseIntent delegates money detection to detectMoneyIntent

Replaces the anchored inline money-regex with the robust pure detector.
Category/source now absent when unspecified (orchestrator slot-fills).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Orchestrator — `awaitingSlot` + ask-slot + slot-fill FSM

**Files:**
- Modify: `src/services/pending-actions.ts` (+`awaitingSlot`)
- Modify: `src/services/pending-actions.test.ts` (+unit)
- Modify: `src/services/jarvis-orchestrator.ts` (pending-блок + EXECUTABLE)
- Test: `src/services/jarvis-money-fsm.test.ts` (structural)

- [ ] **Step 1: Тест на pure `awaitingSlot`**

В `src/services/pending-actions.test.ts` добавить (импорт `awaitingSlot` в начало файла к существующим импортам из `./pending-actions.js`):

```ts
describe('awaitingSlot — состояние слот-филла', () => {
  const base = { action: 'add_expense', input: {}, confirmationText: 'q', createdAt: 0 };
  it('category', () => {
    expect(awaitingSlot({ ...base, input: { amount: 100, __awaitingCategory: true } })).toBe('category');
  });
  it('source', () => {
    expect(awaitingSlot({ ...base, action: 'add_income', input: { amount: 100, __awaitingSource: true } })).toBe('source');
  });
  it('обычный confirm-pending → null', () => {
    expect(awaitingSlot({ ...base, input: { amount: 100, category: 'еда' } })).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `cd packages/server && npx vitest run src/services/pending-actions.test.ts`
Expected: FAIL — `awaitingSlot` не экспортирован.

- [ ] **Step 3: Реализовать `awaitingSlot`**

В `src/services/pending-actions.ts` после `clearPendingAction` (~:113) добавить:

```ts
/**
 * Ждёт ли pending значение слота (категория расхода / источник дохода)?
 * Состояние — флаг в input JSON (durable, без миграции). Чистая.
 */
export function awaitingSlot(p: PendingAction): 'category' | 'source' | null {
  if (p.input.__awaitingCategory) return 'category';
  if (p.input.__awaitingSource) return 'source';
  return null;
}
```

- [ ] **Step 4: Зелёный (awaitingSlot)**

Run: `cd packages/server && npx vitest run src/services/pending-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Structural-тест на оркестратор-проводку**

Создать `src/services/jarvis-money-fsm.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('orchestrator — честный ввод денег (FSM слот-филл)', () => {
  it('импортирует и использует awaitingSlot', () => {
    expect(SRC).toContain('awaitingSlot');
  });
  it('слот-филл: заполняет слот и ставит обычный confirm-pending', () => {
    // в awaiting-ветке текст → setPendingAction со слотом + confirmationText
    expect(SRC).toMatch(/awaitingSlot\(pending\)[\s\S]*?setPendingAction[\s\S]*?confirmationText/);
  });
  it('ask-slot: расход без категории → __awaitingCategory', () => {
    expect(SRC).toContain('__awaitingCategory: true');
  });
  it('ask-slot: доход без источника → __awaitingSource', () => {
    expect(SRC).toContain('__awaitingSource: true');
  });
});
```

- [ ] **Step 6: Запустить — падает**

Run: `cd packages/server && npx vitest run src/services/jarvis-money-fsm.test.ts`
Expected: FAIL — проводки ещё нет.

- [ ] **Step 7: Добавить awaiting-slot ветку в pending-блок**

В `src/services/jarvis-orchestrator.ts`, в импорт из `./pending-actions.js` (где уже `peekPendingAction, takePendingAction, ... readConfirmSignal`) добавить `awaitingSlot`. Затем в `handleMessage` заменить начало pending-блока:

```ts
  const pending = await peekPendingAction(userId);
  if (pending) {
    const signal = readConfirmSignal(text);
```

на:

```ts
  const pending = await peekPendingAction(userId);
  if (pending) {
    const signal = readConfirmSignal(text);
    // #189 слот-филл: pending ждёт категорию (расход)/источник (доход).
    // Следующее сообщение = значение слота (или «отмена»). Детерминир.,
    // без LLM — деньги собираются и пишутся ТОЛЬКО через FSM.
    const slot = awaitingSlot(pending);
    if (slot) {
      if (signal === 'cancel') {
        await takePendingAction(userId);
        const reply = 'Окей, отменил — ничего не записал.';
        await saveTurn(userId, text, reply);
        return { reply, intent: 'cancel_pending' };
      }
      const filled: Record<string, unknown> = {
        amount: pending.input.amount,
        [slot]: text.trim(),
      };
      const ctext = confirmationText(pending.action, filled);
      await setPendingAction(userId, pending.action, filled, ctext);
      await saveTurn(userId, text, ctext);
      return {
        reply: ctext,
        pendingAction: { action: pending.action, input: filled },
        confirmationText: ctext,
        intent: pending.action,
      };
    }
```

(Остальное pending-блока — `if (signal === 'confirm')` … `await clearPendingAction(userId);` — БЕЗ изменений.)

- [ ] **Step 8: Добавить ask-slot в EXECUTABLE-ветку**

В `src/services/jarvis-orchestrator.ts`, перед строкой `const needsConfirm = toolConfirmRequired(intent.action, input);` (~:809) вставить:

```ts
    // #189 деньги без слота → детерминированно доспрашиваем категорию/
    // источник через FSM (сумма уже названа юзером), НЕ нарративом.
    if (intent.action === 'add_expense' && input.category == null) {
      const q = `На что потратил ${input.amount}₸? (или «отмена»)`;
      await setPendingAction(userId, 'add_expense', { amount: input.amount, __awaitingCategory: true }, q);
      await saveTurn(userId, text, q);
      return {
        reply: q,
        pendingAction: { action: 'add_expense', input: { amount: input.amount, __awaitingCategory: true } },
        confirmationText: q,
        intent: 'add_expense',
      };
    }
    if (intent.action === 'add_income' && input.source == null) {
      const q = `Откуда доход ${input.amount}₸? (или «отмена»)`;
      await setPendingAction(userId, 'add_income', { amount: input.amount, __awaitingSource: true }, q);
      await saveTurn(userId, text, q);
      return {
        reply: q,
        pendingAction: { action: 'add_income', input: { amount: input.amount, __awaitingSource: true } },
        confirmationText: q,
        intent: 'add_income',
      };
    }
```

- [ ] **Step 9: Зелёный + tsc**

Run: `cd packages/server && npx vitest run src/services/jarvis-money-fsm.test.ts && npx tsc --noEmit`
Expected: PASS (4 structural), tsc 0 (`awaitingSlot` импортирован, типы сходятся).

- [ ] **Step 10: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/pending-actions.ts packages/server/src/services/pending-actions.test.ts packages/server/src/services/jarvis-orchestrator.ts packages/server/src/services/jarvis-money-fsm.test.ts && git commit -F - <<'EOF'
feat(money): deterministic category/source slot-fill via confirm-FSM

When an expense has no category (or income no source), the orchestrator sets
a durable __awaitingCategory/__awaitingSource pending and asks deterministically;
the next message fills the slot → normal confirm pending → «да» → registry
write. Multi-turn money entry can no longer be fabricated by the chat path.
+awaitingSlot pure helper. No migration (state in PendingAction.input JSON).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Anti-fabrication prompt rule

**Files:**
- Modify: `src/ai/jarvis-prompt.ts`
- Test: `src/ai/jarvis-prompt-guard.test.ts`

- [ ] **Step 1: Structural-тест на правило**

Создать `src/ai/jarvis-prompt-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/ai/jarvis-prompt.ts'), 'utf-8');

describe('jarvis-prompt — анти-фабрикация записи', () => {
  it('правило «не заявляй о записи без вызова инструмента» в CORE', () => {
    expect(SRC).toMatch(/НИКОГДА не утверждай, что записал/);
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `cd packages/server && npx vitest run src/ai/jarvis-prompt-guard.test.ts`
Expected: FAIL — правила нет.

- [ ] **Step 3: Добавить правило в CORE**

В `src/ai/jarvis-prompt.ts` найти строку `Не описывай инструменты пользователю — просто пользуйся.` (~:118) и заменить на:

```ts
Не описывай инструменты пользователю — просто пользуйся. НИКОГДА не утверждай, что записал расход, доход, задачу или событие, если в этом ходе реально не вызвал соответствующий инструмент — если нужно записать, скажи, что записываешь через подтверждение, и не выдумывай суммы/итоги.
```

- [ ] **Step 4: Зелёный + tsc**

Run: `cd packages/server && npx vitest run src/ai/jarvis-prompt-guard.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/ai/jarvis-prompt.ts packages/server/src/ai/jarvis-prompt-guard.test.ts && git commit -F - <<'EOF'
feat(money): prompt rule — never claim a record without a tool call

Defense-in-depth: the agent/chat path must not narrate "recorded" for
expense/income/task/event unless the tool actually ran. Money still flows
through the deterministic FSM (this is a backstop for residual cases).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Финальная сверка + независимое ревью

**Files:** (нет правок кода — верификация)

- [ ] **Step 1: Полная сюита + tsc**

Run: `cd packages/server && npx vitest run && npx tsc --noEmit`
Expected: все зелёные (2087 + новые), tsc 0.

- [ ] **Step 2: Грепнуть money-safety инвариант цел**

Run: `cd packages/server && grep -n "runConfirmedAction\|needsConfirm" src/services/jarvis-orchestrator.ts | head`
Expected: запись add_expense/add_income по-прежнему ТОЛЬКО через runConfirmedAction (confirm-путь); ask-slot/slot-fill лишь СОБИРАЮТ вход до confirm.

- [ ] **Step 3: Независимое ревью**

Dispatch `superpowers:code-reviewer` на диффе Task 1-4 против спеки `docs/superpowers/specs/2026-06-02-honest-money-entry-design.md`. Инварианты: (1) money-safety — запись ТОЛЬКО по «да»→реестр, slot-fill не пишет; (2) detectMoneyIntent консервативен (голое число → null, не ловит не-деньги); (3) slot-fill завершается (нет вечного pending: cancel/TTL/смена-флага); (4) `__awaitingCategory`+«да» edge не падает; (5) одношаговые кейсы со словом в начале — без регресса; (6) нет циклов/унесённого pending. Исправить замечания, повторить до APPROVED.

- [ ] **Step 4: Обновить память/трекер**

Дописать в `~/.claude/projects/.../memory/remediation_plan_2026_06.md` статус «Честный ввод денег #189 — реализован, ждёт пуш/деплой» + предложить Berik «пуш и деплой».

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:**
- §3 надёжный детект (ведущие слова, без 'other') → Task 1 (detectMoneyIntent + 8 unit) + Task 2 (wire).
- §4 FSM слот-филл (ask + fill + confirm + record) → Task 3 (awaitingSlot + pending-ветка + ask-slot).
- §5 анти-фабрикация (роутинг + промпт) → роутинг = Task 2 (деньги ловятся до агента); промпт = Task 4.
- §6 краевые (cancel/TTL) → Task 3 (cancel-ветка; TTL наследуется от pending); §3 указывает «да»-edge берётся как категория (не падает).
- §7 симметрия доход → Task 3 (__awaitingSource + ask-slot income).
- §8 без флага/без миграции → ни одна задача не добавляет флаг/миграцию.
- §9 тесты → Task 1 (unit), Task 3 (awaitingSlot unit + structural FSM), Task 4 (structural).

**2. Placeholder scan:** нет TBD/«handle edge cases» — весь код приведён. Task 2 Step 2 — условная правка (grep, может быть 0 совпадений) — это поиск-и-замена с явным критерием, не плейсхолдер.

**3. Type consistency:** `MoneyIntent` (Task 1) ⊆ `VoiceIntent` (add_expense/add_income уже есть) → `parseIntent` возвращает `detectMoneyIntent` без касты (Task 2). `awaitingSlot(p: PendingAction): 'category'|'source'|null` (Task 3) — `slot` используется как ключ в `filled[slot]`. Возврат `{reply, pendingAction, confirmationText, intent}` совпадает с существующим PENDING-return оркестратора. `input.category == null` / `input.source == null` — `input = {...intent}`, поля отсутствуют когда detectMoneyIntent их не вернул.

---

## Execution Handoff

После сохранения — выбор исполнения (Subagent-Driven рекоменд. / Inline executing-plans). Безопасность: push/deploy ТОЛЬКО по явному «пуш и деплой» Berik; без флага, без миграции. SMOKE по факту прод-БД: «я потратил 100000» → «компьютер» → «да» → реальная Expense-строка (НЕ нарратив).
