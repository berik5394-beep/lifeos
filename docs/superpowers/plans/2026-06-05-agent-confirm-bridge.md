# Agent Confirm-Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать `needsConfirm:true` инструменты достижимыми через чат-агент: агент видит confirm-схемы, но при их `tool_use` не исполняет — стейджит pending + детерминированный confirm-текст; на «да» исполняет существующим путём.

**Architecture:** Парная проекция реестра (`confirmToolSchemasForUser`/`confirmToolNamesForUser`) показывает confirm-tools агенту. `runAgent` принимает callback `onConfirmTool`; чистый `partitionToolUses` делит `tool_use` на executable/confirm; при confirm-proposal — ранний `return await onConfirmTool(...)` (НЕ исполняет). Orchestrator-callback делает `setPendingAction` + `buildConfirmPrompt`. «Да» → существующий `peekPendingAction → runConfirmedAction`.

**Tech Stack:** Fastify, Prisma 6, Anthropic SDK 0.39, TypeScript strict (ESM `.js`), vitest (zero vi.mock).

---

## ⚠️ ПРОД-ХОТ-ПАС + SECURITY
Это меняет агент-цикл — главный путь чата. **Инвариант:** confirm-tool НИКОГДА не доходит до `runRegistryTool` внутри `runAgent` (исполнение только executable-набора + только на явное «да» через `runConfirmedAction`). Без `onConfirmTool` поведение байт-идентично старому. Финал — независимое code-reviewer ревью ОБЯЗАТЕЛЬНО.

## File Structure

| Файл | Ответственность | Действие |
|---|---|---|
| `src/tools/index.ts` | `confirmToolSchemasForUser` + `confirmToolNamesForUser` | Modify |
| `src/tools/index.test.ts` (или новый) | проекции возвращают confirm-tools; executable не изменены | Create/Modify |
| `src/services/agent-tooluse.ts` | чистый `partitionToolUses` | Create |
| `src/services/agent-tooluse.test.ts` | юнит partitionToolUses | Create |
| `src/services/claude-agent.ts` | `onConfirmTool` param + перехват | Modify |
| `src/services/claude-agent.test.ts` (структурный) | onConfirmTool/confirm-schemas/no-exec guard | Create/Modify |
| `src/services/jarvis-orchestrator.ts` | `buildConfirmPrompt` + проброс onConfirmTool | Modify |
| `src/services/confirm-prompt.ts` | чистый `buildConfirmPrompt` (вынести для теста) | Create |
| `src/services/confirm-prompt.test.ts` | юнит buildConfirmPrompt | Create |
| `src/services/agent-confirm-bridge.it.test.ts` | стейдж→исполнение (тест-БД, без агента) | Create |

---

## Task 1: Парные confirm-проекции реестра

**Files:**
- Modify: `packages/server/src/tools/index.ts`
- Test: `packages/server/src/tools/confirm-projections.test.ts` (Create)

- [ ] **Step 1: Падающий тест**

`packages/server/src/tools/confirm-projections.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  confirmToolSchemasForUser,
  confirmToolNamesForUser,
  agentToolNamesForUser,
} from './index.js';

describe('confirm-проекции реестра', () => {
  it('confirmToolNamesForUser содержит needsConfirm:true tools и НЕ содержит confirm-free', async () => {
    const names = await confirmToolNamesForUser('test-user-xyz');
    // set_balance / clear_overdue — needsConfirm:true → должны быть
    expect(names.has('set_balance')).toBe(true);
    expect(names.has('clear_overdue')).toBe(true);
    // create_task — needsConfirm:false → НЕ должен быть в confirm-наборе
    expect(names.has('create_task')).toBe(false);
  });
  it('исполняемый набор (executable) НЕ изменён — confirm-tools там отсутствуют', async () => {
    const exec = await agentToolNamesForUser('test-user-xyz');
    expect(exec.has('set_balance')).toBe(false);
    expect(exec.has('clear_overdue')).toBe(false);
    expect(exec.has('create_task')).toBe(true);
  });
  it('confirmToolSchemasForUser возвращает схемы с теми же именами', async () => {
    const schemas = await confirmToolSchemasForUser('test-user-xyz');
    const names = schemas.map((s) => s.name);
    expect(names).toContain('set_balance');
    expect(names).not.toContain('create_task');
  });
});
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/tools/confirm-projections.test.ts`
Expected: FAIL — `confirmToolSchemasForUser is not exported`.

- [ ] **Step 3: Реализовать** — в `index.ts` сразу ПОСЛЕ `agentToolNamesForUser` добавить (зеркало, но `needsConfirm === true`):
```ts
/**
 * Confirm-проекция: needsConfirm:true tools для ПОКАЗА агенту как
 * proposable (агент их видит, но в цикле НЕ исполняет — стейджит).
 * Парна executable-проекции; integration-фильтр тот же.
 * Money-safety: эти tools исполняются ТОЛЬКО через runConfirmedAction на «да».
 */
export async function confirmToolSchemasForUser(
  userId: string,
): Promise<AnthropicToolSchema[]> {
  const integrations = await prisma.integration.findMany({
    where: { userId, active: true },
    select: { provider: true, refreshToken: true },
  });
  return [...registry.values()]
    .filter((t) => t.needsConfirm === true)
    .filter((t) => !t.requires || integrationAvailable(t.requires, integrations))
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toAnthropicInputSchema(t.schema),
    }));
}

/** Имена confirm-tools (needsConfirm:true) — для распознавания proposal в цикле. */
export async function confirmToolNamesForUser(
  userId: string,
): Promise<Set<string>> {
  const integrations = await prisma.integration.findMany({
    where: { userId, active: true },
    select: { provider: true, refreshToken: true },
  });
  return new Set(
    [...registry.values()]
      .filter((t) => t.needsConfirm === true)
      .filter(
        (t) => !t.requires || integrationAvailable(t.requires, integrations),
      )
      .map((t) => t.name),
  );
}
```

- [ ] **Step 4: GREEN + tsc** — Run: `cd packages/server && npx vitest run src/tools/confirm-projections.test.ts && npx tsc --noEmit`
Expected: PASS (3), чисто.

- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/tools/index.ts packages/server/src/tools/confirm-projections.test.ts
git commit -F - <<'EOF'
feat(tools): confirm-проекции реестра (needsConfirm:true) для агента

confirmToolSchemasForUser/confirmToolNamesForUser — показ confirm-tools
агенту как proposable. Executable-проекции (needsConfirm:false) не тронуты.
Money-safety: исполнение только через runConfirmedAction на «да».

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Чистый partitionToolUses

**Files:**
- Create: `packages/server/src/services/agent-tooluse.ts`
- Test: `packages/server/src/services/agent-tooluse.test.ts`

- [ ] **Step 1: Падающий тест**

`agent-tooluse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { partitionToolUses } from './agent-tooluse.js';

const tu = (name: string, id = name) => ({ type: 'tool_use', name, id, input: { x: 1 } });

describe('partitionToolUses', () => {
  const exec = new Set(['create_task', 'get_tasks']);
  const confirm = new Set(['set_balance', 'clear_overdue']);

  it('делит на executable и confirmProposals, игнорит прочее', () => {
    const blocks = [
      { type: 'text', text: 'hi' },
      tu('create_task'),
      tu('set_balance'),
      tu('unknown_tool'),
    ];
    const r = partitionToolUses(blocks as never[], exec, confirm);
    expect(r.executable.map((b) => b.name)).toEqual(['create_task']);
    expect(r.confirmProposals.map((b) => b.name)).toEqual(['set_balance']);
  });
  it('пустые наборы → всё игнор', () => {
    const r = partitionToolUses([tu('set_balance')] as never[], new Set(), new Set());
    expect(r.executable).toHaveLength(0);
    expect(r.confirmProposals).toHaveLength(0);
  });
  it('несколько confirm — все собираются (выбор первого — у вызывающего)', () => {
    const r = partitionToolUses([tu('set_balance'), tu('clear_overdue')] as never[], exec, confirm);
    expect(r.confirmProposals.map((b) => b.name)).toEqual(['set_balance', 'clear_overdue']);
  });
});
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/services/agent-tooluse.test.ts` → FAIL (module not found).

- [ ] **Step 3: Реализовать** — `agent-tooluse.ts`:
```ts
/**
 * Чистый делитель tool_use-блоков ответа агента на исполняемые
 * (needsConfirm:false, гоняются в цикле) и confirm-предложения
 * (needsConfirm:true, НЕ исполняются — стейджатся). Прочие имена игнор.
 * Без зависимостей — юнит-тестируется напрямую.
 */
export interface ToolUseLike {
  type: string;
  name: string;
  id: string;
  input: unknown;
}

export function partitionToolUses(
  blocks: ToolUseLike[],
  execNames: Set<string>,
  confirmNames: Set<string>,
): { executable: ToolUseLike[]; confirmProposals: ToolUseLike[] } {
  const executable: ToolUseLike[] = [];
  const confirmProposals: ToolUseLike[] = [];
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    if (execNames.has(b.name)) executable.push(b);
    else if (confirmNames.has(b.name)) confirmProposals.push(b);
  }
  return { executable, confirmProposals };
}
```

- [ ] **Step 4: GREEN + tsc** — Run: `cd packages/server && npx vitest run src/services/agent-tooluse.test.ts && npx tsc --noEmit` → PASS (3), чисто.

- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/agent-tooluse.ts packages/server/src/services/agent-tooluse.test.ts
git commit -F - <<'EOF'
feat(agent): pure partitionToolUses (executable vs confirm-proposal)

Чистый делитель tool_use-блоков. Под перехват confirm-tools в агент-цикле.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Перехват confirm-tools в runAgent

**Files:**
- Modify: `packages/server/src/services/claude-agent.ts`
- Test: `packages/server/src/services/claude-agent-confirm.test.ts` (Create, структурный)

- [ ] **Step 1: Падающий структурный тест**

`claude-agent-confirm.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(join(__dirname, 'claude-agent.ts'), 'utf8');

describe('claude-agent — confirm-bridge (structural)', () => {
  it('runAgent принимает onConfirmTool', () => {
    expect(SRC).toMatch(/onConfirmTool\?\s*:/);
  });
  it('показывает confirm-схемы агенту только при onConfirmTool', () => {
    expect(SRC).toMatch(/confirmToolSchemasForUser/);
    expect(SRC).toMatch(/confirmToolNamesForUser/);
  });
  it('использует partitionToolUses', () => {
    expect(SRC).toMatch(/partitionToolUses\(/);
  });
  it('confirm-proposal вызывает onConfirmTool, НЕ runRegistryTool', () => {
    // ранний return await onConfirmTool(...) для confirmProposals
    expect(SRC).toMatch(/onConfirmTool\(\s*[^)]*\.name/);
  });
});
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/services/claude-agent-confirm.test.ts` → FAIL.

- [ ] **Step 3a: Импорт + тип** — в `claude-agent.ts` добавить к импортам из `'../tools/index.js'` (рядом с `agentToolSchemasForUser`/`agentToolNamesForUser`):
```ts
  confirmToolSchemasForUser,
  confirmToolNamesForUser,
```
и импорт:
```ts
import { partitionToolUses } from './agent-tooluse.js';
```
В `interface AgentOptions` добавить поле:
```ts
  /**
   * Confirm-bridge: при tool_use confirm-tool агент НЕ исполняет его —
   * зовёт onConfirmTool(tool,args) (стейдж pending + текст) и возвращает
   * результат как финальный ответ. Без callback — confirm-tools скрыты.
   */
  onConfirmTool?: (tool: string, args: Record<string, unknown>) => Promise<string>;
```
В деструктуризацию `opts` добавить `onConfirmTool,`.

- [ ] **Step 3b: toolList + confirmNames** — после блока `if (localTools && userId) { toolList.push(...agentToolSchemasForUser) }` добавить:
```ts
  if (localTools && userId && onConfirmTool) {
    toolList.push(...(await confirmToolSchemasForUser(userId)));
  }
```
И рядом с `localNames`:
```ts
  const confirmNames =
    localTools && userId && onConfirmTool
      ? await confirmToolNamesForUser(userId)
      : new Set<string>();
```

- [ ] **Step 3c: Перехват в цикле** — заменить вычисление `toolUses` (строки ~191-194) на partition + ранний confirm-return. Найти:
```ts
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && localNames.has(b.name),
    );
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0 || round === maxToolRounds) {
      break;
    }
```
Заменить на:
```ts
    const { executable: toolUses, confirmProposals } = partitionToolUses(
      response.content as unknown as Array<{ type: string; name: string; id: string; input: unknown }>,
      localNames,
      confirmNames,
    ) as { executable: Anthropic.ToolUseBlock[]; confirmProposals: Array<{ name: string; input: unknown }> };
    // SECURITY-инвариант: confirm-tool НЕ исполняем в цикле. Стейдж + стоп.
    if (onConfirmTool && confirmProposals.length > 0) {
      const p = confirmProposals[0];
      return await onConfirmTool(p.name, (p.input as Record<string, unknown>) ?? {});
    }
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0 || round === maxToolRounds) {
      break;
    }
```

- [ ] **Step 4: GREEN + tsc + регрессия** — Run:
```bash
cd packages/server && npx vitest run src/services/claude-agent-confirm.test.ts && npx tsc --noEmit && npx vitest run src/services/claude-agent.test.ts 2>/dev/null; echo done
```
Expected: структурный PASS, tsc чисто. (Если есть существующие claude-agent тесты — зелёные; поведение без onConfirmTool идентично.)

- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/claude-agent.ts packages/server/src/services/claude-agent-confirm.test.ts
git commit -F - <<'EOF'
feat(agent): confirm-tool перехват в runAgent (onConfirmTool, не исполняет)

Агент видит confirm-схемы (за onConfirmTool); partitionToolUses делит
tool_use; confirm-proposal → ранний return onConfirmTool (стейдж), НЕ
runRegistryTool. Без callback — байт-идентично. SECURITY-инвариант цел.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Чистый buildConfirmPrompt

**Files:**
- Create: `packages/server/src/services/confirm-prompt.ts`
- Test: `packages/server/src/services/confirm-prompt.test.ts`

- [ ] **Step 1: Падающий тест**

`confirm-prompt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildConfirmPrompt } from './confirm-prompt.js';

describe('buildConfirmPrompt', () => {
  it('set_balance — со суммой', () => {
    expect(buildConfirmPrompt('set_balance', { balance: 500000 })).toMatch(/500000/);
    expect(buildConfirmPrompt('set_balance', { balance: 500000 })).toMatch(/да/i);
  });
  it('clear_overdue — про все просроченные', () => {
    expect(buildConfirmPrompt('clear_overdue', {})).toMatch(/просроч/i);
  });
  it('defer_overdue — про перенос', () => {
    expect(buildConfirmPrompt('defer_overdue', {})).toMatch(/перен/i);
  });
  it('log_decision — с заголовком', () => {
    expect(buildConfirmPrompt('log_decision', { title: 'нанять Х' })).toMatch(/нанять Х/);
  });
  it('review_decision — с заголовком и вердиктом', () => {
    const s = buildConfirmPrompt('review_decision', { title: 'поставщик A', verdict: 'worked' });
    expect(s).toMatch(/поставщик A/);
  });
  it('generic fallback для неизвестного tool', () => {
    expect(buildConfirmPrompt('some_new_tool', {})).toMatch(/some_new_tool|действие/i);
  });
  it('не падает на кривых args', () => {
    expect(() => buildConfirmPrompt('set_balance', {})).not.toThrow();
    expect(() => buildConfirmPrompt('log_decision', { title: 123 as never })).not.toThrow();
  });
});
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/services/confirm-prompt.test.ts` → FAIL.

- [ ] **Step 3: Реализовать** — `confirm-prompt.ts`:
```ts
/**
 * Детерминированный confirm-текст для confirm-tool (НЕ слова модели —
 * чтобы бот не врал «Записал!» до факта). Спец-кейсы + generic fallback.
 * Чистая, не падает. Money-safety: текст лишь предлагает, запись на «да».
 */
export function buildConfirmPrompt(
  tool: string,
  args: Record<string, unknown>,
): string {
  const s = (v: unknown): string => (v == null ? '' : String(v));
  switch (tool) {
    case 'set_balance':
      return `Записать текущий баланс ${s(args.balance)} ₸? Напиши «да» — сохраню.`;
    case 'clear_overdue':
      return 'Убрать ВСЕ просроченные задачи разом? Напиши «да» — уберу (обратимо).';
    case 'defer_overdue':
      return 'Перенести ВСЕ просроченные задачи на сегодня? Напиши «да».';
    case 'log_decision':
      return `Записать решение «${s(args.title)}»? Напиши «да».`;
    case 'review_decision':
      return `Зафиксировать исход «${s(args.title)}» (${s(args.verdict)})? Напиши «да».`;
    default:
      return `Выполнить действие ${tool}? Напиши «да» — сделаю.`;
  }
}
```

- [ ] **Step 4: GREEN + tsc** — Run: `cd packages/server && npx vitest run src/services/confirm-prompt.test.ts && npx tsc --noEmit` → PASS (7), чисто.

- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/confirm-prompt.ts packages/server/src/services/confirm-prompt.test.ts
git commit -F - <<'EOF'
feat(confirm): buildConfirmPrompt — детерминированный confirm-текст

Спец-кейсы set_balance/clear_overdue/defer_overdue/log/review_decision +
generic. Серверный текст вместо слов модели (не врёт «записал» до факта).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Проброс onConfirmTool в orchestrator

**Files:**
- Modify: `packages/server/src/services/jarvis-orchestrator.ts`
- Test: `packages/server/src/services/jarvis-confirm-bridge.test.ts` (Create, структурный)

- [ ] **Step 1: Падающий структурный тест**

`jarvis-confirm-bridge.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(join(__dirname, 'jarvis-orchestrator.ts'), 'utf8');

describe('jarvis-orchestrator — confirm-bridge wiring (structural)', () => {
  it('импортирует buildConfirmPrompt', () => {
    expect(SRC).toMatch(/buildConfirmPrompt/);
  });
  it('пробрасывает onConfirmTool в runAgent (стейдж + текст)', () => {
    expect(SRC).toMatch(/onConfirmTool:\s*async/);
    expect(SRC).toMatch(/setPendingAction\(userId,\s*tool,\s*args/);
  });
});
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/services/jarvis-confirm-bridge.test.ts` → FAIL.

- [ ] **Step 3a: Импорт** — в `jarvis-orchestrator.ts` добавить:
```ts
import { buildConfirmPrompt } from './confirm-prompt.js';
```

- [ ] **Step 3b: Проброс в основной runAgent (~1070)** — найти основной вызов `reply = await runAgent({` (тот, где `localTools: hermesForceTools || mayNeedLocalTools(text)`), добавить в объект опций поле:
```ts
        onConfirmTool: async (tool, args) => {
          const prompt = buildConfirmPrompt(tool, args);
          await setPendingAction(userId, tool, args, prompt);
          return prompt;
        },
```
(setPendingAction уже импортирован; формат pending `{action: tool, input: args}` совместим с peekPendingAction/runConfirmedAction.)

- [ ] **Step 4: GREEN + tsc** — Run: `cd packages/server && npx vitest run src/services/jarvis-confirm-bridge.test.ts && npx tsc --noEmit` → PASS (2), чисто.

- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/jarvis-orchestrator.ts packages/server/src/services/jarvis-confirm-bridge.test.ts
git commit -F - <<'EOF'
feat(orchestrator): проброс onConfirmTool в runAgent (стейдж confirm)

onConfirmTool → buildConfirmPrompt + setPendingAction. На «да» — существующий
peekPendingAction→runConfirmedAction. Confirm-tools теперь доходят через чат.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Интеграционный тест стейдж→исполнение (тест-БД, без агента)

**Files:**
- Create: `packages/server/src/services/agent-confirm-bridge.it.test.ts`

**Важно:** сам `runAgent` зовёт Anthropic → без vi.mock не гоняем. Покрываем КОНЕЦ моста: pending стейдж → «да» → реальное исполнение confirm-tool через `runConfirmedAction` (тот же путь, что после peekPendingAction).

- [ ] **Step 1: Тест**

`agent-confirm-bridge.it.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setPendingAction, peekPendingAction } from './pending-actions.js';
import { runConfirmedAction } from './jarvis-orchestrator.js';
import { buildConfirmPrompt } from './confirm-prompt.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'C', passwordHash: 'x' } });
  return u.id;
}

describe('confirm-bridge: стейдж → «да» → исполнение (без агента)', () => {
  it('clear_overdue: стейдж pending, затем confirmed → реально отменяет просрочки', async () => {
    const userId = await seedUser('cb-a@a.test');
    await prisma.task.create({
      data: { userId, title: 'старая', category: 'personal', priority: 'medium', date: new Date('2026-06-01'), completed: false },
    });
    // эмуляция onConfirmTool: стейдж
    const prompt = buildConfirmPrompt('clear_overdue', {});
    await setPendingAction(userId, 'clear_overdue', {}, prompt);
    const pend = await peekPendingAction(userId);
    expect(pend?.action).toBe('clear_overdue');
    // эмуляция «да»: исполнение тем же путём, что peek→runConfirmedAction
    await runConfirmedAction(userId, 'clear_overdue', {});
    const cancelled = await prisma.task.count({ where: { userId, cancelled: true } });
    expect(cancelled).toBe(1);
  });

  it('set_balance: confirmed → реально пишет CashSnapshot', async () => {
    const userId = await seedUser('cb-b@a.test');
    await setPendingAction(userId, 'set_balance', { balance: 500000 }, 'x');
    await runConfirmedAction(userId, 'set_balance', { balance: 500000 });
    const cnt = await prisma.cashSnapshot.count({ where: { userId } });
    expect(cnt).toBe(1);
  });
});
```

- [ ] **Step 2: Запустить (тест-БД)** — Run:
```bash
cd packages/server && npm run test:db:up && npx vitest run --project integration src/services/agent-confirm-bridge.it.test.ts
```
Expected: 2 passed. Если `set_balance`/`clear_overdue` требуют флаг `FEATURE_V2_RUNWAY_BALANCE` в хендлере — выставить `process.env.FEATURE_V2_RUNWAY_BALANCE='all'` в beforeEach (set_balance handler гейтит флагом; clear_overdue — нет). Добавить:
```ts
import { beforeEach } from 'vitest';
beforeEach(() => { process.env.FEATURE_V2_RUNWAY_BALANCE = 'all'; });
```

- [ ] **Step 3: tsc + commit**
```bash
cd packages/server && npx tsc --noEmit
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/agent-confirm-bridge.it.test.ts
git commit -F - <<'EOF'
test(confirm): behavioral стейдж→«да»→исполнение (clear_overdue/set_balance)

Тест-БД: setPendingAction → runConfirmedAction реально пишет (cancelled+1,
CashSnapshot+1). Покрывает конец моста (runAgent зовёт Anthropic — не гоним).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Финальная проверка + независимое ревью + rollout

**Files:** нет правок — верификация.

- [ ] **Step 1: Полный прогон** — Run: `cd packages/server && npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected: tsc чисто; Tests ≥ baseline 2367 + новые.

- [ ] **Step 2: Интеграция** — Run: `cd packages/server && npm run test:db:up && npm run test:it 2>&1 | tail -3`
Expected: все it зелёные (37 baseline + 2 новых).

- [ ] **Step 3: Negative-control (off=идентично)** — структурно подтвердить: без `onConfirmTool` в `runAgent` — `confirmNames` пуст, confirm-схемы не добавляются → старое поведение. Проверяется структурным тестом Task 3 (ветки за `onConfirmTool`).

- [ ] **Step 4: Независимое ревью (ОБЯЗАТЕЛЬНО — security + hot-path)**

Дать code-reviewer subagent весь diff фичи (`git diff` от базовой точки). Оси: (1) инвариант — confirm-tool НЕ доходит до `runRegistryTool` в цикле runAgent (ранний return); (2) off=идентично без callback; (3) pending-формат `{action,input}` совместим с peek/runConfirmedAction; (4) нет money-bypass — деньги пишутся только на «да»; (5) что при confirm-proposal + read-tools в одном раунде (stage+stop, reads не теряют деньги); (6) null-safety на `p.input`. Починить найденное.

- [ ] **Step 5: Rollout (по слову Berik)**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git push origin main
```
Дождаться deploy SUCCESS + health 200. SMOKE: «на счету 500000» → «Записать баланс 500000 ₸? да» → «да» → CashSnapshot+1 (проверить); «убери все просроченные» → confirm → «да» → cancelled растёт; «реши: беру поставщика A, проверь через месяц» → confirm → «да» → Decision+1.

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:** S1 проекции → T1 ✓. S2 перехват (partitionToolUses + onConfirmTool + ранний return) → T2+T3 ✓. S3 buildConfirmPrompt + проброс → T4+T5 ✓. S4 money-safety guard (структурный no-exec) → T3 структурный + T6 поведенческий ✓; независимое ревью → T7 ✓. Rollout → T7 ✓.

**2. Placeholder scan:** нет TBD — весь код приведён.

**3. Type consistency:** `confirmToolSchemasForUser`/`confirmToolNamesForUser` (T1 def, T3 use). `partitionToolUses(blocks,execNames,confirmNames)→{executable,confirmProposals}` (T2 def, T3 use). `onConfirmTool:(tool,args)=>Promise<string>` (T3 def, T5 use). `buildConfirmPrompt(tool,args)` (T4 def, T5/T6 use). Pending `{action,input}` — runConfirmedAction generic (существующий). Имена консистентны.

**Замечание:** интеграционный тест покрывает КОНЕЦ моста (стейдж→исполнение), не сам runAgent-цикл (зовёт Anthropic, vi.mock запрещён). Перехват в runAgent покрыт структурным + pure-partition тестами + независимым ревью — это принятый компромисс при zero-mock.
