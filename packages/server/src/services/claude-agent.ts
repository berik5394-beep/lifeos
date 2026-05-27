import Anthropic from '@anthropic-ai/sdk';
import { AiModelError } from '../lib/errors.js';
// SSOT 9A.8: агент-цикл больше НЕ ходит в legacy LOCAL_TOOLS/
// runLocalTool. Источник правды — реестр. agentToolSchemas =
// проекция реестра БЕЗ confirm-tools (security-инвариант там же).
import {
  agentToolSchemasForUser,
  agentToolNamesForUser,
  runRegistryTool,
} from '../tools/index.js';
import { convertCurrency } from './external-apis.js';

/**
 * #6 — детерминированная защита от рублей. Промт говорит «только ₸»,
 * но web_search тащит рос. сайты и модель не всегда слушается (видно
 * в проде раз за разом). Поэтому ПОСТ-обработка: если в финальном
 * тексте остались ₽/руб — конвертим по реальному курсу (Frankfurter,
 * бесплатно) и заменяем. Структурно, а не «надеемся на промт».
 * Сетевой вызов только если ₽ реально найдены.
 */
export function hasRub(text: string): boolean {
  return /₽|руб/i.test(text);
}

/** Чистая замена ₽-сумм на ₸ по курсу. Тестируется без сети (#6). */
export function convertRubInText(
  text: string,
  rate: number,
): { text: string; touched: boolean } {
  const RUB = /(\d[\d\s  ]*\d|\d)\s*(?:₽|руб(?:\.|лей|ля|ль)?|рубл(?:ей|я|ь))/gi;
  let touched = false;
  const out = text.replace(RUB, (_m: string, numRaw: string) => {
    const n = Number(String(numRaw).replace(/[\s  ]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return _m;
    touched = true;
    const v = String(Math.round(n * rate)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `≈ ${v} ₸`;
  });
  return {
    text: touched
      ? `${out}\n\n(цены приведены к ₸ по курсу ~${rate.toFixed(2)}₸/₽)`
      : out,
    touched,
  };
}

/**
 * Детерминированное добивание markdown. Промпт жёстко запрещает
 * разметку (жирный/курсив/заголовки/буллеты), но модель ВСЁ РАВНО
 * её шлёт — воспроизведено в проде на planner (Telegram рендерит
 * звёздочки буквально = уродство). Прецедент: enforceTenge
 * структурно добивает рубли, а не «надеется на промпт». Тут так же.
 * Чистая, тестируется без сети.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^\n*]+)\*\*/g, '$1') // **bold**
    .replace(/__([^\n_]+)__/g, '$1') // __bold__
    .replace(/(^|[\s(«"'])\*([^\n*]+)\*/g, '$1$2') // *italic*
    .replace(/(^|[\s(«"'])_([^\n_]+)_/g, '$1$2') // _italic_
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // ## заголовки
    .replace(/^\s*[-*•]\s+/gm, '— ') // буллеты → тире (стиль промпта)
    .replace(/`{1,3}([^`\n]+)`{1,3}/g, '$1'); // `code`
}

async function enforceTenge(text: string): Promise<string> {
  if (!hasRub(text)) return text;
  try {
    const r = await convertCurrency(1, 'RUB', 'KZT');
    if (!Number.isFinite(r.rate) || r.rate <= 0) return text;
    return convertRubInText(text, r.rate).text;
  } catch {
    return text; // курс недостал — текст не трогаем (лучше мусора)
  }
}

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
    // Phase 7: user-aware filter — tools у которых требуется
    // integration без активной → скрыты от агента (Relayna pattern).
    toolList.push(...(await agentToolSchemasForUser(userId)));
  }
  const tools =
    toolList.length > 0 ? (toolList as unknown as Anthropic.Tool[]) : undefined;

  const textParts: string[] = [];
  let response;

  // Агентный цикл: пока Claude просит локальный инструмент — выполняем
  // и продолжаем. web_search обрабатывает Anthropic (нам не возвращает
  // tool_use на исполнение), цикл крутится только на confirm-free
  // tools реестра (agentToolNames — security-инвариант: без денег).
  // Phase 7: симметрия с tool-list (фильтр по integrations) —
  // validation gate ровно для тех tools, что были показаны агенту.
  const localNames = userId
    ? await agentToolNamesForUser(userId)
    : new Set<string>();
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
      // 9A.8: диспетчеризация через реестр (zod-валидация + аудит
      // ToolCall — агент-цикл теперь тоже аудируется). Ошибку
      // отдельного tool НЕ роняем в весь цикл — возвращаем как
      // tool_result, агент может восстановиться/честно сказать.
      let out: string;
      let isError = false;
      try {
        const r = await runRegistryTool(
          tu.name,
          (tu.input as Record<string, unknown>) ?? {},
          { userId: userId as string },
        );
        // R9 honesty: success path. Handlers с graceful fallback
        // (get-email-triage, search-flights) уже сами возвращают
        // structured {connected:false, reason, message} — это валидный
        // success result для агента (он видит честный статус и решает).
        out = typeof r === 'string' ? r : JSON.stringify(r);
      } catch (e) {
        // R9 honesty #25 fix: structured JSON + is_error вместо русского
        // prose. Раньше "Ошибка инструмента X: ..." Claude мог interpret
        // как success result и врать «записал»/«готово». Теперь явное
        // {ok:false, error, tool} + Anthropic-native is_error:true —
        // модель знает что failure и не фабрикует success-ответ.
        out = JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          tool: tu.name,
        });
        isError = true;
      }
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: out,
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  if (!response) {
    throw new AiModelError(new Error('No Claude response'));
  }

  // FIX (Aydana 2026-05-22, redesigned R9 honesty #1 2026-05-27): если
  // цикл оборвался на maxToolRounds, а Claude всё ещё просил инструменты
  // (stop_reason='tool_use'), его последний content — это только tool_use
  // блоки БЕЗ текста. Тогда finalText пуст → throw → fallback врёт юзеру
  // «Действие НЕ выполнено», хотя в ToolCall-аудите видно: предыдущие
  // действия исполнились. Чтобы не врать, делаем доп. вызов БЕЗ tools.
  //
  // R9 honesty #1 redesign: РАНЬШЕ pushили fake tool_result.content =
  // "Лимит шагов: подведи итог тем, что уже сделал." — но эти tools НЕ
  // выполнены (только requested). Claude интерпретировал stub как
  // success → галлюцинировал «записал N задач» для невыполненных tools
  // (главный Aydana-баг: «записал 3 задачи» когда реально 0 на последнем
  // батче). Теперь РЕАЛЬНО выполняем pending tools через тот же
  // runRegistryTool dispatch (+ audit) — Claude видит честные results
  // и суммирует правду. Стоимость та же (+1 раунд Claude всё равно был).
  if (
    response.stop_reason === 'tool_use' &&
    !response.content.some((b) => b.type === 'text')
  ) {
    const lastTools = response.content.filter(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && localNames.has(b.name),
    );
    if (lastTools.length > 0) {
      messages.push({ role: 'assistant', content: response.content });
      // R9 honesty #1: РЕАЛЬНО выполняем pending tools (не stub).
      // Same dispatch pattern as main loop (lines 200-220) — единый
      // audit trail + structured failure через is_error:true.
      const realResults = [];
      for (const tu of lastTools) {
        let out: string;
        let isError = false;
        try {
          const r = await runRegistryTool(
            tu.name,
            (tu.input as Record<string, unknown>) ?? {},
            { userId: userId as string },
          );
          out = typeof r === 'string' ? r : JSON.stringify(r);
        } catch (e) {
          out = JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            tool: tu.name,
          });
          isError = true;
        }
        realResults.push({
          type: 'tool_result' as const,
          tool_use_id: tu.id,
          content: out,
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: 'user', content: realResults });
    }
    try {
      response = await anthropic.messages.create({
        model,
        max_tokens: 400,
        system,
        messages,
        // NO tools — заставляем выдать чистый текст (никаких новых
        // tool_use; модель суммирует РЕАЛЬНЫЕ результаты выше).
      });
    } catch (err) {
      throw new AiModelError(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
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
  // Структурное добивание разметки (промпт-правило не держится —
  // воспроизведено в проде), затем рубли. Оба — детерминированно.
  return enforceTenge(stripMarkdown(finalText));
}
