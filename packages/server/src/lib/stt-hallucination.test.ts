import { describe, it, expect } from 'vitest';
import { cleanTranscript, isWhisperHallucination } from './stt-hallucination.js';

describe('выдумки Whisper на тишине', () => {
  it.each(['Продолжение следует...', 'Субтитры сделал DimaTorzok', 'Спасибо за просмотр!', 'ПОДПИСЫВАЙТЕСЬ НА КАНАЛ', '  '])(
    '«%s» → тишина',
    (t) => {
      expect(isWhisperHallucination(t)).toBe(true);
      expect(cleanTranscript(t)).toBe('');
    },
  );
  it.each(['Потратил 5000 на продукты', 'Продолжение отчёта сделать завтра', 'Создай задачу субботник? нет, уборка'])(
    'живая фраза «%s» остаётся',
    (t) => {
      expect(cleanTranscript(t)).toBe(t);
    },
  );
});
