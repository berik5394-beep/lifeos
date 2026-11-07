import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
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

function HomePager() {
  const c = useColors();
  const { width } = useWindowDimensions();
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

  const token = useAuthStore((s) => s.token);
  const isFeatureVisible = useUIStore((s) => s.isFeatureVisible);
  // Сделки: сервер ответил 404 (флаг выключен) или ещё не ответил → вкладки нет.
  const dealsAvailable = useDealStore((s) => s.available);
  const fetchDeals = useDealStore((s) => s.fetch);
  useEffect(() => {
    void fetchDeals();
  }, [fetchDeals, token]);
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

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width)),
    [width],
  );

  return (
    <View style={styles.container}>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={onMomentumEnd}
        style={styles.container}
      >
        <View style={{ width }}>
          <ToolsPage tools={tools} tab={shownTab} onTab={setTab} width={width} />
        </View>
        <View style={{ width }}>
          <RoomPage active={page === ROOM_PAGE} />
        </View>
      </ScrollView>
      {/* Новичок не знает про комнату робота (тур живёт там): одна строка у
          точек, пока он ни разу туда не заходил. */}
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
      <ChatInputRow />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 4 },
  roomHint: { textAlign: 'center', fontSize: 12, paddingTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
