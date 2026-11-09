/**
 * Whisper на тишине/шуме «слышит» фразы из субтитров, на которых учился:
 * «Продолжение следует...», «Субтитры сделал DimaTorzok», «Спасибо за
 * просмотр». Живой прогон 2026-11-09: молча подержал микрофон — мозгу ушла
 * команда «Продолжение следует...». Такой текст = тишина, не команда.
 */
const PHRASES: RegExp[] = [
  /^продолжение следует/,
  /^субтитр/,
  /^редактор субтитров/,
  /^корректор/,
  /^спасибо за просмотр/,
  /^подписывайтесь/,
  /^ставьте лайки/,
  /^до новых встреч/,
  /^смотрите (?:продолжение|далее)/,
  /dimatorzok/,
  /amara\.org/,
];

export function isWhisperHallucination(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"!?.…,\s]+$/g, '')
    .trim();
  if (!t) return true;
  return PHRASES.some((re) => re.test(t));
}

/** Текст распознавания без выдумок Whisper: выдумка → '' (как тишина). */
export function cleanTranscript(text: string): string {
  const t = text.trim();
  return isWhisperHallucination(t) ? '' : t;
}
