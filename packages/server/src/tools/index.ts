import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool } from './_types.js';

/**
 * SSOT migration Step 2 — реестр инструментов (единственный источник
 * правды). Сборка ЯВНАЯ через именованные импорты — `import * from './*'`
 * невалиден в ESM и скрывает дрейф от CI. Инструменты приезжают сюда
 * на Шагах 3 (read-only) / 5 (write) / 6 (деньги). На Шаге 2 список
 * пуст ПО ЗАМЫСЛУ — обкатываем инфраструктуру и drift-guard.
 */

// Шаг 3+: import { getToday } from './get-today.js'; ...
const ALL_TOOLS: ReadonlyArray<Tool> = [
  // (пусто на Шаге 2 — наполняется на Шагах 3/5/6)
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
