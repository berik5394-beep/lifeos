import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';

/**
 * Phase 6 C3.1 — классификатор эмоциональных сообщений.
 *
 * АРХИТЕКТУРА (зеркало safety-classifier, но ОБРАТНЫЙ bias):
 *  - matchesEmotionalPhrase — ДЕТЕРМИНИРОВАННАЯ узкая сеть на ЯВНЫЕ
 *    эмо-маркеры. Это гарантия recall на explicit (тест оффлайн).
 *  - classifyEmotional = phrase-hit OR Haiku. Haiku при сомнении
 *    отвечает НЕТ (provail-инвариант спеки #4: «запиши расход» НЕ
 *    должен получить «как ты?»). Precision важнее recall — лучше
 *    пропустить эмо-момент, чем напугать на транзакции.
 *  - Кризис уже отсечён выше в orchestrator (Safety-гейт C1), сюда
 *    приходят НЕ-кризисные сообщения.
 *
 * Безопасность: классификатор НЕ тон ответа меняет — он лишь
 * сигнал маршрутизации; tone-override в therapeutic-mode prompt
 * (C3.2). Style-агностично, без зависимостей на assistantStyle.
 */

// ВАЖНО (третий рецидив за фазу): JS \b — ASCII-only, НЕ работает
// с кириллицей. Точность держим спецификой МНОГОСЛОВНЫХ фраз, не
// границами слова. Документировано в crisis-resources/safety/
// classifyGoal — больше не повторять.
const EMO_PATTERNS: RegExp[] = [
  // явные эмо-состояния «мне/так Х»
  // допускаем интенсификатор между «мне» и эмоцией («мне очень тяжело»).
  /(мне|так|чет|что-то)\s+(?:(?:очень|просто|реально|совсем|настолько|сегодня|сейчас|вчера|немного|чуть)\s+)?(грустно|плохо|тяжело|одиноко|больно|тоскливо|херово|паршиво|тошно|пусто)/i,
  /(чувствую|ощущаю)\s+себя\s+(плохо|пусто|потерянн|разбит|никчёмн)/i,
  // явные межличностные конфликты (эмо-нагрузка)
  /поссорил(ся|ась)/i,
  /обидел(и|а|ся|ась)/i,
  /обидно\s+(мне|очень|до\s+слёз)/i,
  /(не\s+могу\s+простить|накричал(а)?\s+на\s+меня)/i,
  // переживание/сомнение/потеря
  /(сильно\s+)?переживаю/i,
  /не\s+знаю\s+что\s+(делать|сказать|думать|чувствовать)/i,
  /(расстроен|расстроена)/i,
  /тоскую/i,
  /выгорел(а)?/i,
  /не\s+справляюсь/i,
  /сорвал(ся|ась)/i,
  /мне\s+стыдно/i,
  /чувство\s+вины/i,
  /(одинокая|одиноко\s+мне)/i,
  /устал(а)?\s+морально/i,
  /всё\s+бесит/i,
];

export function matchesEmotionalPhrase(text: string): boolean {
  if (!text) return false;
  return EMO_PATTERNS.some((re) => re.test(text.toLowerCase()));
}

/**
 * Полная классификация: phrase OR Haiku. Bias к НЕТ (precision):
 * любое сомнение → транзакционный (защита от провал-инварианта
 * «как ты?» на «запиши расход»). Нет ключа / ошибка → phrase-
 * результат (детерм. net уже сказал; не теряем явное, не падаем).
 */
export async function classifyEmotional(text: string): Promise<boolean> {
  if (matchesEmotionalPhrase(text)) return true;

  // FIX (P6-safety 2026-05-28): CLAUDE_API_KEY (см. .env.example).
  // Раньше SDK-дефолтный env → Tier-2 Haiku отключён в проде, тонкие
  // эмо-сообщения classified as transactional → бот отвечал как
  // купи-продай вместо therapeutic mode. Phase 6 C3 восстановлен.
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || !text || text.length < 8) return false;

  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 8,
      system:
        'Ты — классификатор. Сообщение пользователя про ЭМОЦИИ ' +
        '(чувства, отношения, переживания, сомнения, душевная боль) — ' +
        'ИЛИ это транзакционная задача (запись расхода, встреча, ' +
        'погода, дело, факт)? Bias к НЕТ — при ЛЮБОМ сомнении ' +
        'отвечай НЕТ (транзакция). Эмоция должна быть ЯВНО про ' +
        'чувства. Ответь РОВНО одним словом: ДА или НЕТ.',
      messages: [{ role: 'user', content: text.slice(0, 500) }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return false;
    // \b ASCII-only с кириллицей — мёртвый match. Haiku инструктирован
    // на ОДНО слово ДА/НЕТ → точечный match без \b.
    const ans = block.text.trim().toLowerCase();
    return /^да(?:[.!?\s].*)?$/u.test(ans);
  } catch (err) {
    console.warn(
      '[emo] Haiku classify failed (fallback to phrase-net):',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
