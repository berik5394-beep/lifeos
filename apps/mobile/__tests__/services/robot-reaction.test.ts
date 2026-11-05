import { reactionEmotion, REACTION_HOLD_MS } from '@/hooks/use-robot-reaction';

describe('reactionEmotion — робот держит эмоцию ответа и возвращается в покой', () => {
  it('держит эмоцию REACTION_HOLD_MS после ответа', () => {
    expect(reactionEmotion('happy', 1000, 1000 + REACTION_HOLD_MS - 1)).toBe('happy');
  });
  it('после — покой (neutral)', () => {
    expect(reactionEmotion('happy', 1000, 1000 + REACTION_HOLD_MS + 1)).toBe('neutral');
  });
  it('нет ответа — покой', () => {
    expect(reactionEmotion(undefined, null, 5000)).toBe('neutral');
  });
});
