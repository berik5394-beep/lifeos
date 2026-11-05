/**
 * Робот-эпик, Часть 2 (2026-11-05): эмоция робота-аватара на ход мозга.
 *
 * Решение Berik: «сервер по фактам» — эмоцию считаем из того, что ход УЖЕ
 * знает (кризис, эмоциональность, подтверждение, успех/сбой, стиль), без
 * отдельного вызова ИИ. Приложение только рисует глаза.
 */

export const ROBOT_EMOTIONS = [
  'neutral',
  'happy',
  'love',
  'surprise',
  'worried',
  'confused',
  'caring',
  'thinking',
  'angry',
] as const;
export type RobotEmotion = (typeof ROBOT_EMOTIONS)[number];

export interface TurnFacts {
  userText: string;
  crisis?: boolean;
  /** Сообщение эмоциональное (classifyEmotional / therapeutic-путь). */
  emotional?: boolean;
  /** Ход оставил действие на подтверждение ('confirm') или задал слот-вопрос ('slot'). */
  pending?: 'confirm' | 'slot' | null;
  /** Действие выполнено (инструмент, подтверждённое «да», бронирование). */
  executed?: boolean;
  cancelled?: boolean;
  failed?: boolean;
  /** Стиль ассистента (friendly/strict/calm/toxic). */
  style?: string | null;
}

const JOY = /(^|[^а-яё])(ура|получилось|получил[ао]?сь|сделал[аи]?!|спасибо|класс|супер|отлично)([^а-яё]|$)/i;

/** Приоритет сверху вниз — первый сработавший факт определяет эмоцию. */
export function emotionForTurn(f: TurnFacts): RobotEmotion {
  if (f.crisis) return 'caring';
  if (f.emotional) return 'caring';
  if (f.failed) return 'worried';
  if (f.pending === 'confirm') return 'thinking';
  if (f.pending === 'slot') return 'confused';
  if (f.executed) return 'happy';
  if (f.cancelled) return 'neutral';
  if (f.style === 'toxic') return 'angry';
  if (JOY.test(f.userText)) return 'happy';
  return 'neutral';
}
