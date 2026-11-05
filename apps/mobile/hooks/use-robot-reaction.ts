import { useEffect, useState } from 'react';
import { normalizeEmotion, type RobotEmotion } from '@/services/robot-emotion';

/** Сколько робот держит эмоцию ответа, прежде чем вернуться в покой (как в прототипе). */
export const REACTION_HOLD_MS = 3500;

/** Чистая логика: эмоция ответа в течение окна реакции, потом neutral. */
export function reactionEmotion(
  emotion: string | undefined,
  startedAt: number | null,
  now: number,
): RobotEmotion {
  if (startedAt === null || now - startedAt >= REACTION_HOLD_MS) return 'neutral';
  return normalizeEmotion(emotion);
}

/**
 * Робот реагирует на НОВЫЙ ответ (меняется `key`) эмоцией с сервера и через
 * REACTION_HOLD_MS возвращается в покой.
 */
export function useRobotReaction(emotion: string | undefined, key: string | null): RobotEmotion {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!key) return;
    setStartedAt(Date.now());
    const t = setTimeout(() => setTick((n) => n + 1), REACTION_HOLD_MS + 50);
    return () => clearTimeout(t);
  }, [key]);

  return reactionEmotion(emotion, startedAt, Date.now());
}
