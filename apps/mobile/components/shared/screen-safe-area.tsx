import React, { useContext } from 'react';
import { View } from 'react-native';
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';
import { ContentWidthContext } from '@/hooks/use-content-width';

/**
 * Экран инструмента открывается и целиком, и в карточке комнаты. В карточке
 * отступ под чёлку не нужен (карточка уже ниже неё) — без этой обёртки сверху
 * оставалась пустая полоса.
 */
export function ScreenSafeArea({ children, style, edges }: Pick<SafeAreaViewProps, 'children' | 'style' | 'edges'>) {
  const inCard = useContext(ContentWidthContext) != null;
  if (inCard) return <View style={style}>{children}</View>;
  return (
    <SafeAreaView style={style} edges={edges}>
      {children}
    </SafeAreaView>
  );
}
