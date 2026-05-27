import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool, ToolContext, IntegrationRequirement } from './_types.js';
import { prisma } from '../lib/prisma.js';
import { auditToolCall, type AuditSink } from '../services/tool-audit.js';
import { getToday } from './get-today.js';
import { getWeatherTool } from './get-weather.js';
import { getBudgetTool } from './get-budget.js';
import { getFreeSlotsTool } from './get-free-slots.js';
import { createTaskTool } from './create-task.js';
import { completeTaskTool } from './complete-task.js';
import { completeHabitTool } from './complete-habit.js';
import { completeMultipleHabitsTool } from './complete-multiple-habits.js';
import { createEventTool } from './create-event.js';
import { journalEntryTool } from './journal-entry.js';
import { addExpenseTool } from './add-expense.js';
import { addIncomeTool } from './add-income.js';
import { getTasksTool } from './get-tasks.js';
import { getCalendarTool } from './get-calendar.js';
import { getEmailTriageTool } from './get-email-triage.js';
import { recallPersonTool } from './recall-person.js';
import { getWeeklyPlanTool } from './get-weekly-plan.js';
import { getTripTool } from './get-trip.js';
import { searchFlightsTool } from './search-flights.js';
import { getGoalProgressTool } from './get-goal-progress.js';
import { getUserProfileTool } from './get-user-profile.js';
import { sendTelegramTool } from './send-telegram.js';
import { decomposeGoalTool } from './decompose-goal.js';
import { applyInsightTool } from './apply-insight.js';

/**
 * SSOT migration Step 2 — реестр инструментов (единственный источник
 * правды). Сборка ЯВНАЯ через именованные импорты — `import * from './*'`
 * невалиден в ESM и скрывает дрейф от CI. Инструменты приезжают сюда
 * на Шагах 3 (read-only) / 5 (write) / 6 (деньги). На Шаге 2 список
 * пуст ПО ЗАМЫСЛУ — обкатываем инфраструктуру и drift-guard.
 */

// Шаг 3 (read-only). Write/деньги — Шаги 5/6.
const ALL_TOOLS: ReadonlyArray<Tool> = [
  // read-only (Шаг 3)
  getToday,
  getWeatherTool,
  getBudgetTool,
  getFreeSlotsTool,
  // write, не-деньги (Шаг 5)
  createTaskTool,
  completeTaskTool,
  completeHabitTool,
  completeMultipleHabitsTool,
  createEventTool,
  journalEntryTool,
  // деньги, needsConfirm:true (Шаг 6)
  addExpenseTool,
  addIncomeTool,
  // external, needsConfirm:true (9B.2) — авто-исключён из агент-цикла
  sendTelegramTool,
  // planner (Phase 5 P2) — декомпозиция цели в дерево (заглушка, шаг 2)
  decomposeGoalTool,
  // P3/R8 — применение инсайта рефлектора ТОЛЬКО через confirm-гейт
  applyInsightTool,
  // agent-only read-tools, миграция 9A (claude-agent свич — 9A.8)
  getTasksTool,
  getCalendarTool,
  getEmailTriageTool,
  recallPersonTool,
  getWeeklyPlanTool,
  getTripTool,
  searchFlightsTool,
  getGoalProgressTool,
  // Phase 6 C2 — синтезированный профиль (read-only).
  getUserProfileTool,
];

// L99 #14 fix: load-time dup-name guard. Раньше `new Map(...)` silent
// last-wins для дубликатов — два tools с одним name терялись без следа.
// Теперь fail-loud на import (server вообще не стартует, лучше чем
// silent потеря tool из реестра).
{
  const names = ALL_TOOLS.map((t) => t.name);
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const n of names) {
    if (seen.has(n)) dups.push(n);
    seen.add(n);
  }
  if (dups.length > 0) {
    throw new Error(
      `Registry duplicate tool name(s): ${[...new Set(dups)].join(', ')}. ` +
        `ALL_TOOLS.length=${names.length}, unique=${seen.size}`,
    );
  }
}

export const registry: ReadonlyMap<string, Tool> = new Map(
  ALL_TOOLS.map((t) => [t.name, t]),
);

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * zod → Anthropic tool input_schema. ЕДИНЫЙ источник проекции
 * (anthropicSchemas + agentToolSchemas).
 *
 * 9A.8 incident: target:'openApi3' давал draft-4 `exclusiveMinimum:
 * true` (boolean) для z.number().positive()/.min — Anthropic требует
 * draft 2020-12 (там exclusiveMinimum — ЧИСЛО) → 400, агент-цикл
 * умирал. Default (jsonSchema7) даёт числовой exclusiveMinimum
 * (валиден и в 2020-12), но добавляет top-level `$schema:draft-07` —
 * срезаем (Anthropic валидирует как 2020-12 независимо; лишний
 * $schema — шум/риск). Guard: schema-anthropic-compat.test.ts.
 */
function toAnthropicInputSchema(
  schema: Parameters<typeof zodToJsonSchema>[0],
): Record<string, unknown> {
  const js = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<
    string,
    unknown
  >;
  delete js.$schema;
  return js;
}

/** Anthropic tool schemas — автоген из zod-схем реестра. */
export function anthropicSchemas(): AnthropicToolSchema[] {
  return [...registry.values()].map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toAnthropicInputSchema(t.schema),
  }));
}

/**
 * SECURITY INVARIANT: agent-loop schemas exclude every tool with
 * needsConfirm != false. Reason: the agent-loop is autonomous
 * (Claude picks tools without the user mid-confirm). Sensitive
 * actions (money: add_expense/add_income; external sends) MUST stay
 * on the orchestrator's confirm path, never executed silently by
 * the autonomous loop. If you add a tool that needs confirm — it is
 * AUTOMATICALLY excluded here (one registry, two projections: full
 * for the orchestrator, confirm-free for the agent). Do NOT add a
 * bypass without reviewing the security model. This comment must
 * survive refactors — the filter IS the invariant, not an accident.
 */
export function agentToolSchemas(): AnthropicToolSchema[] {
  return [...registry.values()]
    .filter((t) => t.needsConfirm === false)
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toAnthropicInputSchema(t.schema),
    }));
}

/** Имена tools, разрешённых автономному агент-циклу (см. инвариант). */
export function agentToolNames(): Set<string> {
  return new Set(
    [...registry.values()]
      .filter((t) => t.needsConfirm === false)
      .map((t) => t.name),
  );
}

/**
 * Phase 7 — integration availability check для tool-filter pattern
 * (Relayna). Pure: проверяет конкретный requirement против списка
 * активных integrations юзера.
 */
function integrationAvailable(
  req: IntegrationRequirement,
  integrations: Array<{ provider: string; refreshToken: string | null }>,
): boolean {
  if (req.kind === 'google_oauth') {
    // Gmail/Calendar — нужен активный google_calendar Integration
    // с refreshToken (без него API-вызов всё равно упадёт auth_failed).
    // L99 #2 fix: проверяем НЕ только null, но и пустую строку — после
    // revoke flows Prisma может оставить refreshToken = "", в этом
    // случае Phase 7 invariant ломался (tool в списке, API упадёт).
    return integrations.some(
      (i) =>
        i.provider === 'google_calendar' &&
        i.refreshToken != null &&
        i.refreshToken.trim().length > 0,
    );
  }
  if (req.kind === 'telegram_user_chat') {
    return integrations.some((i) => i.provider === 'telegram');
  }
  // Неизвестный kind — fail-closed (tool скрыт, безопаснее).
  return false;
}

/**
 * Phase 7 — user-aware версия agentToolSchemas. Фильтрует:
 *   1) `needsConfirm === false` (existing security gate — без денег)
 *   2) `requires` удовлетворены user's active integrations (новый
 *      hollow-tools gate — Relayna pattern)
 *
 * Tool без `requires` — всегда показывается (default behaviour).
 * Tool с `requires.kind='google_oauth'` без подключённого Google →
 * НЕ в списке → агент его не вызовет → не упадёт → friend-UX clean.
 */
export async function agentToolSchemasForUser(
  userId: string,
): Promise<AnthropicToolSchema[]> {
  const integrations = await prisma.integration.findMany({
    where: { userId, active: true },
    select: { provider: true, refreshToken: true },
  });
  return [...registry.values()]
    .filter((t) => t.needsConfirm === false)
    .filter((t) => !t.requires || integrationAvailable(t.requires, integrations))
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toAnthropicInputSchema(t.schema),
    }));
}

/**
 * Phase 7 — user-aware версия agentToolNames. Симметрия с
 * agentToolSchemasForUser — validation gate для tool_use ровно тех
 * tools, что были показаны агенту в текущей сессии.
 */
export async function agentToolNamesForUser(
  userId: string,
): Promise<Set<string>> {
  const integrations = await prisma.integration.findMany({
    where: { userId, active: true },
    select: { provider: true, refreshToken: true },
  });
  return new Set(
    [...registry.values()]
      .filter((t) => t.needsConfirm === false)
      .filter(
        (t) => !t.requires || integrationAvailable(t.requires, integrations),
      )
      .map((t) => t.name),
  );
}

/**
 * Промпт-блок ДЕЙСТВИЯ — автоген из реестра (бывший рукописный
 * CAPABILITY_TEXT). Не сырой дамп: поведенческое правило выводится
 * из needsConfirm АВТОРИТЕТНО (реестр = истина → промпт не может
 * соврать ни про набор tools, ни про режим). Обратимые
 * (needsConfirm=false) — делай сразу; всё, что требует confirm
 * (true или функция), — сначала подтверждение. Добавил tool —
 * правило применится само, дрейфа нет. (CONSTRAINTS_TEXT остаётся
 * рукописным в capabilities.ts — «чего НЕ делаю» из реестра не
 * выводится.)
 */
export function capabilityText(): string {
  const vals = [...registry.values()];
  if (vals.length === 0) return 'Инструменты пока не подключены.';
  const confirm = vals
    .filter((t) => t.needsConfirm !== false)
    .map((t) => t.name)
    .sort();
  const doNow = vals
    .filter((t) => t.needsConfirm === false)
    .map((t) => t.name)
    .sort();
  return (
    `Умеешь (реально, через инструменты): ${doNow.join(', ')}. ` +
    `Эти обратимы — делай сразу, не переспрашивай «создать?». ` +
    (confirm.length
      ? `Денежные/необратимые (${confirm.join(
          ', ',
        )}) — сначала подтверждение, дождись «да».`
      : '')
  );
}

/**
 * Бывший массив NEEDS_CONFIRM — теперь производное от реестра.
 * Только статическое needsConfirm:true. Функциональные гейты
 * (от input) решаются в рантайме confirm-FSM (Шаг 4).
 */
export function confirmAlwaysNames(): string[] {
  return [...registry.values()]
    .filter((t) => t.needsConfirm === true)
    .map((t) => t.name)
    .sort();
}

/** Имена реестра — для drift-guard и роутинга. */
export function registryToolNames(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Нужно ли подтверждение для этого вызова tool. Источник правды —
 * сам tool (boolean ИЛИ функция от input). Tool не в реестре →
 * false (решение о confirm для legacy остаётся у вызывающего).
 */
export function toolConfirmRequired(
  name: string,
  input: unknown,
): boolean {
  const tool = registry.get(name);
  if (!tool) return false;
  return typeof tool.needsConfirm === 'function'
    ? tool.needsConfirm(input)
    : tool.needsConfirm;
}

/**
 * Phase 5 P3/R8 — SECURITY INVARIANT для apply_insight. Рефлектор
 * ПРЕДЛАГАЕТ действие (Insight.suggestedAction); применение НИКОГДА
 * не обходит confirm-гейт (тот же инвариант 9B.2: деньги/внешнее не
 * исполняются автономно). Единый named-предикат, покрыт money-safety-
 * style тестом → «через confirm» доказано, не по намерению.
 *  - 'reject'  — действия нет в реестре (честный отказ, не выдумка);
 *  - 'confirm' — needsConfirm tool (деньги/внешнее) → ТОЛЬКО pending,
 *                юзер подтверждает «да», авто-исполнение ЗАПРЕЩЕНО;
 *  - 'execute' — обратимый (needsConfirm:false) → исполнить с аудитом.
 */
export function insightApplyDecision(
  action: string,
  input: unknown,
): 'reject' | 'confirm' | 'execute' {
  if (!registry.has(action)) return 'reject';
  return toolConfirmRequired(action, input) ? 'confirm' : 'execute';
}

export class ToolNotFoundError extends Error {}

/**
 * Единая точка исполнения tool из реестра: валидация входа zod-схемой
 * + аудит (ровно одна строка ToolCall на вызов). Confirm-гейт
 * подключается на Шаге 4 (read-only tools — needsConfirm:false).
 */
export async function runRegistryTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  sink?: AuditSink,
): Promise<unknown> {
  const tool = registry.get(name);
  if (!tool) throw new ToolNotFoundError(`Unknown tool: ${name}`);
  // L99 #20 fix: schema.parse внутри audit closure. Раньше parse
  // throws ZodError ДО auditToolCall — invariant «ровно одна строка
  // ToolCall на вызов» нарушался для validation failures (юзер видит
  // ошибку, но ToolCall row не создан → badges/honesty tests слепы).
  // Теперь любой throw (parse OR handler) ловится audit-layer.
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
}
