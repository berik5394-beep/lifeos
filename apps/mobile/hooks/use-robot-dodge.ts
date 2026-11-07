import { createContext, useContext } from 'react';

/**
 * Мини-робот висит поверх инструмента в углу, без своей полосы. Чтобы ничего
 * не загораживать (Berik 2026-11-07):
 * - прокрутка внутри дома оставляет внизу место под робота — последние строки
 *   всегда можно поднять над ним;
 * - пока листают, робот уменьшается и уходит к краю, потом возвращается.
 * Экран инструментов кладёт сюда высоту и «листают/перестали»; вне дома — null.
 */
export interface RobotDodge {
  /** Сколько места оставить в конце прокрутки. */
  inset: number;
  /** Начали (true) / закончили (false) листать. */
  onScrolling: (active: boolean) => void;
}

export const RobotDodgeContext = createContext<RobotDodge | null>(null);

export function useRobotDodge(): RobotDodge | null {
  return useContext(RobotDodgeContext);
}
