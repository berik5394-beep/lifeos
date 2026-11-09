import { recordUsage, usageFromClaudeJson, usageFromClaudeStream } from './ai-usage.js';
import { classifyFailure, reportProviderFailure, type ProviderName } from './ops-alert.js';

type FetchFn = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * fetch для SDK провайдеров: ответ отдаётся SDK как есть, а копия читается
 * в фоне — неуспех → оповещение (lib/ops-alert), успех → расход токенов
 * (lib/ai-usage). Ничего из этого не может сломать сам вызов.
 */
export function observedFetch(provider: ProviderName, base: FetchFn = fetch): FetchFn {
  return async (url, init) => {
    let res: Response;
    try {
      res = await base(url, init);
    } catch (err) {
      // Сеть / таймаут: SDK сам ретраит; пачку таких считаем «сервис падает».
      reportProviderFailure(provider, 599, err instanceof Error ? err.message : String(err));
      throw err;
    }
    try {
      observe(provider, String(url instanceof Request ? url.url : url), res.clone());
    } catch {
      /* наблюдение не должно мешать ответу */
    }
    return res;
  };
}

function observe(provider: ProviderName, url: string, copy: Response): void {
  if (!copy.ok) {
    void copy
      .text()
      .catch(() => '')
      .then((body) => {
        // Сбой тоже пишем в счётчик (модель «error:вид») — утренняя сводка считает их за день.
        recordUsage({ provider, model: `error:${classifyFailure(copy.status, body)}` });
        reportProviderFailure(provider, copy.status, body.slice(0, 2000));
      });
    return;
  }
  if (provider === 'groq') {
    // Whisper: Groq берёт за секунды звука (минимум 10 с на запрос) — считаем вызовы.
    if (url.includes('/audio/')) recordUsage({ provider: 'groq', model: 'whisper' });
    void copy.body?.cancel().catch(() => {});
    return;
  }
  if (!url.includes('/messages') || url.includes('count_tokens')) {
    void copy.body?.cancel().catch(() => {});
    return;
  }
  const type = copy.headers.get('content-type') ?? '';
  void copy
    .text()
    .then((text) => {
      const delta = type.includes('event-stream') ? usageFromClaudeStream(text) : usageFromClaudeJson(safeJson(text));
      if (delta) recordUsage(delta);
    })
    .catch(() => {});
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
