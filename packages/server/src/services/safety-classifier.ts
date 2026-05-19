import Anthropic from '@anthropic-ai/sdk';

/**
 * Phase 6 C1 Safety — распознавание кризисных сигналов.
 *
 * АРХИТЕКТУРНЫЙ ИНВАРИАНТ (structural, не prompt-hope):
 *  - matchesCrisisPhrase — ДЕТЕРМИНИРОВАННАЯ сеть. Это гарантия
 *    recall: тест safety-recall гоняется ОФФЛАЙН и обязан давать
 *    0 false-negative. Сетевой классификатор не 100%-детерминирован
 *    и недоступен в тестах → инвариант на него опираться НЕ может.
 *  - classifyCrisis = phrase-hit OR Haiku. Haiku ТОЛЬКО РАСШИРЯЕТ
 *    охват (нефразовые формулировки), НИКОГДА не сужает. Bias к
 *    false-positive живёт в Haiku-промпте: лучше лишний раз показать
 *    ресурсы, чем пропустить кризис (провал-инвариант спеки).
 *  - Нет ключа / ошибка Haiku → возвращаем phrase-результат (он
 *    авторитетен для явных сигналов). Никогда не падаем, никогда
 *    молча не теряем явный сигнал.
 *
 * Паттерны намеренно ВЫСОКОТОЧНЫЕ (явные намерения), чтобы пройти
 * safety-precision: гипербола («умираю от смеха», «убил бы за кофе»)
 * НЕ матчится. Широкую серую зону добирает Haiku, не список.
 * Язык: русский (UI-язык) + базовый казахский (vision: KZ ru/kk).
 */

// Каждый паттерн — явный сигнал суицида / самоповреждения / острого
// отчаяния, не идиома. ВАЖНО: НЕ используем \b — в JS это ASCII-
// word-boundary и НЕ работает с кириллицей (документированный
// инцидент classifyGoal в этой же кодбазе). Точность держим
// спецификой многословных фраз, не границами слова.
const CRISIS_PATTERNS: RegExp[] = [
  // суицидальное намерение (ru)
  /хочу\s+умереть/i,
  /не\s+хочу\s+(больше\s+)?жить/i,
  /не\s+вижу\s+смысла\s+жить/i,
  /(нет|никакого)\s+смысла\s+(больше\s+)?жить/i,
  /лучше\s+бы\s+я\s+(умер|сдох|не\s+родил)/i,
  /покончить\s+(с\s+собой|со\s+всем\s+этим|жизнью)/i,
  /свести\s+сч[её]ты\s+с\s+жизнью/i,
  /(убить|убью)\s+себя/i,
  /себя\s+убь[юё]/i,
  /наложить\s+на\s+себя\s+руки/i,
  /суицид/i,
  /мне\s+незачем\s+(жить|существовать)/i,
  /(устал|устала)\s+(жить|от\s+жизни)/i,
  /хочу\s+(исчезнуть|чтобы\s+это\s+(всё\s+)?закончилось)/i,
  // самоповреждение (ru)
  /(режу|порезал|резал)\s+себя/i,
  /причин(яю|ить)\s+себе\s+(боль|вред)/i,
  /нан(ошу|ести)\s+себе\s+вред/i,
  // казахский (базовый набор, проверяемый — vision KZ ru/kk)
  /өмір\s+сүргім\s+келмейді/i,
  /өзімді\s+өлтір/i,
  /өмірден\s+кет(кім|кім\s+келеді)/i,
];

export function matchesCrisisPhrase(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

/**
 * Полная классификация: детерминированная сеть OR Haiku-расширение.
 * Bias к false-positive в Haiku. Любой сбой/нет ключа → phrase-
 * результат (никогда не теряем явный сигнал, никогда не падаем).
 */
export async function classifyCrisis(text: string): Promise<boolean> {
  if (matchesCrisisPhrase(text)) return true;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !text || text.length < 3) return false;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 8,
      system:
        'Ты — safety-классификатор. Сообщение пользователя содержит ' +
        'сигнал острого кризиса (суицидальные мысли, самоповреждение, ' +
        'намерение причинить вред себе/другим, острое отчаяние с ' +
        'опасностью)? Bias к ДА — при любом сомнении отвечай ДА (лучше ' +
        'лишний раз дать ресурсы помощи, чем пропустить кризис). ' +
        'Гипербола («умираю от смеха») — НЕТ. Ответь РОВНО одним ' +
        'словом: ДА или НЕТ.',
      messages: [{ role: 'user', content: text.slice(0, 1000) }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return false;
    return /\bда\b/i.test(block.text.trim());
  } catch (err) {
    console.warn(
      '[safety] Haiku classify failed (fallback to phrase-net):',
      err instanceof Error ? err.message : err,
    );
    return false; // phrase-net уже сказал false; не падаем
  }
}
