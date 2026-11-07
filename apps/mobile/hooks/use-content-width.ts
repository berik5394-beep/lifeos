import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * Ширина, в которой нарисован экран. Экраны инструментов живут в карточке
 * комнаты — она уже телефона; считать от ширины окна значит вылезти вправо
 * (вкладки-листалки съезжали на каждую страницу). Карточка кладёт сюда свою
 * ширину; вне карточки — ширина окна.
 */
export const ContentWidthContext = createContext<number | null>(null);

export function useContentWidth(): number {
  const fromCard = useContext(ContentWidthContext);
  const { width } = useWindowDimensions();
  return fromCard ?? width;
}

/**
 * Экран открыт внутри дома (вкладки инструментов сверху уже называют его) —
 * свой заголовок «Задачи / Финансы / Привычки» не рисуем: дубль шапки.
 */
export function useInTools(): boolean {
  return useContext(ContentWidthContext) != null;
}

/** Вкладка инструмента сейчас видна (спрятанные живут, но окна поверх не показывают). */
export const ToolActiveContext = createContext<boolean>(true);
export function useToolActive(): boolean {
  return useContext(ToolActiveContext);
}
