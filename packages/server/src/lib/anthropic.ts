import Anthropic from '@anthropic-ai/sdk';

/**
 * C2 (AUDIT-2026-06): единая фабрика Anthropic-клиента с таймаутом.
 *
 * Bug: 25 callsites делали `new Anthropic({ apiKey })` БЕЗ timeout. SDK
 * default = 600с timeout + 2 ретрая → при латенси/зависании Claude один
 * запрос держал соединение до ~10 мин (с ретраями — дольше), забивая пул
 * Fastify → приложение выглядело мёртвым во время любого инцидента Claude.
 *
 * Теперь — один источник. timeout 60с (с запасом на длинные ответы, но
 * далеко не 10 мин) + явный maxRetries. Меняем здесь — все callsites
 * автоматом. Structural lint (`anthropic-discipline.test.ts`) запрещает
 * `new Anthropic(` вне этого файла → CI красный ДО прод-деплоя.
 */
const ANTHROPIC_TIMEOUT_MS = 60_000;
const ANTHROPIC_MAX_RETRIES = 2;

/** Создаёт Anthropic-клиент с прод-таймаутом. apiKey опционален —
 *  по умолчанию берётся из process.env.CLAUDE_API_KEY. */
export function createAnthropic(apiKey?: string): Anthropic {
  return new Anthropic({
    apiKey: apiKey ?? process.env.CLAUDE_API_KEY ?? '',
    timeout: ANTHROPIC_TIMEOUT_MS,
    maxRetries: ANTHROPIC_MAX_RETRIES,
  });
}
