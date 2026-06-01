import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';

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
  // P0 safety-recall hardening (Berik review 2026-05-20): non-explicit
  // формулировки, которые реальные люди используют (раньше Haiku-слой
  // должен был ловить, но был не вайрен → дыра recall). Эти кейсы
  // явны при чтении человеком, но в исходном phrase-list их не было.
  /устал(а)?\s+существовать/i,
  /не\s+вижу\s+смысла\s+(продолжать|оставаться)/i,
  /лучше\s+бы\s+меня\s+не\s+было/i,
  /(зачем|для\s+чего)\s+мне\s+(жить|существовать)/i,
  /(жизнь|существование)\s+(бессмысленн|невыносим)/i,
  /больше\s+нет\s+(сил|желания)\s+(жить|быть|существовать|продолжать)/i,
  /мне\s+нечего\s+(жить|терять|ждать)/i,
  /(всё|жизнь)\s+(потеряло|потеряла)\s+смысл/i,
  /я\s+(?:просто|реально|совсем|настолько|тут|здесь)?\s*(пустое\s+место|никто|ничтожество)/i,
  // казахский (базовый набор, проверяемый — vision KZ ru/kk)
  /өмір\s+сүргім\s+келмейді/i,
  /өзімді\s+өлтір/i,
  /өмірден\s+кет(кім|кім\s+келеді)/i,
  // 3.3 (AUDIT-2026-06): English — для глобального запуска App Store.
  // English — ASCII, поэтому \b здесь КОРРЕКТЕН (правило «без \b» в этом
  // файле — только для кириллицы). Высокоточные многословные фразы, чтобы
  // гипербола («dying of laughter», «killing me», «kill for a coffee»,
  // «dead tired») НЕ матчилась (safety-precision).
  /\bwant(?:ed|s)?\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(?:live|be\s+alive)\b/i,
  /\bkill\s+myself\b/i,
  /\bend(?:ing)?\s+my\s+life\b/i,
  /\btake\s+my\s+(?:own\s+)?life\b/i,
  /\bcommit\s+suicide\b/i,
  /\bsuicidal\b/i,
  /\b(?:better\s+off|wish\s+i\s+(?:was|were))\s+dead\b/i,
  /\bno\s+(?:reason|point)\s+(?:in\s+)?(?:to\s+)?(?:live|living|go\s+on)\b/i,
  /\bnothing\s+to\s+live\s+for\b/i,
  /\bcut(?:ting)?\s+myself\b/i,
  /\bself[\s-]?harm\b/i,
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

  // FIX (P6-safety 2026-05-28): CLAUDE_API_KEY (см. .env.example).
  // Раньше SDK-дефолтный env → Tier-2 Haiku в проде НЕ запускался,
  // только Tier-1 phrase patterns — subtle non-phrase кризис
  // пропускался. SAFETY-restore.
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || !text || text.length < 3) return false;

  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.haiku,
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
    // \b ASCII-only → не работает с кириллицей. Haiku инструктирован
    // отвечать ОДНИМ словом ДА/НЕТ — точечный match без \b.
    const ans = block.text.trim().toLowerCase();
    return /^да(?:[.!?\s].*)?$/u.test(ans);
  } catch (err) {
    console.warn(
      '[safety] Haiku classify failed (fallback to phrase-net):',
      err instanceof Error ? err.message : err,
    );
    return false; // phrase-net уже сказал false; не падаем
  }
}
