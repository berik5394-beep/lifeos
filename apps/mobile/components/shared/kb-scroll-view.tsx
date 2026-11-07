import React, { forwardRef, useContext } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native';
import { ContentWidthContext } from '@/hooks/use-content-width';
import { useRobotDodge } from '@/hooks/use-robot-dodge';

type ScrollEvt = NativeSyntheticEvent<NativeScrollEvent>;

/**
 * Прокрутка экрана с полями ввода: клавиатура не закрывает поле.
 * Открыт отдельным окном (шторка «Дневник» и т.п.) — iOS сам поднимает
 * содержимое над клавиатурой. Внутри дома (экран инструментов) окно уже сжимает
 * общий KeyboardAvoidingView — второй подъём дал бы пустоту, поэтому выключен.
 *
 * Внутри дома ещё и уступает место мини-роботу (hooks/use-robot-dodge): внизу
 * пустое место под него, а начало/конец прокрутки — роботу, чтобы он отходил.
 */
export const KbScrollView = forwardRef<ScrollView, ScrollViewProps>(function KbScrollView(props, ref) {
  const inHome = useContext(ContentWidthContext) != null;
  const dodge = useRobotDodge();
  if (!dodge || props.horizontal) {
    return <ScrollView ref={ref} automaticallyAdjustKeyboardInsets={!inHome} keyboardShouldPersistTaps="handled" {...props} />;
  }
  const { children, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, ...rest } = props;
  return (
    <ScrollView
      ref={ref}
      automaticallyAdjustKeyboardInsets={!inHome}
      keyboardShouldPersistTaps="handled"
      {...rest}
      onScrollBeginDrag={(e: ScrollEvt) => {
        dodge.onScrolling(true);
        onScrollBeginDrag?.(e);
      }}
      onScrollEndDrag={(e: ScrollEvt) => {
        // Без инерции это конец; с инерцией придёт begin/end momentum.
        dodge.onScrolling(false);
        onScrollEndDrag?.(e);
      }}
      onMomentumScrollBegin={(e: ScrollEvt) => {
        dodge.onScrolling(true);
        onMomentumScrollBegin?.(e);
      }}
      onMomentumScrollEnd={(e: ScrollEvt) => {
        dodge.onScrolling(false);
        onMomentumScrollEnd?.(e);
      }}
    >
      {children}
      <View style={{ height: dodge.inset }} pointerEvents="none" />
    </ScrollView>
  );
});
