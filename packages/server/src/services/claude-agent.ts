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

  // Чистка артефактов web_search. Claude со сносками рвёт предложения на
  // строки + вставляет огрызки ("," "." "·" на своей строке). Юзер видел
  // "странные точки" и предложения в разнобой. Нормализуем:
  let cleaned = textParts
    .join('\n')
    // строки только из пунктуации/пробелов/цифр → пусто
    .replace(/^[\s.·•*\-–—()[\]\d,;:]{0,4}$/gm, '');

  // Склейка разорванных предложений: если строка начинается с строчной
  // буквы или продолжающей пунктуации (,;:)) — это хвост предыдущей,
  // а не новый абзац. Соединяем.
  const lines = cleaned.split('\n');
  const merged: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      if (merged.length && merged[merged.length - 1] !== '') merged.push('');
      continue;
    }
    const prev = merged.length ? merged[merged.length - 1] : '';
    const isContinuation = /^[a-zа-яё,;:)\-—]/.test(line);
    const prevOpen = prev && !/[.!?:»)]$/.test(prev) && prev !== '';
    if (prev && prev !== '' && isContinuation && prevOpen) {
      merged[merged.length - 1] = `${prev}${line.startsWith(',') || line.startsWith(';') || line.startsWith(':') ? '' : ' '}${line}`;
    } else {
      merged.push(line);
    }
  }

  const finalText = merged
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();

  if (!finalText) {
    throw new AiModelError(new Error('Empty Claude response (no text blocks)'));
  }
  return finalText;
}
