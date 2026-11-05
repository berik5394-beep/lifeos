import { ROBOT_EMOTIONS, normalizeEmotion, eyeShapeFor } from '@/services/robot-emotion';

describe('robot-emotion — форма глаз робота (как в прототипе Berik)', () => {
  it('9 эмоций, как на сервере', () => {
    expect([...ROBOT_EMOTIONS]).toEqual([
      'neutral', 'happy', 'love', 'surprise', 'worried', 'confused', 'caring', 'thinking', 'angry',
    ]);
  });

  it('normalizeEmotion: валидное — как есть, мусор/пусто — neutral', () => {
    expect(normalizeEmotion('happy')).toBe('happy');
    expect(normalizeEmotion('ecstatic')).toBe('neutral');
    expect(normalizeEmotion(undefined)).toBe('neutral');
    expect(normalizeEmotion(42)).toBe('neutral');
  });

  it('покой = чёрточки 28×7', () => {
    const e = eyeShapeFor('neutral');
    expect(e.left).toMatchObject({ width: 28, height: 7 });
    expect(e.right).toMatchObject({ width: 28, height: 7 });
    expect(e.highlight).toBe(false);
  });

  it('эмоции «раскрывают» глаза: каждая, кроме neutral, выше чёрточки', () => {
    for (const emo of ROBOT_EMOTIONS) {
      if (emo === 'neutral') continue;
      const e = eyeShapeFor(emo);
      expect(Math.max(e.left.height, e.right.height)).toBeGreaterThan(7);
    }
  });

  it('особенности: love розовые с бликом, angry красные с бровями, confused разные глаза и наклон', () => {
    expect(eyeShapeFor('love')).toMatchObject({ color: '#FF8FB1', highlight: true });
    const angry = eyeShapeFor('angry');
    expect(angry.color).toBe('#FF5247');
    expect(angry.browAngle).toBe(22);
    const confused = eyeShapeFor('confused');
    expect(confused.left.width).not.toBe(confused.right.width);
    expect(confused.tilt).toBe(-7);
    expect(eyeShapeFor('thinking').tilt).toBe(-7);
  });
});
