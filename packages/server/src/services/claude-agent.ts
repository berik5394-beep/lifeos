import Anthropic from '@anthropic-ai/sdk';
import { AiModelError } from '../lib/errors.js';
import { LOCAL_TOOLS, runLocalTool } from './agent-tools.js';

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
  /** Включить локальные инструменты (Phase 1.4). Требует userId. */
  localTools?: boolean;
  userId?: string;
  /** Максимум раундов tool-use (защита от петель/кошелька). */
  maxToolRounds?: number;
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
    localTools = false,
    userId,
    // Fix C: было 5 → до 6 вызовов Claude на один /voice/chat (против
    // aiDailyLimiter считается как 1 — амплификация стоимости). 3 раунда
    // покрывают реальные цепочки (календарь→задачи→событие) и режут
    // worst-case вдвое. Полный учёт раундов в дневной лимит — отдельно.
    maxToolRounds = 3,
  } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: userMessage },
  ];

  // web_search — server tool (Anthropic исполняет сам). Локальные
  // инструменты (Phase 1.4) — наши, их tool_use мы выполняем и
  // возвращаем tool_result в цикле. Типы SDK 0.39 web_search не знают.
  const toolList: unknown[] = [];
  if (webSearch) {
    toolList.push({ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches });
  }
  if (localTools && userId) {
    toolList.push(...LOCAL_TOOLS);
  }
  const tools =
    toolList.length > 0 ? (toolList as unknown as Anthropic.Tool[]) : undefined;

  const textParts: string[] = [];
  let response;

  // Агентный цикл: пока Claude просит локальный инструмент — выполняем
  // и продолжаем. web_search обрабатывает Anthropic (нам не возвращает
  // tool_use на исполнение), поэтому цикл крутится только на LOCAL_TOOLS.
  const localNames = new Set<string>(LOCAL_TOOLS.map((t) => t.name));
  for (let round = 0; round <= maxToolRounds; round++) {
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

    // Fix A: web_search может вернуть stop_reason 'pause_turn' (длинный
    // server-side поиск) — это НЕ конец, надо переслать ответ чтобы
    // продолжить. Раньше цикл (и старый одно-проходный код) на pause_turn
    // обрывался → юзер получал обрезанный ответ. Теперь продолжаем.
    // SDK 0.39 типы не знают 'pause_turn' (как и web_search) — рантайм
    // его возвращает. Сравниваем через string-каст.
    if ((response.stop_reason as string) === 'pause_turn' && round < maxToolRounds) {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && localNames.has(b.name),
    );
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0 || round === maxToolRounds) {
      break;
    }

    // Выполняем запрошенные локальные инструменты, возвращаем результаты.
    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const tu of toolUses) {
      const out = await runLocalTool(
        tu.name,
        (tu.input as Record<string, unknown>) ?? {},
        userId as string,
      );
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
    }
    messages.push({ role: 'user', content: results });
  }

  if (!response) {
    throw new AiModelError(new Error('No Claude response'));
  }

  // Финальный текст — из последнего ответа (после отработки инструментов).
  // Промежуточные «сейчас проверю…» в textParts не тянем.
  for (const block of response.content) {
    if (block.type === 'text') textParts.push(block.text);
  }

  // Чистка артефактов web_search. Claude со сносками рвёт предложения на
  // строки + вставляет огрызки ("," "." "·" на своей строке). Юзер видел
  // "странные точки" и предложения в разнобой. Нормализуем:
  let cleaned = textParts
    .join('\n')
    // сноски web_search: [1], [12], ¹²³ — мусор в чате, режем
    .replace(/\s*\[\d{1,3}\]/g, '')
    .replace(/[¹²³⁰-⁹]+/g, '')
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

  let finalText = merged
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();

  // Обрыв по лимиту токенов («…вы сами предлага») — не показываем
  // огрызок: режем до последней границы предложения, если она есть
  // достаточно далеко (не уничтожаем короткий валидный ответ).
  if (response.stop_reason === 'max_tokens') {
    const m = finalText.match(/^[\s\S]*[.!?…»)](?=\s|$)/);
    if (m && m[0].length >= finalText.length * 0.6) {
      finalText = m[0].trim();
    }
  }

  if (!finalText) {
    throw new AiModelError(new Error('Empty Claude response (no text blocks)'));
  }
  return finalText;
}
