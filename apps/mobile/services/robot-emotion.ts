/**
 * Робот-эпик, Часть 2: эмоции робота-аватара. Эмоцию на каждый ответ присылает
 * сервер (по фактам хода); здесь — только как её нарисовать. Геометрия глаз
 * перенесена 1:1 из прототипа Berik (~/Downloads/robot_companion.html):
 * покой = чёрточки, эмоции «раскрывают» глаза.
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

export function normalizeEmotion(value: unknown): RobotEmotion {
  return typeof value === 'string' && (ROBOT_EMOTIONS as readonly string[]).includes(value)
    ? (value as RobotEmotion)
    : 'neutral';
}

export const ROBOT_COLORS = {
  shell: '#E8E8F0',
  shellBorder: '#BFC0D8',
  screen: '#23202F',
  eye: '#6CF0FF',
  body: '#6C63FF',
  antenna: '#7D75FF',
  accent: '#FFD166',
  arm: '#CFCFE0',
} as const;

export interface EyeBox {
  width: number;
  height: number;
  /** Скругление сверху и снизу (happy = только снизу). */
  radiusTop: number;
  radiusBottom: number;
}

export interface EyeShape {
  left: EyeBox;
  right: EyeBox;
  /** Сдвиг обоих глаз (thinking смотрит вверх-влево, happy/caring чуть ниже). */
  offsetX: number;
  offsetY: number;
  color: string;
  opacity: number;
  /** Блик (на «открытых» круглых глазах). */
  highlight: boolean;
  /** Брови/веки: угол наклона внутреннего края в градусах (0 = нет бровей). */
  browAngle: number;
  /** Наклон всего робота (растерянность/размышление). */
  tilt: number;
  /** Дрожь (тревога) и пульс (любовь). */
  tremble: boolean;
  pulse: boolean;
  /** Правая рука машет (радость). */
  wave: boolean;
}

const box = (width: number, height: number, radiusTop: number, radiusBottom = radiusTop): EyeBox => ({
  width,
  height,
  radiusTop,
  radiusBottom,
});
const round = (w: number, h: number) => box(w, h, Math.max(w, h) / 2);

const BASE: Omit<EyeShape, 'left' | 'right'> = {
  offsetX: 0,
  offsetY: 0,
  color: ROBOT_COLORS.eye,
  opacity: 1,
  highlight: false,
  browAngle: 0,
  tilt: 0,
  tremble: false,
  pulse: false,
  wave: false,
};

export function eyeShapeFor(emotion: RobotEmotion): EyeShape {
  switch (emotion) {
    case 'happy':
      return { ...BASE, left: box(28, 15, 0, 18), right: box(28, 15, 0, 18), offsetY: 5, wave: true };
    case 'love':
      return { ...BASE, left: round(32, 34), right: round(32, 34), color: '#FF8FB1', highlight: true, pulse: true };
    case 'surprise':
      return { ...BASE, left: round(34, 36), right: round(34, 36), highlight: true };
    case 'angry':
      return { ...BASE, left: box(30, 22, 7), right: box(30, 22, 7), color: '#FF5247', browAngle: 22 };
    case 'worried':
      return { ...BASE, left: box(28, 20, 9), right: box(28, 20, 9), browAngle: -17, tremble: true };
    case 'caring':
      return { ...BASE, left: box(26, 18, 11), right: box(26, 18, 11), offsetY: 4, opacity: 0.9 };
    case 'confused':
      return { ...BASE, left: round(32, 34), right: round(18, 20), highlight: true, tilt: -7 };
    case 'thinking':
      return { ...BASE, left: round(14, 14), right: round(14, 14), offsetX: -6, offsetY: -4, tilt: -7 };
    case 'neutral':
    default:
      return { ...BASE, left: box(28, 7, 5), right: box(28, 7, 5) };
  }
}
