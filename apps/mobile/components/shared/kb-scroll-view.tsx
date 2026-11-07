import React, { forwardRef, useContext, useEffect, useImperativeHandle, useRef } from 'react';
import {
  Keyboard,
  ScrollView,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import { ContentWidthContext } from '@/hooks/use-content-width';
import { useRobotDodge } from '@/hooks/use-robot-dodge';
import { focusScrollDelta } from '@/services/keyboard-focus';

type ScrollEvt = NativeSyntheticEvent<NativeScrollEvent>;
type Rect = { x: number; y: number; w: number; h: number };

const measure = (node: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void }) =>
  new Promise<Rect>((resolve) => node.measureInWindow((x, y, w, h) => resolve({ x, y, w, h })));

/** После открытия клавиатуры ждём, пока общий KeyboardAvoidingView сожмёт экран. */
const SETTLE_MS = 80;

/**
 * Прокрутка экрана с полями ввода: клавиатура не закрывает поле.
 * Открыт отдельным окном (шторка «Дневник» и т.п.) — iOS сам поднимает
 * содержимое над клавиатурой. Внутри дома (экран инструментов) окно сжимает
 * общий KeyboardAvoidingView — второй подъём дал бы пустоту, поэтому iOS-подъём
 * выключен, а до поля, в котором пишешь, докручиваем сами (Berik: «пишу новую
 * задачу — не видно, клавиатура закрывает»).
 *
 * Внутри дома ещё и уступает место мини-роботу (hooks/use-robot-dodge): внизу
 * пустое место под него, а начало/конец прокрутки — роботу, чтобы он отходил.
 */
export const KbScrollView = forwardRef<ScrollView, ScrollViewProps>(function KbScrollView(props, ref) {
  const inHome = useContext(ContentWidthContext) != null;
  const dodge = useRobotDodge();
  const inner = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => inner.current as ScrollView, []);
  const offsetY = useRef(0);
  // Высота прокрутки без клавиатуры: по ней решаем, что поле — внутри неё,
  // а не строка «Скажи роботу» под ней.
  const fullHeight = useRef(0);
  const kbOpen = useRef(false);

  const vertical = !props.horizontal;
  useEffect(() => {
    if (!inHome || !vertical) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = Keyboard.addListener('keyboardDidShow', () => {
      kbOpen.current = true;
      const input = TextInput.State.currentlyFocusedInput();
      const sv = inner.current;
      if (!input || !sv) return;
      timer = setTimeout(() => {
        void (async () => {
          const [box, field] = await Promise.all([measure(sv as never), measure(input as never)]);
          const delta = focusScrollDelta({ box, field, fullHeight: fullHeight.current });
          if (delta > 0) inner.current?.scrollTo({ y: offsetY.current + delta, animated: true });
        })();
      }, SETTLE_MS);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      kbOpen.current = false;
    });
    return () => {
      if (timer) clearTimeout(timer);
      show.remove();
      hide.remove();
    };
  }, [inHome, vertical]);

  const { children, onScroll, onLayout, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, ...rest } = props;
  const common = {
    ref: inner,
    automaticallyAdjustKeyboardInsets: !inHome,
    keyboardShouldPersistTaps: 'handled' as const,
    scrollEventThrottle: 16,
    ...rest,
    onScroll: (e: ScrollEvt) => {
      offsetY.current = e.nativeEvent.contentOffset.y;
      onScroll?.(e);
    },
    onLayout: (e: LayoutChangeEvent) => {
      if (!kbOpen.current) fullHeight.current = e.nativeEvent.layout.height;
      onLayout?.(e);
    },
  };
  if (!dodge || props.horizontal) {
    return (
      <ScrollView
        {...common}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={onMomentumScrollEnd}
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <ScrollView
      {...common}
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
        offsetY.current = e.nativeEvent.contentOffset.y;
        onMomentumScrollEnd?.(e);
      }}
    >
      {children}
      <View style={{ height: dodge.inset }} pointerEvents="none" />
    </ScrollView>
  );
});
