import React, { forwardRef, useContext } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { ContentWidthContext } from '@/hooks/use-content-width';

/**
 * Прокрутка экрана с полями ввода: клавиатура не закрывает поле.
 * Открыт отдельным окном (шторка «Дневник» и т.п.) — iOS сам поднимает
 * содержимое над клавиатурой. Внутри дома (экран инструментов) окно уже сжимает
 * общий KeyboardAvoidingView — второй подъём дал бы пустоту, поэтому выключен.
 */
export const KbScrollView = forwardRef<ScrollView, ScrollViewProps>(function KbScrollView(props, ref) {
  const inHome = useContext(ContentWidthContext) != null;
  return <ScrollView ref={ref} automaticallyAdjustKeyboardInsets={!inHome} keyboardShouldPersistTaps="handled" {...props} />;
});
