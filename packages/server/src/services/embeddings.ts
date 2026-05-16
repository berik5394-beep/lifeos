/**
 * Phase 2.3 — семантические эмбеддинги через Voyage AI.
 *
 * voyage-3-lite: 512-мерный, мультиязычный (хорошо понимает русский —
 * важно, память на русском), дешёвый, щедрый бесплатный тир.
 *
 * input_type различает «документ» (запись в память) и «запрос» (поиск)
 * — Voyage оптимизирует асимметрично, это заметно улучшает retrieval.
 *
 * Без VOYAGE_API_KEY возвращаем null — вызывающий код тихо падает на
 * чистый FTS (семантика опциональна, не критична).
 */

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-lite';
export const EMBED_DIM = 512;
const TIMEOUT_MS = 12_000;

export function embeddingsEnabled(): boolean {
  return !!process.env.VOYAGE_API_KEY;
}

async function embed(
  text: string,
  inputType: 'document' | 'query',
): Promise<number[] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;
  const clean = text.trim().slice(0, 8000);
  if (!clean) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: [clean], model: MODEL, input_type: inputType }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[embeddings] Voyage ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const vec = data.data?.[0]?.embedding;
    return vec && vec.length === EMBED_DIM ? vec : null;
  } catch (err) {
    console.warn('[embeddings] error:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const embedDocument = (t: string) => embed(t, 'document');
export const embedQuery = (t: string) => embed(t, 'query');

/** number[] → pgvector-литерал "[0.1,0.2,...]" для $queryRaw. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
