# ОДНА ПАМЯТЬ — M1 (Гибрид-захват) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать v2 эпизодическую память **полной** — каждое значимое действие приложения (создал задачу/расход/привычку/цель/журнал/событие **кнопкой в мобайле** ИЛИ через **чат-инструмент**) пишет лёгкое эпизодическое событие в **одну** v2-память. Сегодня в v2 пишет только чат-пайплайн; прямые mobile-CRUD действия теряются. После M1 робот-компаньон «знает» всё, что юзер делает вне чата. Legacy-память не трогаем. M1 НЕ добавляет ни одного вызова Claude.

**Architecture (гибрид — голова одна, руки докладывают с двух сторон):**
- **[A] chat/tool сторона — ОДИН хук-chokepoint.** Внутри `runRegistryTool` (`src/tools/index.ts`), после успешного исполнения любого write-инструмента, один вызов `captureActivity(ctx.userId, summarizeToolAction(name, parsedInput, result, tool.sideEffects))`. Покрывает ВСЕ существующие и будущие write-инструменты автоматически (мапинг по имени). Внешний контракт `runRegistryTool` неизменен — `parsed` выносится в `let parsedInput`, присваивается внутри audited-замыкания, читается после.
- **[B] mobile сторона — ОДИН вызов на mutation-роут.** В каждый mutation-роут (`src/routes/*.ts`) добавляется ровно одна строка `captureActivity(request.userId, { type, content })` перед `return`. Логика роута, валидация, транзакции, питомец-XP, budgetInfo, конфликты, **формат ответа** — БЕЗ изменений. Роуты НЕ переписываем и НЕ мигрируем в инструменты (они разошлись: `POST /tasks` имеет parentId/IDOR/notes/kanbanStatus/recurrence/tags/subtasks и возвращает полную задачу; `PATCH complete` — toggle в pet-XP транзакции; расходы считают budgetInfo; события ищут конфликты).
- **Оба пути** питают **одну** v2-память через **один** хелпер `captureActivity` → `recordEvent` (`episodic-memory.ts`). Fire-and-forget (`void … .catch`), за флагом `isV2MemoryEnabled(userId)`. Сбой захвата НИКОГДА не ломает действие/ответ. Off-флаг ⇒ поведение байт-в-байт текущее.
- Свободный текст чата → v2 full extraction (как сейчас, **не трогаем**). Полную миграцию роутов→инструменты откладываем (после удаления питомца, отдельный под-проект).

**Tech Stack:** packages/server, Fastify, Prisma, TypeScript strict, ESM NodeNext (`.js` в импортах), vitest. **Zero `vi.mock`.** Структурные тесты через `readFileSync`+grep (зеркало `src/services/jarvis-orchestrator-reliability.test.ts`), плюс pure unit для чистого хелпера. Commit-per-step, heredoc с `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. M1 НЕ добавляет Claude-вызовов. Все команды — из `packages/server`.

---

## File Structure

- **Create** `packages/server/src/services/tool-activity-summary.ts` — `summarizeToolAction` (pure, never throws) + `captureActivity` (fire-and-forget, flag-gated).
- **Create** `packages/server/src/services/tool-activity-summary.test.ts` — pure unit (каждый write-инструмент → type+content; read/unknown → null; garbage → no-throw; `captureActivity(null)` → no-op; структурно: flag-gate + `void recordEvent(…).catch(`).
- **Modify** `packages/server/src/tools/index.ts` — хук [A] в `runRegistryTool`.
- **Create** `packages/server/src/tools/registry-capture.test.ts` — структурный (хук присутствует, не await, через parsedInput).
- **Modify** `packages/server/src/routes/tasks.ts` + **Create** `src/routes/tasks-capture.test.ts`.
- **Modify** `packages/server/src/routes/finance.ts` + **Create** `src/routes/finance-capture.test.ts`.
- **Modify** `packages/server/src/routes/habits.ts` + **Create** `src/routes/habits-capture.test.ts`.
- **Modify** `packages/server/src/routes/journal.ts` + **Create** `src/routes/journal-capture.test.ts`.
- **Modify** `packages/server/src/routes/goals.ts` + **Create** `src/routes/goals-capture.test.ts`.
- **Modify** `packages/server/src/routes/events.ts` + **Create** `src/routes/events-capture.test.ts`.
- **Modify** (Task 9, cuttable) DELETE-роуты в tasks/habits/finance/goals/events + структурные тесты.

---

## Task 1: `tool-activity-summary.ts` — чистый хелпер + общий захват (фундамент)

**Files:**
- Create: `packages/server/src/services/tool-activity-summary.ts`
- Create (test): `packages/server/src/services/tool-activity-summary.test.ts`

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/services/tool-activity-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeToolAction, captureActivity } from './tool-activity-summary.js';

const SRC = readFileSync(join(__dirname, 'tool-activity-summary.ts'), 'utf8');

describe('summarizeToolAction — write tools → {type, content}', () => {
  it('create_task → task_created с title и date', () => {
    const r = summarizeToolAction(
      'create_task',
      { title: 'Купить хлеб', date: '2026-06-02', priority: 'high' },
      { taskId: 't1', message: 'ok' },
      'write',
    );
    expect(r?.type).toBe('task_created');
    expect(r?.content).toContain('Купить хлеб');
    expect(r?.content).toContain('2026-06-02');
  });

  it('complete_task → task_completed', () => {
    const r = summarizeToolAction(
      'complete_task',
      { title: 'Отчёт' },
      { taskId: 't1', message: 'Задача "Отчёт" выполнена ✅' },
      'write',
    );
    expect(r?.type).toBe('task_completed');
    expect(r?.content).toContain('Отчёт');
  });

  it('add_expense → expense_added с суммой и категорией', () => {
    const r = summarizeToolAction(
      'add_expense',
      { amount: 5000, category: 'food', description: 'продукты' },
      { expenseId: 'e1' },
      'write',
    );
    expect(r?.type).toBe('expense_added');
    expect(r?.content).toContain('5000');
    expect(r?.content).toContain('food');
  });

  it('add_income → income_added', () => {
    const r = summarizeToolAction(
      'add_income',
      { amount: 350000, source: 'зарплата' },
      { incomeId: 'i1' },
      'write',
    );
    expect(r?.type).toBe('income_added');
    expect(r?.content).toContain('350000');
    expect(r?.content).toContain('зарплата');
  });

  it('complete_habit → habit_logged', () => {
    const r = summarizeToolAction(
      'complete_habit',
      { name: 'бег' },
      { habitId: 'h1', message: 'Привычка "бег" отмечена ✅' },
      'write',
    );
    expect(r?.type).toBe('habit_logged');
    expect(r?.content).toContain('бег');
  });

  it('journal_entry → journal_logged', () => {
    const r = summarizeToolAction(
      'journal_entry',
      { sleepHours: 7, energy: 8, mood: 6 },
      { entryId: 'j1' },
      'write',
    );
    expect(r?.type).toBe('journal_logged');
    expect(r?.content).toContain('7');
  });

  it('create_event → event_created', () => {
    const r = summarizeToolAction(
      'create_event',
      { title: 'Встреча с Сериком', date: '2026-06-03', startTime: '14:00' },
      { eventId: 'ev1', updated: false },
      'write',
    );
    expect(r?.type).toBe('event_created');
    expect(r?.content).toContain('Встреча с Сериком');
    expect(r?.content).toContain('2026-06-03');
  });
});

describe('summarizeToolAction — null cases', () => {
  it('read-инструмент (sideEffects=read) → null даже у известного имени', () => {
    expect(
      summarizeToolAction('get_tasks', { date: '2026-06-01' }, [], 'read'),
    ).toBeNull();
  });

  it('неизвестное имя (write) → null', () => {
    expect(
      summarizeToolAction('frobnicate', { x: 1 }, {}, 'write'),
    ).toBeNull();
  });

  it('external sideEffects → null', () => {
    expect(
      summarizeToolAction('send_telegram', { text: 'hi' }, {}, 'external'),
    ).toBeNull();
  });
});

describe('summarizeToolAction — defensive, never throws', () => {
  it('garbage input не бросает (null/undefined/число вместо объекта)', () => {
    expect(() => summarizeToolAction('create_task', null, null, 'write')).not.toThrow();
    expect(() => summarizeToolAction('add_expense', 42, undefined, 'write')).not.toThrow();
    expect(() => summarizeToolAction('create_event', 'str', [], 'write')).not.toThrow();
    // важно: НЕ бросает — возвращает null или безопасную строку
    const r = summarizeToolAction('create_task', {}, {}, 'write');
    expect(r === null || typeof r.content === 'string').toBe(true);
  });
});

describe('captureActivity — fire-and-forget structural', () => {
  it('captureActivity(null) → no-op (не бросает)', () => {
    expect(() => captureActivity('user-1', null)).not.toThrow();
  });

  it('captureActivity за флагом isV2MemoryEnabled', () => {
    expect(SRC).toMatch(/isV2MemoryEnabled\(/);
  });

  it('recordEvent вызывается fire-and-forget (void + .catch), не await', () => {
    expect(SRC).toMatch(/void recordEvent\(/);
    expect(SRC).toMatch(/void recordEvent\([\s\S]{0,160}\.catch\(/);
    expect(SRC).not.toMatch(/await recordEvent\(/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/tool-activity-summary.test.ts`
Expected: FAIL (модуль `./tool-activity-summary.js` не существует).

- [ ] **Step 3: Implement** — создать `packages/server/src/services/tool-activity-summary.ts` (FULL):

```ts
import type { ToolSideEffects } from '../tools/_types.js';
import { recordEvent } from './episodic-memory.js';
import { isV2MemoryEnabled } from '../lib/feature-flags.js';

/**
 * ОДНА ПАМЯТЬ M1 — гибрид-захват, общий хелпер.
 *
 * `summarizeToolAction` — ЧИСТЫЙ маппер write-инструмента в лёгкое
 * эпизодическое событие (без сети/Prisma → юнит-тестируется, НИКОГДА
 * не бросает). `captureActivity` — общий fire-and-forget мост в v2
 * episodic, которым пользуются обе стороны гибрида: хук [A] в
 * runRegistryTool (chat/tool) и хуки [B] в mobile-роутах.
 *
 * Голос памяти единый: один словарь `type` для tool-хука и роутов.
 */

export type ActivitySummary = {
  type: string;
  content: string;
  importance?: number;
};

/** Безопасно достать строковое поле из неизвестного input/result. */
function str(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/** Безопасно достать числовое поле. */
function num(obj: unknown, key: string): number | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Чистый маппер: имя write-инструмента + распарсенный input + результат
 * → {type, content}. null когда:
 *   - sideEffects !== 'write' (read/external не захватываем);
 *   - имя неизвестно (не наш write-инструмент).
 * НИКОГДА не бросает — защитный доступ к полям, garbage → null или
 * безопасная строка.
 */
export function summarizeToolAction(
  name: string,
  input: unknown,
  result: unknown,
  sideEffects: ToolSideEffects,
): ActivitySummary | null {
  if (sideEffects !== 'write') return null;

  try {
    switch (name) {
      case 'create_task': {
        const title = str(input, 'title') ?? 'без названия';
        const date = str(input, 'date');
        const priority = str(input, 'priority');
        return {
          type: 'task_created',
          content:
            `Создал задачу «${title}»` +
            (date ? ` на ${date}` : '') +
            (priority ? `, приоритет ${priority}` : ''),
        };
      }
      case 'complete_task': {
        const title =
          str(input, 'title') ?? str(input, 'taskId') ?? 'задачу';
        return {
          type: 'task_completed',
          content: `Выполнил задачу «${title}»`,
        };
      }
      case 'add_expense': {
        const amount = num(input, 'amount');
        const category = str(input, 'category') ?? 'other';
        const desc = str(input, 'description');
        return {
          type: 'expense_added',
          content:
            `Расход ${amount ?? '?'} ₸ · ${category}` +
            (desc ? ` · ${desc}` : ''),
        };
      }
      case 'add_income': {
        const amount = num(input, 'amount');
        const source = str(input, 'source');
        return {
          type: 'income_added',
          content:
            `Доход ${amount ?? '?'} ₸` + (source ? ` · ${source}` : ''),
        };
      }
      case 'complete_habit': {
        const habit =
          str(input, 'name') ?? str(input, 'habitId') ?? 'привычку';
        return {
          type: 'habit_logged',
          content: `Отметил привычку «${habit}»`,
        };
      }
      case 'journal_entry': {
        const sleep = num(input, 'sleepHours');
        const energy = num(input, 'energy');
        const mood = num(input, 'mood');
        const parts: string[] = [];
        if (sleep !== undefined) parts.push(`сон ${sleep}ч`);
        if (energy !== undefined) parts.push(`энергия ${energy}`);
        if (mood !== undefined) parts.push(`настроение ${mood}`);
        return {
          type: 'journal_logged',
          content:
            'Дневник' + (parts.length ? `: ${parts.join(', ')}` : ' обновлён'),
        };
      }
      case 'create_event': {
        const title = str(input, 'title') ?? 'без названия';
        const date = str(input, 'date');
        const startTime = str(input, 'startTime');
        return {
          type: 'event_created',
          content:
            `Встреча «${title}»` +
            (date ? ` ${date}` : '') +
            (startTime ? ` в ${startTime}` : ''),
        };
      }
      default:
        return null;
    }
  } catch {
    // Маппер НЕ должен ронять горячий путь tool-исполнения.
    return null;
  }
}

/**
 * Общий fire-and-forget мост в v2 episodic. Используется хуком [A]
 * (runRegistryTool) и хуками [B] (mobile-роуты).
 *   - summary === null → no-op (read/unknown/нечего захватывать);
 *   - флаг off → no-op (поведение байт-в-байт текущее);
 *   - иначе void recordEvent(...).catch(...) — НЕ await, НЕ блокирует.
 * Сбой захвата НИКОГДА не ломает действие/ответ юзеру.
 */
export function captureActivity(
  userId: string,
  summary: ActivitySummary | null,
): void {
  if (!summary) return;
  if (!isV2MemoryEnabled(userId)) return;
  void recordEvent(userId, {
    type: summary.type,
    content: summary.content,
    importance: summary.importance,
  }).catch((e) => console.warn('[capture] recordEvent failed', e));
}
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/services/tool-activity-summary.test.ts`
Expected: PASS (все кейсы).

- [ ] **Step 5: tsc** — `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/tool-activity-summary.ts packages/server/src/services/tool-activity-summary.test.ts
git commit -F - <<'EOF'
feat(M1): tool-activity-summary — pure summarizeToolAction + fire-and-forget captureActivity (ОДНА ПАМЯТЬ M1 Task 1)

Чистый маппер write-инструмента → эпизодическое событие (never throws)
и общий flag-gated fire-and-forget мост в v2 episodic. Фундамент гибрид-
захвата: обе стороны (tool-хук [A] + mobile-роуты [B]) пишут через него.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Хук [A] в `runRegistryTool` — chokepoint для chat/tool стороны

**Files:**
- Modify: `packages/server/src/tools/index.ts` (`runRegistryTool`, строки ~347-370)
- Create (test): `packages/server/src/tools/registry-capture.test.ts`

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/tools/registry-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'index.ts'), 'utf8');

describe('runRegistryTool — хук [A] M1 capture (chokepoint)', () => {
  it('импортирует captureActivity и summarizeToolAction', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*captureActivity[^}]*\}/);
    expect(SRC).toMatch(/import\s*\{[^}]*summarizeToolAction[^}]*\}/);
  });

  it('parsed вынесен в let parsedInput (видим после audit)', () => {
    expect(SRC).toMatch(/let parsedInput/);
    expect(SRC).toMatch(/parsedInput = tool\.schema\.parse\(/);
  });

  it('captureActivity вызывается после успешного исполнения через summarizeToolAction', () => {
    expect(SRC).toMatch(
      /captureActivity\(\s*ctx\.userId,\s*summarizeToolAction\(/,
    );
    expect(SRC).toMatch(/summarizeToolAction\(\s*name,\s*parsedInput,\s*result,\s*tool\.sideEffects/);
  });

  it('захват НЕ await-ится (fire-and-forget — captureActivity сам void recordEvent)', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/tools/registry-capture.test.ts`
Expected: FAIL (нет импорта/вызова captureActivity).

- [ ] **Step 3: Implement** — в `packages/server/src/tools/index.ts`:

(a) Добавить импорт после строки `import { auditToolCall, type AuditSink } from '../services/tool-audit.js';`:

```ts
import { captureActivity, summarizeToolAction } from '../services/tool-activity-summary.js';
```

(b) Заменить тело `runRegistryTool`. **Было** (строки ~360-369):

```ts
  return auditToolCall(
    ctx.userId,
    name,
    rawInput,
    async () => {
      const parsed = tool.schema.parse(rawInput ?? {});
      return tool.handler(parsed, ctx);
    },
    sink,
  );
```

**Стало** (внешний контракт/возврат неизменны — добавлен `let parsedInput` снаружи и захват после audit):

```ts
  // M1 хук [A]: parsed выносим наружу, чтобы summarizeToolAction видел
  // input ПОСЛЕ успешного исполнения. Внешний контракт runRegistryTool
  // не меняется (тот же возврат result, тот же audit-инвариант «ровно
  // одна строка ToolCall»). parse остаётся ВНУТРИ audit-замыкания
  // (L99 #20: ZodError ловится audit-слоем).
  let parsedInput: unknown;
  const result = await auditToolCall(
    ctx.userId,
    name,
    rawInput,
    async () => {
      parsedInput = tool.schema.parse(rawInput ?? {});
      return tool.handler(parsedInput, ctx);
    },
    sink,
  );
  // Захват факта в v2 episodic — fire-and-forget (captureActivity сам
  // void recordEvent().catch). НЕ await, НЕ блокирует возврат. null для
  // read/external/неизвестных имён → no-op. Сбой захвата не ломает tool.
  captureActivity(ctx.userId, summarizeToolAction(name, parsedInput, result, tool.sideEffects));
  return result;
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/tools/registry-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression** — `npx vitest run src/tools/` → существующие tool-тесты (audit/honesty/money-safety) зелёные. Затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/tools/index.ts packages/server/src/tools/registry-capture.test.ts
git commit -F - <<'EOF'
feat(M1): хук [A] в runRegistryTool — chokepoint-захват write-инструментов в v2 (ОДНА ПАМЯТЬ M1 Task 2)

После успешного исполнения write-инструмента — fire-and-forget
captureActivity(summarizeToolAction(...)). Один chokepoint покрывает все
существующие/будущие write-инструменты. Внешний контракт runRegistryTool
и audit-инвариант неизменны (parsed вынесен в let parsedInput).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Хуки [B] в `routes/tasks.ts` — задачи (mobile)

**Files:**
- Modify: `packages/server/src/routes/tasks.ts`
- Create (test): `packages/server/src/routes/tasks-capture.test.ts`

Захватываем 4 mutation-роута: `POST /tasks` → `task_created`; `PATCH /tasks/:id/complete` → `task_completed` / `task_reopened` (по toggle); `PUT /tasks/:id` → `task_updated`; `PATCH /tasks/:id/kanban` → `task_kanban_moved`.

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/routes/tasks-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'tasks.ts'), 'utf8');

describe('routes/tasks — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/);
  });
  it('POST /tasks → task_created', () => {
    expect(SRC).toMatch(/captureActivity\(\s*request\.userId,\s*\{\s*type:\s*'task_created'/);
  });
  it('PATCH complete toggle → task_completed и task_reopened', () => {
    expect(SRC).toMatch(/'task_completed'/);
    expect(SRC).toMatch(/'task_reopened'/);
  });
  it('PUT /tasks/:id → task_updated', () => {
    expect(SRC).toMatch(/type:\s*'task_updated'/);
  });
  it('PATCH kanban → task_kanban_moved', () => {
    expect(SRC).toMatch(/type:\s*'task_kanban_moved'/);
  });
  it('captureActivity не await-ится (fire-and-forget)', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/routes/tasks-capture.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — в `packages/server/src/routes/tasks.ts`:

(a) Добавить импорт после `import { addXP } from './pet.js';`:

```ts
import { captureActivity } from '../services/tool-activity-summary.js';
```

(b) `POST /tasks` — перед `return reply.status(201).send(task);` (после `const task = await prisma.task.create(...)`):

```ts
    captureActivity(request.userId, {
      type: 'task_created',
      content: `Создал задачу «${task.title}» на ${data.date}`,
    });
    return reply.status(201).send(task);
```

(c) `PUT /tasks/:id` — после `if (!updated) throw new NotFoundError('Задача');`, перед `return reply.send(updated);`:

```ts
    if (!updated) throw new NotFoundError('Задача');
    captureActivity(request.userId, {
      type: 'task_updated',
      content: `Изменил задачу «${updated.title}»`,
    });
    return reply.send(updated);
```

(d) `PATCH /tasks/:id/complete` — toggle. `result.completed` отражает новое значение (`!task.completed`). После `if (!result) throw new NotFoundError('Задача');`, перед `return reply.send(result);`:

```ts
    if (!result) throw new NotFoundError('Задача');
    captureActivity(request.userId, {
      type: result.completed ? 'task_completed' : 'task_reopened',
      content: result.completed
        ? `Выполнил задачу «${result.title}»`
        : `Вернул задачу «${result.title}» в работу`,
    });
    return reply.send(result);
```

(e) `PATCH /tasks/:id/kanban` — `status` из тела. После `if (!result) throw new NotFoundError('Задача');`, перед `return reply.send(result);`:

```ts
    if (!result) throw new NotFoundError('Задача');
    captureActivity(request.userId, {
      type: 'task_kanban_moved',
      content: `Передвинул задачу «${result.title}» → ${status}`,
    });
    return reply.send(result);
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/routes/tasks-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/routes/tasks` (существующие task-route тесты зелёные — контракт ответа не тронут), затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/tasks.ts packages/server/src/routes/tasks-capture.test.ts
git commit -F - <<'EOF'
feat(M1): хуки [B] в routes/tasks — захват create/update/complete/kanban в v2 (ОДНА ПАМЯТЬ M1 Task 3)

По одной строке captureActivity перед каждым return. PATCH complete —
type из toggled result.completed (task_completed/task_reopened). Логика
роутов, питомец-XP, формат ответа — без изменений.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Хуки [B] в `routes/finance.ts` — финансы (mobile, money-safe)

**Files:**
- Modify: `packages/server/src/routes/finance.ts`
- Create (test): `packages/server/src/routes/finance-capture.test.ts`

3 mutation-роута: `POST /finance/expenses` → `expense_added`; `POST /finance/incomes` → `income_added`; `POST /finance/budget` → `budget_set`. Инвариант денег цел: логика/budgetInfo/валидация не меняются, добавляется только fire-and-forget факт.

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/routes/finance-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'finance.ts'), 'utf8');

describe('routes/finance — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/);
  });
  it('POST /finance/expenses → expense_added', () => {
    expect(SRC).toMatch(/type:\s*'expense_added'/);
  });
  it('POST /finance/incomes → income_added', () => {
    expect(SRC).toMatch(/type:\s*'income_added'/);
  });
  it('POST /finance/budget → budget_set', () => {
    expect(SRC).toMatch(/type:\s*'budget_set'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/routes/finance-capture.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — в `packages/server/src/routes/finance.ts`:

(a) Добавить импорт после `import { validate, parseMonth as validateMonth, invalidDateReply } from '../middleware/validate.js';`:

```ts
import { captureActivity } from '../services/tool-activity-summary.js';
```

(b) `POST /finance/expenses` — перед `return reply.status(201).send({ ...expense, ...(budgetInfo ? { budgetInfo } : {}) });`:

```ts
    captureActivity(request.userId, {
      type: 'expense_added',
      content: `Расход ${data.amount} ₸ · ${data.category} · ${data.description}`,
    });
    return reply.status(201).send({
      ...expense,
      ...(budgetInfo ? { budgetInfo } : {}),
    });
```

(c) `POST /finance/incomes` — перед `return reply.status(201).send(income);`:

```ts
    captureActivity(request.userId, {
      type: 'income_added',
      content: `Доход ${data.amount} ₸ · ${data.source}`,
    });
    return reply.status(201).send(income);
```

(d) `POST /finance/budget` — перед `return reply.status(201).send(budget);`:

```ts
    captureActivity(request.userId, {
      type: 'budget_set',
      content: `Лимит ${data.category}: ${data.monthlyLimit} ₸ (${data.month}/${data.year})`,
    });
    return reply.status(201).send(budget);
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/routes/finance-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/routes/finance` (контракт + budgetInfo не тронуты) и money-safety сюита зелёная, затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/finance.ts packages/server/src/routes/finance-capture.test.ts
git commit -F - <<'EOF'
feat(M1): хуки [B] в routes/finance — захват expense/income/budget в v2 (ОДНА ПАМЯТЬ M1 Task 4)

По одной строке captureActivity перед return. Деньги вводит юзер —
ИИ только запоминает факт; budgetInfo/валидация/ответ неизменны.
Инвариант «нет автономных денег у ИИ» не затронут.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Хуки [B] в `routes/habits.ts` — привычки (mobile)

**Files:**
- Modify: `packages/server/src/routes/habits.ts`
- Create (test): `packages/server/src/routes/habits-capture.test.ts`

3 mutation-роута: `POST /habits` → `habit_created`; `PUT /habits/:id` → `habit_updated`; `POST /habits/:id/log` → `habit_logged`.

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/routes/habits-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'habits.ts'), 'utf8');

describe('routes/habits — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/);
  });
  it('POST /habits → habit_created', () => {
    expect(SRC).toMatch(/type:\s*'habit_created'/);
  });
  it('PUT /habits/:id → habit_updated', () => {
    expect(SRC).toMatch(/type:\s*'habit_updated'/);
  });
  it('POST /habits/:id/log → habit_logged', () => {
    expect(SRC).toMatch(/type:\s*'habit_logged'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/routes/habits-capture.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — в `packages/server/src/routes/habits.ts`:

(a) Добавить импорт после `import { addXP } from './pet.js';`:

```ts
import { captureActivity } from '../services/tool-activity-summary.js';
```

(b) `POST /habits` — перед `return reply.status(201).send(habit);`:

```ts
    captureActivity(request.userId, {
      type: 'habit_created',
      content: `Новая привычка «${habit.name}»`,
    });
    return reply.status(201).send(habit);
```

(c) `PUT /habits/:id` — перед `return reply.send(updated);`:

```ts
    captureActivity(request.userId, {
      type: 'habit_updated',
      content: `Изменил привычку «${updated.name}»`,
    });
    return reply.send(updated);
```

(d) `POST /habits/:id/log` — `completed` приходит из тела; `habit.name` уже загружен ownership-проверкой. Перед `return reply.send(log);`:

```ts
    captureActivity(request.userId, {
      type: 'habit_logged',
      content: completed
        ? `Отметил привычку «${habit.name}»`
        : `Снял отметку с привычки «${habit.name}»`,
    });
    return reply.send(log);
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/routes/habits-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/routes/habits` (питомец-XP транзакция/ответ неизменны), затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/habits.ts packages/server/src/routes/habits-capture.test.ts
git commit -F - <<'EOF'
feat(M1): хуки [B] в routes/habits — захват create/update/log в v2 (ОДНА ПАМЯТЬ M1 Task 5)

По одной строке captureActivity перед return. log использует completed
из тела (отметил/снял). Питомец-XP транзакция и формат ответа неизменны.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Хук [B] в `routes/journal.ts` — дневник (mobile)

**Files:**
- Modify: `packages/server/src/routes/journal.ts`
- Create (test): `packages/server/src/routes/journal-capture.test.ts`

1 mutation-роут: `POST /journal` → `journal_logged`.

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/routes/journal-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'journal.ts'), 'utf8');

describe('routes/journal — M1 хук [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/);
  });
  it('POST /journal → journal_logged', () => {
    expect(SRC).toMatch(/type:\s*'journal_logged'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/routes/journal-capture.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — в `packages/server/src/routes/journal.ts`:

(a) Добавить импорт после `import { validate, parseDate, parseMonth, invalidDateReply } from '../middleware/validate.js';`:

```ts
import { captureActivity } from '../services/tool-activity-summary.js';
```

(b) `POST /journal` — перед `return reply.send(entry);` (после `const entry = await prisma.journalEntry.upsert(...)`). `data` имеет `sleepHours/energy/mood` (числа или null/undefined):

```ts
    const journalParts = [
      data.sleepHours != null ? `сон ${data.sleepHours}ч` : null,
      data.energy != null ? `энергия ${data.energy}` : null,
      data.mood != null ? `настроение ${data.mood}` : null,
    ].filter(Boolean);
    captureActivity(request.userId, {
      type: 'journal_logged',
      content:
        journalParts.length > 0
          ? `Дневник за ${data.date}: ${journalParts.join(', ')}`
          : `Дневник за ${data.date} обновлён`,
    });
    return reply.send(entry);
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/routes/journal-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/routes/journal`, затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/journal.ts packages/server/src/routes/journal-capture.test.ts
git commit -F - <<'EOF'
feat(M1): хук [B] в routes/journal — захват journal_logged в v2 (ОДНА ПАМЯТЬ M1 Task 6)

Одна строка captureActivity перед return; контент собирает сон/энергию/
настроение из data. Upsert-логика и формат ответа неизменны.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Хуки [B] в `routes/goals.ts` — цели (mobile)

**Files:**
- Modify: `packages/server/src/routes/goals.ts`
- Create (test): `packages/server/src/routes/goals-capture.test.ts`

4 mutation-роута: `POST /goals/weekly` → `weekly_goal_created`; `PUT /goals/weekly/:id` → `weekly_goal_updated`; `POST /goals/yearly` → `yearly_goal_created`; `PUT /goals/yearly/:id` → `yearly_goal_updated`.

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/routes/goals-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'goals.ts'), 'utf8');

describe('routes/goals — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/);
  });
  it('POST weekly → weekly_goal_created', () => {
    expect(SRC).toMatch(/type:\s*'weekly_goal_created'/);
  });
  it('PUT weekly → weekly_goal_updated', () => {
    expect(SRC).toMatch(/type:\s*'weekly_goal_updated'/);
  });
  it('POST yearly → yearly_goal_created', () => {
    expect(SRC).toMatch(/type:\s*'yearly_goal_created'/);
  });
  it('PUT yearly → yearly_goal_updated', () => {
    expect(SRC).toMatch(/type:\s*'yearly_goal_updated'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/routes/goals-capture.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — в `packages/server/src/routes/goals.ts`:

(a) Добавить импорт после `import { validate, parseDate, parseYear, invalidDateReply } from '../middleware/validate.js';`:

```ts
import { captureActivity } from '../services/tool-activity-summary.js';
```

(b) `POST /goals/weekly` — перед `return reply.status(201).send(goal);`:

```ts
    captureActivity(request.userId, {
      type: 'weekly_goal_created',
      content: `Цель недели «${goal.goalText}» (${data.weekStart})`,
    });
    return reply.status(201).send(goal);
```

(c) `PUT /goals/weekly/:id` — перед `return reply.send(updated);`:

```ts
    captureActivity(request.userId, {
      type: 'weekly_goal_updated',
      content: `Изменил цель недели «${updated.goalText}»`,
    });
    return reply.send(updated);
```

(d) `POST /goals/yearly` — перед `return reply.status(201).send(goal);`:

```ts
    captureActivity(request.userId, {
      type: 'yearly_goal_created',
      content: `Годовая цель «${goal.goalText}» (${data.area}, ${data.year})`,
    });
    return reply.status(201).send(goal);
```

(e) `PUT /goals/yearly/:id` — перед `return reply.send(updated);`:

```ts
    captureActivity(request.userId, {
      type: 'yearly_goal_updated',
      content: `Изменил годовую цель «${updated.goalText}»`,
    });
    return reply.send(updated);
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/routes/goals-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/routes/goals`, затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/goals.ts packages/server/src/routes/goals-capture.test.ts
git commit -F - <<'EOF'
feat(M1): хуки [B] в routes/goals — захват weekly/yearly create+update в v2 (ОДНА ПАМЯТЬ M1 Task 7)

По одной строке captureActivity перед return для 4 mutation-роутов целей.
Логика и формат ответа неизменны.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: Хуки [B] в `routes/events.ts` — события/встречи (mobile)

**Files:**
- Modify: `packages/server/src/routes/events.ts`
- Create (test): `packages/server/src/routes/events-capture.test.ts`

`POST /events` пишет **inline** (`prisma.calendarEvent.create`), НЕ через `create_event` tool, поэтому захватываем и его. 2 роута: `POST /events` → `event_created`; `PUT /events/:id` → `event_updated`. (Конфликты в ответе не трогаем — захват добавляется после `prisma.create`/`prisma.update`, до `reply.send`.)

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/routes/events-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'events.ts'), 'utf8');

describe('routes/events — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/);
  });
  it('POST /events → event_created (роут пишет inline, не через create_event tool)', () => {
    expect(SRC).toMatch(/type:\s*'event_created'/);
  });
  it('PUT /events/:id → event_updated', () => {
    expect(SRC).toMatch(/type:\s*'event_updated'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/routes/events-capture.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — в `packages/server/src/routes/events.ts`:

(a) Добавить импорт после `import { validate, parseDate, parseMonth as validateMonthRange, invalidDateReply } from '../middleware/validate.js';`:

```ts
import { captureActivity } from '../services/tool-activity-summary.js';
```

(b) `POST /events` — перед `return reply.status(201).send({ ...event, ...(conflicts.length > 0 ? { conflicts } : {}) });`:

```ts
      captureActivity(request.userId, {
        type: 'event_created',
        content: `Встреча «${event.title}» ${data.date}${data.startTime ? ' в ' + data.startTime : ''}`,
      });
      return reply.status(201).send({
        ...event,
        ...(conflicts.length > 0 ? { conflicts } : {}),
      });
```

(c) `PUT /events/:id` — перед `return reply.send({ ...updated, ...(conflicts.length > 0 ? { conflicts } : {}) });`:

```ts
      captureActivity(request.userId, {
        type: 'event_updated',
        content: `Изменил встречу «${updated.title}»`,
      });
      return reply.send({
        ...updated,
        ...(conflicts.length > 0 ? { conflicts } : {}),
      });
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/routes/events-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/routes/events` (конфликт-детекция/ответ неизменны), затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/events.ts packages/server/src/routes/events-capture.test.ts
git commit -F - <<'EOF'
feat(M1): хуки [B] в routes/events — захват create/update встреч в v2 (ОДНА ПАМЯТЬ M1 Task 8)

POST /events пишет inline (не через create_event tool) → захватываем
отдельно. По одной строке captureActivity перед return. Конфликт-
детекция и формат ответа неизменны.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9 (CUTTABLE — низкий приоритет): DELETE-роуты → `*_deleted`

> **Эту задачу можно отрезать без вреда ядру M1.** Удаления делают «голову» полной («убрал встречу с X»), но create/update/complete/log уже дают рабочий M1. Если время/риск поджимают — пропустить, ядро не страдает.

**Files:**
- Modify: `routes/tasks.ts`, `routes/habits.ts`, `routes/finance.ts`, `routes/goals.ts`, `routes/events.ts`
- Create (test): `packages/server/src/routes/deletes-capture.test.ts`

7 DELETE-роутов: `DELETE /tasks/:id` → `task_deleted`; `DELETE /habits/:id` → `habit_deleted` (soft-delete `active:false`, для памяти = «убрал привычку»); `DELETE /finance/expenses/:id` → `expense_deleted`; `DELETE /finance/incomes/:id` → `income_deleted`; `DELETE /goals/weekly/:id` → `weekly_goal_deleted`; `DELETE /goals/yearly/:id` → `yearly_goal_deleted`; `DELETE /events/:id` → `event_deleted`. (Импорт `captureActivity` в каждом файле уже добавлен в Tasks 3-8.)

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/routes/deletes-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('M1 DELETE-роуты → *_deleted захват (cuttable)', () => {
  it('tasks: task_deleted', () => {
    expect(read('tasks.ts')).toMatch(/type:\s*'task_deleted'/);
  });
  it('habits: habit_deleted', () => {
    expect(read('habits.ts')).toMatch(/type:\s*'habit_deleted'/);
  });
  it('finance: expense_deleted + income_deleted', () => {
    const s = read('finance.ts');
    expect(s).toMatch(/type:\s*'expense_deleted'/);
    expect(s).toMatch(/type:\s*'income_deleted'/);
  });
  it('goals: weekly_goal_deleted + yearly_goal_deleted', () => {
    const s = read('goals.ts');
    expect(s).toMatch(/type:\s*'weekly_goal_deleted'/);
    expect(s).toMatch(/type:\s*'yearly_goal_deleted'/);
  });
  it('events: event_deleted', () => {
    expect(read('events.ts')).toMatch(/type:\s*'event_deleted'/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/routes/deletes-capture.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — захват перед `return reply.send({ success: true });` каждого DELETE.

`routes/tasks.ts` (`DELETE /tasks/:id`) — объект задачи живёт внутри транзакции; минимально-инвазивно — захват по факту удаления с id:

```ts
    if (!deleted) throw new NotFoundError('Задача');
    captureActivity(request.userId, {
      type: 'task_deleted',
      content: `Убрал задачу (id ${id})`,
    });
    return reply.send({ success: true });
```

`routes/habits.ts` (`DELETE /habits/:id` — `habit` уже загружен ownership-проверкой):

```ts
    captureActivity(request.userId, {
      type: 'habit_deleted',
      content: `Убрал привычку «${habit.name}»`,
    });
    return reply.send({ success: true });
```

`routes/finance.ts` (`DELETE /finance/expenses/:id` — `expense` загружен):

```ts
    captureActivity(request.userId, {
      type: 'expense_deleted',
      content: `Убрал расход ${expense.amount} ₸ · ${expense.category}`,
    });
    return reply.send({ success: true });
```

`routes/finance.ts` (`DELETE /finance/incomes/:id` — `income` загружен):

```ts
    captureActivity(request.userId, {
      type: 'income_deleted',
      content: `Убрал доход ${income.amount} ₸ · ${income.source}`,
    });
    return reply.send({ success: true });
```

`routes/goals.ts` (`DELETE /goals/weekly/:id` — `goal` загружен):

```ts
    captureActivity(request.userId, {
      type: 'weekly_goal_deleted',
      content: `Убрал цель недели «${goal.goalText}»`,
    });
    return reply.send({ success: true });
```

`routes/goals.ts` (`DELETE /goals/yearly/:id` — `goal` загружен):

```ts
    captureActivity(request.userId, {
      type: 'yearly_goal_deleted',
      content: `Убрал годовую цель «${goal.goalText}»`,
    });
    return reply.send({ success: true });
```

`routes/events.ts` (`DELETE /events/:id` — `event` загружен):

```ts
    captureActivity(request.userId, {
      type: 'event_deleted',
      content: `Убрал встречу «${event.title}»`,
    });
    return reply.send({ success: true });
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/routes/deletes-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/routes/`, затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/tasks.ts packages/server/src/routes/habits.ts packages/server/src/routes/finance.ts packages/server/src/routes/goals.ts packages/server/src/routes/events.ts packages/server/src/routes/deletes-capture.test.ts
git commit -F - <<'EOF'
feat(M1): хуки [B] DELETE-роуты → *_deleted захват в v2 (ОДНА ПАМЯТЬ M1 Task 9, cuttable)

Удаления = события жизни «убрал X» — голова полная. Захват перед
return success; формат ответа неизменен.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 10: Финальная верификация + rollout-нота

**Files:** нет правок кода — только прогон сюиты и заметка.

- [ ] **Step 1: Полная сюита** — `npx vitest run`
Expected: ~1860+ зелёных (базовая сюита + новые capture-тесты), 0 fail. Money-safety и audit/honesty сюиты зелёные (контракты роутов и tool-возвраты не тронуты).

- [ ] **Step 2: Типы** — `npx tsc --noEmit` → clean (0 ошибок).

- [ ] **Step 3 (опц.): lint** — `npm run lint` (если в проекте настроен) → clean.

- [ ] **Step 4: Rollout-нота (БЕЗ действий без явного одобрения Berik):**
  - Всё — **локальные коммиты**. Push/deploy/флаг — ТОЛЬКО по явному «пушь/деплой» от Berik (правило honest-state: не заявлять prod-verified для непушнутой ветки).
  - Флаг уже `FEATURE_V2_MEMORY=all` (Railway) → захват активен для всех сразу после деплоя; off-флаг = байт-в-байт текущее поведение (rollback мгновенный).
  - **SMOKE (по факту БД, после деплоя и одобрения):** создать задачу/расход **mobile-роутом** (или прямым HTTP-вызовом роута) → проверить, что в `Memory` (source `v2-episodic`) появилась строка-событие (факт, НЕ нарратив). Затем спросить бота «что я сегодня делал» → бот должен знать действие, сделанное **вне чата**. То же для chat-инструмента (хук [A]): создать задачу через бота → строка `task_created` в БД.

---

## Self-review / spec coverage

| Spec § | Требование | Задача(и) |
|--------|-----------|-----------|
| §2.2 A | `summarizeToolAction` — pure, never throws, per-write-tool русский content, null для read/unknown | Task 1 |
| §2.2 B | `captureActivity` — fire-and-forget `void recordEvent(...).catch`, flag-gate `isV2MemoryEnabled`, null→no-op | Task 1 |
| §2.2 C | Хук [A] в `runRegistryTool` — `let parsedInput`, захват после успеха, внешний контракт цел, не await | Task 2 |
| §2.2 D | Хуки [B] в mobile-роутах — одна строка `captureActivity(request.userId, {type, content})` перед `return`, логика/ответ неизменны | Tasks 3-8 |
| §2.3 | Money-safety — финанс-роуты не меняются по логике, budgetInfo цел, инвариант «нет автономных денег» | Task 4 (+ Task 10 money-safety сюита) |
| §3 [A] | chokepoint ловит все write-инструменты (create_task, complete_task, add_expense, add_income, complete_habit, journal_entry, create_event + будущие) | Task 1 (мапинг) + Task 2 (хук) |
| §3 [B] | таблица роут→type→content (tasks, finance, habits, journal, goals, events, вкл. inline `POST /events`) | Tasks 3-8 |
| §3 [C] | DELETE-роуты → `*_deleted`, низкоприоритетные/cuttable | Task 9 |
| §4 | Границы — core-модули; steps/pet/non-core НЕ захватываются | Tasks 3-8 (только core-роуты тронуты); steps/pet не упомянуты by-construction |
| §5 | Degrade-safe — fire-and-forget, флаг off = байт-в-байт, роуты не переписаны | Task 1 (helper) + Tasks 3-8 (одна строка перед return) |
| §6 | Тесты — pure unit для summarizeToolAction, structural для captureActivity/хука/роутов, zero vi.mock, readFileSync+grep | Task 1 (unit+structural), Tasks 2-9 (structural), Task 10 (full suite) |
| §7 | Rollout — local commits, push/deploy/flag по одобрению Berik, SMOKE по факту БД | Task 10 |

**Не замапленные требования спеки:** нет. §2.1 (картина гибрида) отражена в **Architecture** заголовка. §8 (решения по границам: гибрид/нет питомца/deletes-low-prio/нет steps) реализованы распределённо — гибрид = вся структура (A=Task 2, B=Tasks 3-8), нет питомца/steps = эти роуты не трогаются by-construction, deletes-low-prio = Task 9 (cuttable). Спека НЕ требует кода для §1 (контекст) и self-review-чеклиста — это нарратив.
