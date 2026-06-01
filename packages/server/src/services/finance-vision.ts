import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';

/** Результат чтения финансового фото (чек / скрин банка / перевод). */
export interface FinanceVisionResult {
  direction: 'expense' | 'income' | 'unknown';
  amount: number | null;
  category?: string;
  merchant?: string;
  date?: string; // YYYY-MM-DD
  confidence: number;
}

/** Чистый defensive-парсер ответа модели. Никогда не бросает; кривой
 *  JSON / нет суммы / неизвестное направление → unknown (не выдумываем). */
export function parseFinanceResponse(text: string): FinanceVisionResult {
  const fallback: FinanceVisionResult = { direction: 'unknown', amount: null, confidence: 0 };
  let raw: unknown;
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const body = fence ? fence[1] : text;
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a === -1 || b === -1) return fallback;
    raw = JSON.parse(body.slice(a, b + 1));
  } catch {
    return fallback;
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const dirRaw = o.direction === 'expense' || o.direction === 'income' ? o.direction : 'unknown';
  const amt =
    typeof o.amount === 'number' && Number.isFinite(o.amount) && o.amount > 0 ? o.amount : null;
  // Без суммы ИЛИ без направления → unknown (записать нечего).
  const direction = dirRaw !== 'unknown' && amt !== null ? dirRaw : 'unknown';
  return {
    direction,
    amount: amt,
    category: typeof o.category === 'string' ? o.category.slice(0, 40) : undefined,
    merchant: typeof o.merchant === 'string' ? o.merchant.slice(0, 120) : undefined,
    date: typeof o.date === 'string' ? o.date.slice(0, 10) : undefined,
    confidence: typeof o.confidence === 'number' ? o.confidence : 0,
  };
}

/** Чистое отображение результата в подтверждаемое money-действие.
 *  null → нечего записывать (unknown). Сумма округляется до целых ₸. */
export function buildFinancePending(
  r: FinanceVisionResult,
): { action: 'add_expense' | 'add_income'; input: Record<string, unknown>; confirmationText: string } | null {
  if ((r.direction !== 'expense' && r.direction !== 'income') || r.amount === null || r.amount <= 0) {
    return null;
  }
  const amount = Math.round(r.amount);
  if (r.direction === 'expense') {
    const input: Record<string, unknown> = { amount };
    if (r.category) input.category = r.category;
    if (r.merchant) input.description = r.merchant;
    const text =
      `Записать расход ${amount} ₸` +
      (r.merchant ? ` · ${r.merchant}` : '') +
      (r.category ? ` · ${r.category}` : '') +
      '? Ответь «да» для записи или исправь суммой/категорией.';
    return { action: 'add_expense', input, confirmationText: text };
  }
  const input: Record<string, unknown> = { amount };
  if (r.merchant) input.source = r.merchant;
  const text =
    `Записать доход ${amount} ₸` +
    (r.merchant ? ` · ${r.merchant}` : '') +
    '? Ответь «да» для записи.';
  return { action: 'add_income', input, confirmationText: text };
}

const VISION_MODEL = MODELS.sonnet;
const anthropic = createAnthropic();

/** Best-effort: фото (base64) → FinanceVisionResult. Никогда не бросает
 *  (сбой/нет ключа → unknown). Реальный vision-вызов. */
export async function analyzeFinancePhoto(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
): Promise<FinanceVisionResult> {
  try {
    const resp = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 256,
      system:
        'На фото чек, скрин банковского уведомления или перевода. Определи ' +
        'операцию и верни ТОЛЬКО JSON: {"direction": "expense"|"income"|"unknown", ' +
        '"amount": число в тенге (без пробелов/символов), "category"?: string, ' +
        '"merchant"?: string (магазин/источник), "date"?: "YYYY-MM-DD", ' +
        '"confidence": 0..1}. СПИСАНИЕ/покупка → expense. ПОСТУПЛЕНИЕ/зачисление → ' +
        'income. Если не видно суммы или непонятно — direction="unknown". ' +
        'Категории расхода: food, transport, entertainment, clothing, health, home, other.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Прочитай операцию и верни JSON.' },
          ],
        },
      ],
    });
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return { direction: 'unknown', amount: null, confidence: 0 };
    return parseFinanceResponse(block.text);
  } catch (err) {
    console.warn('[finance-vision] analyze failed:', err instanceof Error ? err.message : err);
    return { direction: 'unknown', amount: null, confidence: 0 };
  }
}
