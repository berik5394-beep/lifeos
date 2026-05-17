import { describe, it, expect } from 'vitest';
import { looksCaptureWorthy } from './jarvis-orchestrator.js';

/**
 * ISSUE-8 — гейт ambient-capture. Чистая эвристика без БД/LLM.
 * Вопросы/болтовня/короткое → НЕ извлекаем (раньше плодило мусор).
 * Осмысленные действия/факты → извлекаем.
 */

describe('looksCaptureWorthy — мусор НЕ извлекаем', () => {
  it.each([
    'как мне начать бегать по утрам?',
    'Какая погода завтра?',
    'сколько я потратил в этом месяце',
    'расскажи анекдот',
    'мотивируй меня',
    'что ты умеешь',
    'привет',
    'спасибо большое',
    'да',
    'ок',
    'как дела',
  ])('«%s» → false', (t) => {
    expect(looksCaptureWorthy(t)).toBe(false);
  });
});

describe('looksCaptureWorthy — осмысленный ambient-capture извлекаем', () => {
  it.each([
    'купи продукты завтра',
    'надо позвонить врачу в понедельник',
    'Серик переехал в Астану',
    'не забыть забрать посылку с почты',
    'встреча с инвестором прошла хорошо',
  ])('«%s» → true', (t) => {
    expect(looksCaptureWorthy(t)).toBe(true);
  });
});
