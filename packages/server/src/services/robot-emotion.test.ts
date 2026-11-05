import { describe, it, expect } from 'vitest';
import { emotionForTurn, type TurnFacts } from './robot-emotion.js';

const base: TurnFacts = { userText: 'привет' };

describe('emotionForTurn — эмоция робота по фактам хода', () => {
  it.each<[string, TurnFacts, string]>([
    ['кризис → забота', { ...base, crisis: true, executed: true }, 'caring'],
    ['эмоциональное сообщение → забота', { ...base, emotional: true, style: 'toxic' }, 'caring'],
    ['ждёт подтверждения → думает', { ...base, pending: 'confirm', executed: false }, 'thinking'],
    ['слот-вопрос → растерянность', { ...base, pending: 'slot' }, 'confused'],
    ['действие выполнено → радость', { ...base, executed: true }, 'happy'],
    ['отмена → нейтрально', { ...base, cancelled: true }, 'neutral'],
    ['сбой → тревога', { ...base, failed: true }, 'worried'],
    ['токсичный стиль → злость', { ...base, style: 'toxic' }, 'angry'],
    ['радость в тексте → радость', { userText: 'Ура, получилось!' }, 'happy'],
    ['спасибо → радость', { userText: 'спасибо тебе' }, 'happy'],
    ['обычный вопрос → нейтрально', { userText: 'какие планы на завтра' }, 'neutral'],
  ])('%s', (_name, facts, expected) => {
    expect(emotionForTurn(facts)).toBe(expected);
  });

  it('приоритет: сбой важнее радости в тексте', () => {
    expect(emotionForTurn({ userText: 'ура', failed: true })).toBe('worried');
  });
});
