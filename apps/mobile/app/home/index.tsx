import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, Platform, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { dragOffset, swipeDecision } from '@/services/home-swipe';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotifications } from '@/hooks/use-notifications';
import { useColors } from '@/hooks/use-colors';
import { ChatInputRow } from '@/components/room/chat-input-row';
import { useRoomToolStore } from '@/stores/room-tool-store';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';
import { useDealStore } from '@/stores/deal-store';
import { useAuthStore } from '@/stores/auth-store';
import { visiblePanels, hiddenPanelReason } from '@/services/panels';
import { currentRouteName, navigateTo } from '@/navigation/ref';
import { isToolKey, type ToolKey } from '@/services/room-tools';
import { RoomPage } from './room-page';
import { ToolsPage } from './tools-page';
import { startRobotNudges } from '@/services/robot-nudges';
import { storage } from '@/services/storage';
import { isIntroDone } from '@/services/room-intro';
import { syncUiLevel } from '@/services/ui-level-sync';
import { syncHealth } from '@/services/health-sync';
import { syncWidget } from '@/services/widget-sync';
import { useScheduleStore } from '@/stores/schedule-store';

const TOOLS_PAGE = 0;
const ROOM_PAGE = 1;
const FRESH_REPLY_MS = 90_000;

/**
 * Дом приложения — два экрана (Berik: «комнату отдельно, инструменты отдельно»):
 * инструменты (вкладки на весь экран) и, свайпом влево, комната робота.
 * Строка «Скажи роботу…» с микрофоном — одна, под обоими экранами.
 */
export default function HomeScreen() {
  useNotifications();
  const c = useColors();
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      // Android с edge-to-edge не сжимает окно сам — без padding клавиатура закрывает ввод.
      behavior="padding"
    >
      {/* Голос (SharedVoiceProvider) — над всем стеком в navigation/index.tsx. */}
      <HomePager />
    </KeyboardAvoidingView>
  );
}

/** Клавиатура открыта? Тогда строка робота прямо над ней, без отступа под «домой». */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return open;
}

function HomePager() {
  const c = useColors();
  const { width } = useWindowDimensions();
  // Строка «Скажи роботу» лежала на полоске «домой» (Berik: «будто лежат на
  // полу»). Как на остальных экранах — над ней; с клавиатурой — без отступа.
  const insets = useSafeAreaInsets();
  const kbOpen = useKeyboardOpen();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(TOOLS_PAGE);
  // Хоть раз открывал комнату? Нет — у точек подсказка, где она.
  const [roomSeen, setRoomSeen] = useState(() => storage.getBoolean('room_seen') === true || isIntroDone());
  useEffect(() => {
    if (page !== ROOM_PAGE || roomSeen) return;
    storage.setBoolean('room_seen', true);
    setRoomSeen(true);
  }, [page, roomSeen]);
  const [tab, setTab] = useState<ToolKey>('today');
  // Жест «от левого края — на Сегодня» невидим: подсказка, пока ни разу не пользовался.
  const [edgeSeen, setEdgeSeen] = useState(() => storage.getBoolean('edge_back_seen') === true);
  const onTab = useCallback((t: ToolKey, via?: 'edge' | 'swipe') => {
    setTab(t);
    if (via === 'edge' || via === 'swipe') {
      storage.setBoolean('edge_back_seen', true);
      setEdgeSeen(true);
    }
  }, []);

  const token = useAuthStore((s) => s.token);
  const isFeatureVisible = useUIStore((s) => s.isFeatureVisible);
  // Сделки: сервер ответил 404 (флаг выключен) или ещё не ответил → вкладки нет.
  const dealsAvailable = useDealStore((s) => s.available);
  const fetchDeals = useDealStore((s) => s.fetch);
  useEffect(() => {
    void fetchDeals();
  }, [fetchDeals, token]);
  // Уровень интерфейса — из аккаунта (другой телефон, переустановка).
  useEffect(() => {
    void syncUiLevel();
  }, [token]);
  // «Здоровье» (если включено): сон и шаги; виджет «Сегодня» — при открытии
  // и возврате в приложение (сборка №15+, на остальных — тихо ничего).
  useEffect(() => {
    if (!token) return;
    void syncHealth();
    void syncWidget(true);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        void syncHealth();
        void syncWidget();
      } else if (st === 'background') void syncWidget(true); // уходя — свежий виджет
    });
    return () => sub.remove();
  }, [token]);
  // Мозг/экраны что-то поменяли (задача, привычка, встреча) — виджет догоняет.
  const scheduleRev = useScheduleStore((s) => s.revision);
  useEffect(() => {
    if (!token || scheduleRev === 0) return;
    const t = setTimeout(() => void syncWidget(true), 2000);
    return () => clearTimeout(t);
  }, [scheduleRev, token]);
  // Робот сам говорит, что заметил (нуджи мозга) — облачком при открытии приложения.
  useEffect(() => (token ? startRobotNudges(token) : undefined), [token]);
  const tools = useMemo(() => visiblePanels(isFeatureVisible, { dealsAvailable }), [isFeatureVisible, dealsAvailable]);
  // Вкладку скрыли в настройках (или сделки выключены) — показываем «Сегодня».
  const shownTab: ToolKey = tools.some((t) => t.key === tab) ? tab : 'today';

  const goPage = useCallback(
    (p: number) => {
      pager.current?.scrollTo({ x: p * width, animated: true });
      setPage(p);
    },
    [width],
  );

  // Запросы «покажи инструмент» (пуши, тап по мебели, кнопка «Инструменты», мозг).
  const toolSeq = useRoomToolStore((s) => s.seq);
  useEffect(() => {
    const t = useRoomToolStore.getState().take();
    if (t) setTab(t);
    if (toolSeq > 0) goPage(TOOLS_PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolSeq]);

  // «Покажи задачи» → мозг присылает openPanel → открываем вкладку (один раз на ответ).
  const latest = useChatStore((s) => s.messages[0]);
  const openedFor = useRef<string | null>(latest?.id ?? null);
  useEffect(() => {
    if (!latest || latest.role !== 'assistant' || openedFor.current === latest.id) return;
    if (Date.now() - new Date(latest.createdAt).getTime() > FRESH_REPLY_MS) return;
    openedFor.current = latest.id;
    // «Сфоткай чек» → камера чека (не вкладка).
    if (latest.openPanel === 'receipt') {
      navigateTo('ReceiptScan');
      return;
    }
    if (!isToolKey(latest.openPanel)) return;
    // Скрытая вкладка: сказать почему, а не молча открыть «Сегодня».
    const why = hiddenPanelReason(latest.openPanel, isFeatureVisible, { dealsAvailable });
    if (why) {
      useChatStore.getState().showNudge(`panel-${latest.id}`, why);
      return;
    }
    // Команда пришла с другого экрана (Настройки, Канбан…) — вернуться домой.
    if (currentRouteName() !== 'Home') navigateTo('Home');
    useRoomToolStore.getState().openTool(latest.openPanel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  // Свайп с любого места, как в Instagram (services/home-swipe.ts): на
  // инструментах влево — комната, вправо — «Сегодня»; в комнате вправо — «Сегодня».
  // Экран тянется за пальцем. Вертикальная прокрутка, полосы-карусели и
  // «минус» на строках (сдвиг влево) срабатывают раньше — им не мешаем.
  const pageRef = useRef(page);
  pageRef.current = page;
  const tabRef = useRef(shownTab);
  tabRef.current = shownTab;
  const homeSwipe = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-22, 22])
        .failOffsetY([-14, 14])
        .onUpdate((e) => {
          const x = dragOffset(pageRef.current === ROOM_PAGE ? 'room' : 'tools', e.translationX, width);
          if (x !== null) pager.current?.scrollTo({ x, animated: false });
        })
        .onEnd((e) => {
          const cur = pageRef.current === ROOM_PAGE ? 'room' : 'tools';
          const act = swipeDecision(cur, e.translationX, e.velocityX, width, tabRef.current === 'today');
          if (act === 'room') goPage(ROOM_PAGE);
          else if (act === 'today') {
            onTab('today', 'swipe');
            goPage(TOOLS_PAGE);
          } else goPage(cur === 'room' ? ROOM_PAGE : TOOLS_PAGE); // вернуть на место
        }),
    [width, goPage, onTab],
  );

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width)),
    [width],
  );

  return (
    <View style={styles.container}>
      <GestureDetector gesture={homeSwipe}>
        <View style={styles.container}>
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            bounces={false}
            // Листаем своим жестом (homeSwipe) — с любого места экрана, а не
            // только там, где под пальцем нет списка.
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onMomentumScrollEnd={onMomentumEnd}
            style={styles.container}
          >
            <View style={{ width }}>
              <ToolsPage tools={tools} tab={shownTab} onTab={onTab} width={width} />
            </View>
            <View style={{ width }}>
              <RoomPage active={page === ROOM_PAGE} />
            </View>
          </ScrollView>
        </View>
      </GestureDetector>
      {/* Новичок не знает про комнату робота (тур живёт там): одна строка у
          точек, пока он ни разу туда не заходил. */}
      {roomSeen && !edgeSeen && page === TOOLS_PAGE && shownTab !== 'today' && (
        <Text style={[styles.roomHint, { color: c.textSecondary }]} pointerEvents="none">
          Смахни вправо — вернёшься на «Сегодня»
        </Text>
      )}
      {!roomSeen && page === TOOLS_PAGE && (
        <Text style={[styles.roomHint, { color: c.textSecondary }]} pointerEvents="none">
          Смахни влево — там комната робота 🤖
        </Text>
      )}
      {/* Две точки: где ты — инструменты или комната. */}
      <View style={styles.dots} pointerEvents="none">
        {[TOOLS_PAGE, ROOM_PAGE].map((p) => (
          <View key={p} style={[styles.dot, { backgroundColor: p === page ? c.text : c.surfaceLight }]} />
        ))}
      </View>
      <View style={{ paddingBottom: kbOpen ? 0 : insets.bottom }}>
        <ChatInputRow />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 4 },
  roomHint: { textAlign: 'center', fontSize: 12, paddingTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
