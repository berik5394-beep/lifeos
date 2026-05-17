import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool, ToolContext } from './_types.js';
import { auditToolCall } from '../services/tool-audit.js';
import { getToday } from './get-today.js';
import { getWeatherTool } from './get-weather.js';

/**
 * SSOT migration Step 2 — реестр инструментов (единственный источник
 * правды). Сборка ЯВНАЯ через именованные импорты — `import * from './*'`
 * невалиден в ESM и скрывает дрейф от CI. Инструменты приезжают сюда
 * на Шагах 3 (read-only) / 5 (write) / 6 (деньги). На Шаге 2 список
 * пуст ПО ЗАМЫСЛУ — обкатываем инфраструктуру и drift-guard.
 */

// Шаг 3 (read-only). Write/деньги — Шаги 5/6.
const ALL_TOOLS: ReadonlyArray<Tool> = [
  getToday,
  getWeatherTool,
];

export const registry: ReadonlyMap<string, Tool> = new Map(
  ALL_TOOLS.map((t) => [t.name, t]),
);

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Anthropic tool schemas — автоген из zod-схем реестра. */
export function anthropicSchemas(): AnthropicToolSchema[] {
  return [...registry.values()].map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.schema, {
      target: 'openApi3',
      $refStrategy: 'none',
    }) as Record<string, unknown>,
  }));
}

/** Бывший рукописный CAPABILITY_TEXT — теперь автоген из реестра. */
export function capabilityText(): string {
  const vals = [...registry.values()];
  if (vals.length === 0) {
    return 'Инструменты пока не подключены.';
  }
  return vals.map((t) => `- ${t.name}: ${t.description}`).join('\n');
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
): Promise<unknown> {
  const tool = registry.get(name);
  if (!tool) throw new ToolNotFoundError(`Unknown tool: ${name}`);
  const parsed = tool.schema.parse(rawInput ?? {});
  return auditToolCall(ctx.userId, name, parsed, () =>
    tool.handler(parsed, ctx),
  );
}
