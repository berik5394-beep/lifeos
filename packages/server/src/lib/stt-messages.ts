/**
 * Что сказать, когда речь не распозналась. Раньше на ЛЮБОЙ сбой (Groq лежит,
 * лимит, нет ключа) юзер слышал «Говорите громче» — винил себя и микрофон,
 * пробовал три раза и уходил. Теперь различаем тишину и сбой сервиса.
 */
export const STT_SILENCE = 'Не расслышал — скажи ещё раз, чуть ближе к микрофону.';
export const STT_SERVICE_DOWN =
  'Распознавание речи сейчас не работает — сбой на моей стороне, не у тебя. Попробуй через минуту или напиши текстом.';

export function sttFailure(serviceError: boolean): { text: ''; message: string; reason: 'silence' | 'service' } {
  return serviceError
    ? { text: '', message: STT_SERVICE_DOWN, reason: 'service' }
    : { text: '', message: STT_SILENCE, reason: 'silence' };
}
