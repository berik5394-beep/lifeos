import type Anthropic from '@anthropic-ai/sdk';

/**
 * Кэш промптов Anthropic. Каждый ход мозг слал заново ~58 схем инструментов
 * и длинный системный промпт (агент — 2–5 вызовов на ход с одинаковым
 * началом; парсер намерений — один и тот же промпт весь день). Метка
 * ephemeral кэширует префикс (инструменты → system) ~5 минут: дешевле и
 * быстрее. Меньше минимального размера — API метку просто игнорирует.
 */
const EPHEMERAL = { type: 'ephemeral' } as const;

export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text, cache_control: EPHEMERAL }];
}

/** Метка на ПОСЛЕДНЕЙ схеме: кэшируется весь список инструментов перед ней. */
export function withCachedTools<T extends object>(tools: T[] | undefined): T[] | undefined {
  if (!tools || tools.length === 0) return tools;
  const last = tools[tools.length - 1];
  return [...tools.slice(0, -1), { ...last, cache_control: EPHEMERAL }];
}
