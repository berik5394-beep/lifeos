import Anthropic from '@anthropic-ai/sdk';
import { AiModelError } from '../lib/errors.js';

/**
 * Общий хелпер для агентных Claude-вызовов с web_search.
 *
 * Зачем: JARVIS должен думать и ИСКАТЬ в интернете вживую (цены билетов,
 * актуальная инфа), а не отвечать по обучающим данным 2024 года. Anthropic
 * даёт server-side tool `web_search_20250305` — Claude сам решает когда
 * искать, Anthropic выполняет поиск, модель продолжает с результатами.
 *
 * Ответ при web search — мультиблочный: text + server_tool_use +
 * web_search_tool_result + снова text. Этот хелпер вытаскивает финальный
 * связный текст из всех text-блоков.
 */

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

export interface AgentOptions {
  system: string;
  userMessage: string;
  /** Предыдущие реплики диалога для continuity (follow-up вопросы). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Включить web search (по умолчанию true — JARVIS должен искать). */
  webSearch?: boolean;
  /** Сколько поисков максимум за запрос (защита кошелька). */
  maxSearches?: number;
  maxTokens?: number;
  model?: string;
}

/**
 * Зовёт Claude с (опц.) web search, возвращает финальный текст.
 * Бросает AiModelError если ответа нет.
 */
export async function runAgent(opts: AgentOptions): Promise<string> {
  const {
    system,
    userMessage,
    history = [],
    webSearch = true,
    maxSearches = 3,
    maxTokens = 1024,
    model = 'claude-sonnet-4-20250514',
  } = opts;

  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: userMessage },
  ];

  // web_search — server tool. Передаём как any: типы SDK 0.39 его не знают,
  // но API принимает (проверено вживую — Claude реально ищет).
  const tools = webSearch
    ? ([{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }] as unknown as Anthropic.Tool[])
    : undefined;

  let response;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools ? { tools } : {}),
    });
  } catch (err) {
    throw new AiModelError(err instanceof Error ? err : new Error(String(err)));
  }

  // Собираем все text-блоки (при web search их несколько, между ними
  // server_tool_use / web_search_tool_result — их пропускаем).
  const textParts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    }
  }

  // Чистка артефактов web_search: между text-блоками остаются строки-
  // обрывки сносок (одинокие ".", "·", цифры в скобках, пустые строки).
  // Юзер жаловался на "странные точки" — убираем.
  const finalText = textParts
    .join('\n')
    // строки только из пунктуации/пробелов → удалить
    .replace(/^[\s.·•*\-–—()[\]\d]{0,3}$/gm, '')
    // 3+ переноса → 2
    .replace(/\n{3,}/g, '\n\n')
    // пробел перед точкой/запятой
    .replace(/ +([.,!?])/g, '$1')
    .trim();

  if (!finalText) {
    throw new AiModelError(new Error('Empty Claude response (no text blocks)'));
  }
  return finalText;
}
