import type Anthropic from '@anthropic-ai/sdk';

/**
 * Кэш промптов Anthropic. Каждый ход мозг слал заново ~58 схем инструментов
 * и длинный системный промпт (агент — 2–5 вызовов на ход с одинаковым
 * началом; парсер намерений — один и тот же промпт весь день). Метка
 * ephemeral кэширует префикс (инструменты → system) ~5 минут: дешевле и
 * быстрее. Меньше минимального размера — API метку просто игнорирует.
 */
const EPHEMERAL = { type: 'ephemeral' } as const;

/** Та же граница, что SYSTEM_CACHE_BREAK в ai/jarvis-prompt (без импорта — lib не тянет ai). */
const CACHE_BREAK = '\u0000cache-break\u0000';

/**
 * Системный промпт с меткой кэша. Если в тексте есть граница (buildJarvisPrompt):
 * неизменное начало — в кэш, хвост (время, контекст хода) — отдельным блоком
 * без метки. Иначе — весь текст в кэш, как раньше.
 */
export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  const i = text.indexOf(CACHE_BREAK);
  if (i < 0) return [{ type: 'text', text, cache_control: EPHEMERAL }];
  const head = text.slice(0, i).trimEnd();
  const tail = systemText(text.slice(i + CACHE_BREAK.length)).trim();
  return tail
    ? [{ type: 'text', text: head, cache_control: EPHEMERAL }, { type: 'text', text: tail }]
    : [{ type: 'text', text: head, cache_control: EPHEMERAL }];
}

/** Промпт одной строкой без границы кэша — для путей без cachedSystem. */
export function systemText(text: string): string {
  return text.split(`\n\n${CACHE_BREAK}\n\n`).join('\n\n').split(CACHE_BREAK).join('');
}

/** Метка на ПОСЛЕДНЕЙ схеме: кэшируется весь список инструментов перед ней. */
export function withCachedTools<T extends object>(tools: T[] | undefined): T[] | undefined {
  if (!tools || tools.length === 0) return tools;
  const last = tools[tools.length - 1];
  return [...tools.slice(0, -1), { ...last, cache_control: EPHEMERAL }];
}
