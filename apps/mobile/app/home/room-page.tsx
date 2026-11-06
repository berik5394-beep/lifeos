import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, type LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { RobotAvatar } from '@/components/robot/robot-avatar';
import { RoomFurnitureItem } from '@/components/robot/room-furniture-item';
import { RoomDiorama } from '@/components/room/room-diorama';
import { RobotSpeechBubble } from '@/components/robot/robot-speech-bubble';
import { ChatReplyBubble } from '@/components/room/chat-reply-bubble';
import { RoomBottomBar } from '@/components/room/room-bottom-bar';
import { ToolCard } from '@/components/room/tool-card';
import { RoomShop } from '@/components/room/room-shop';
import { SlotGrid } from '@/components/room/slot-grid';
import { CoinCounter } from '@/components/room/coin-counter';
import { useScheduleStore } from '@/stores/schedule-store';
import { RoomIntro } from '@/components/room/room-intro';
import { useColors } from '@/hooks/use-colors';
import { useRobotReaction } from '@/hooks/use-robot-reaction';
import { useVoice } from '@/hooks/use-voice';
import { useRoomStore } from '@/stores/room-store';
import { useRoomToolStore } from '@/stores/room-tool-store';
import { useChatStore } from '@/stores/chat-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { useDealStore } from '@/stores/deal-store';
import { api } from '@/services/api';
import { storage } from '@/services/storage';
import { thanksFor } from '@/services/robot-thanks';
import { visiblePanels } from '@/services/panels';
import { ROBOT_SIDE_W, planPurchaseView, type SpeechLayout } from '@/services/speech-layout';
import { SLOT_POS, finishTier, isPlaceSlot, spotOf, type RoomSpot, type RoomVariant } from '@/services/room-catalog';
import { RENDER_SCALE as R, ZOOM_IN, clampPan, zoomOffset } from '@/services/room-geometry';
import { isToolKey, toolSource, toolsInItem, type ToolKey } from '@/services/room-tools';
import { ROBOT_STRIP_H, robotShift, robotStandPoint, toolOrigin } from '@/services/tool-scene';
import { TOOL_TITLE } from '@/components/room/tool-card';
import { hapticLight } from '@/services/haptics';
import { INTRO_STEPS, furnitureBadge, isIntroDone, markIntroDone } from '@/services/room-intro';
import { spacing, borderRadius } from '@/constants';
import { useUtterance } from '@/hooks/use-utterance';
import { DictationModal } from '@/components/voice';

/**
 * Робот-эпик, Части 4–5: комната — ЕДИНСТВЕННЫЙ экран приложения.
 * 3D-диорама квартиры в духе СНГ; внизу — разговор с роботом (текст/голос) и
 * полки «Инструменты» / «Обставить». Ответ робота — комиксовое облачко над ним.
 *
 * Инструменты живут в мебели (services/room-tools): робот подходит к предмету,
 * тянется, достаёт — карточка вылетает из предмета на весь экран, комната
 * отъезжает, маленький робот в углу показывает на инструмент и объясняет по
 * фактам (/robot/explain). Нет нужной мебели — достаёт «из воздуха».
 * Покупка предмета — приближение, робот показывает и благодарит (speech-layout).
 */
function timeTint(hour: number): string {
  if (hour >= 21 || hour < 6) return 'rgba(20,16,40,0.35)'; // ночь (абажур светит)
  if (hour < 10) return 'rgba(255,220,150,0.10)'; // утро
  if (hour >= 18) return 'rgba(255,140,90,0.12)'; // вечер
  return 'rgba(255,255,255,0)';
}

const PARALLAX_PX = 6;
const ZOOM_MS = 380;
const THANKS_MS = 8000;
/** Робот, пока открыт магазин (комната короче). */
const FURNISH_ROBOT_SCALE = 0.6;
const ROBOT_SIZE = 150;
/** Пишем роботу (клавиатура открыта): комната короткая — маленький робот в углу над вводом. */
const CHAT_ROBOT_SCALE = 0.42;
const VOICE_NOTE_MS = 4000;
const ROBOT_SIDE_SCALE = 0.68;
const ROBOT_CORNER_SCALE = 0.55;
const WALK_MS = 560;
const FETCH_MS = 380;
/** Ответ робота показываем, если он свежий (пришёл в этой сессии). */
const FRESH_REPLY_MS = 90_000;

type ToolPhase = 'walking' | 'fetching' | 'open';
interface ToolScene {
  tool: ToolKey;
  from: { x: number; y: number };
  sourceId: string | null;
  phase: ToolPhase;
  closing: boolean;
}

export const RoomPage = memo(function RoomPage() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const [headTurn, setHeadTurn] = useState<-1 | 0 | 1>(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoomed, setZoomed] = useState(false);
  const [reactionKey, setReactionKey] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  const [plan, setPlan] = useState<SpeechLayout | null>(null);
  const [newItemId, setNewItemId] = useState<string | null>(null);
  const [scene, setScene] = useState<ToolScene | null>(null);
  /** Когда открыли инструмент: ответы робота ПОСЛЕ этого видны поверх карточки. */
  const sceneOpenedAt = useRef(0);
  const [explain, setExplain] = useState<string | null>(null);
  /**
   * Объяснение робота устарело (поправили сделки руками или пришёл новый ответ робота) —
   * прячем, а не перезапрашиваем (бюджет ИИ). Сброс — при каждом открытии инструмента.
   */
  const [explainHidden, setExplainHidden] = useState(false);
  /** Номер запроса /robot/explain: поздний ответ для закрытого инструмента не попадёт в другой. */
  const explainSeq = useRef(0);
  /** На момент открытия: ревизия сделок и последний ответ робота — новее значит «объяснение устарело». */
  const dealsRevAtOpen = useRef(0);
  const replyIdAtOpen = useRef<string | undefined>(undefined);
  const [mirror, setMirror] = useState(false);
  const [typing, setTyping] = useState(false);
  const [dismissedReply, setDismissedReply] = useState<string | null>(null);
  // Знакомство после установки: робот показывает, что где. null — тур не идёт.
  const [introStep, setIntroStep] = useState<number | null>(() => (isIntroDone() ? null : 0));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const userName = useAuthStore((s) => s.user?.name ?? null);
  const token = useAuthStore((s) => s.token);
  const items = useRoomStore((s) => s.items);
  const owned = useRoomStore((s) => s.owned);
  const catalog = useRoomStore((s) => s.catalog);
  const coins = useRoomStore((s) => s.coins);
  const coinGain = useRoomStore((s) => s.coinGain);
  const fetchRoom = useRoomStore((s) => s.fetchRoom);
  const fetchCatalog = useRoomStore((s) => s.fetchCatalog);
  const fetchCoins = useRoomStore((s) => s.fetchCoins);
  const buy = useRoomStore((s) => s.buy);
  const moveItem = useRoomStore((s) => s.moveItem);
  const storeItem = useRoomStore((s) => s.storeItem);
  const placeFromStorage = useRoomStore((s) => s.placeFromStorage);
  const scheduleRevision = useScheduleStore((s) => s.revision);
  // Часть 6: ячейки видны, пока обставляешь или тащишь предмет.
  const [furnishing, setFurnishing] = useState(false);
  // Клавиатура открыта → режим разговора: робот маленький над полем ввода,
  // ответ — справа от него, а не огромный робот на пол-экрана.
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, () => setKbOpen(true));
    const b = Keyboard.addListener(hideEvt, () => setKbOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  const [dragSpot, setDragSpot] = useState<RoomSpot | null>(null);
  const [dragging, setDragging] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const wallsTier = useMemo(() => finishTier(owned, 'walls'), [owned]);
  const floorTier = useMemo(() => finishTier(owned, 'floor'), [owned]);
  const messages = useChatStore((s) => s.messages);
  const chatLoading = useChatStore((s) => s.isLoading);
  const confirmPendingAction = useChatStore((s) => s.confirmPendingAction);
  const isFeatureVisible = useUIStore((s) => s.isFeatureVisible);
  // Сделки: сервер ответил 404 (флаг выключен) или ещё не ответил → инструмента на столе нет.
  // Смена аккаунта (новый токен) — спрашиваем заново: у другого пользователя флаг может быть другим.
  const dealsAvailable = useDealStore((s) => s.available);
  const fetchDeals = useDealStore((s) => s.fetch);
  useEffect(() => {
    void fetchDeals();
  }, [fetchDeals, token]);
  const tools = useMemo(() => visiblePanels(isFeatureVisible, { dealsAvailable }), [isFeatureVisible, dealsAvailable]);
  const visibleToolKeys = useMemo(() => tools.map((t) => t.key), [tools]);
  const toolSeq = useRoomToolStore((s) => s.seq);
  const {
    isRecording,
    isProcessing,
    lastResult,
    liveTranscript,
    error: voiceError,
    startRecording,
    stopRecording,
  } = useVoice({ transcribeOnly: true });
  // Ошибка/подсказка голоса («удерживай кнопку…», «не расслышал») — облачком робота, ненадолго.
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  useEffect(() => {
    if (!voiceError) return;
    setVoiceNote(voiceError);
    const t = setTimeout(() => setVoiceNote(null), VOICE_NOTE_MS);
    return () => clearTimeout(t);
  }, [voiceError]);

  const latest = messages[0];
  const reply =
    latest && latest.role === 'assistant' && Date.now() - new Date(latest.createdAt).getTime() < FRESH_REPLY_MS
      ? latest
      : undefined;
  const replyEmotion = useRobotReaction(reply?.emotion, reply?.id ?? null);
  const happy = useRobotReaction('happy', reactionKey);
  const emotion = chatLoading ? 'thinking' : reactionKey && happy !== 'neutral' ? happy : replyEmotion;

  const hour = new Date().getHours();
  const tint = timeTint(hour);

  const shift = useSharedValue(0);
  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const robotX = useSharedValue(0);
  const robotY = useSharedValue(0);
  const robotS = useSharedValue(1);
  const recede = useSharedValue(0);
  // Сцена нарисована в R раз крупнее и уменьшена: издалека масштаб 1/R, вблизи — 1 (чётко).
  const sceneScale = useDerivedValue(() => zoom.value / R);

  useEffect(() => {
    fetchRoom();
    fetchCatalog();
  }, [fetchRoom, fetchCatalog]);

  // Монеты: при входе, после ответа робота (мог закрыть дело голосом), после
  // сдвига графика и закрытия инструмента (ниже) — заработанное всплывает «+N».
  const latestId = messages[0]?.id;
  useEffect(() => {
    fetchCoins();
  }, [fetchCoins, latestId, scheduleRevision]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // Голос → текст → мозг (как в чате, без двойного исполнения). Один микрофон:
  // «ЛайфОС, …» — обращение; «ЛайфОС, диктофон» / «давай поговорим» — свои функции.
  const utterance = useUtterance();
  const handleUtterance = utterance.handle;
  useEffect(() => {
    if (lastResult?.transcript) handleUtterance(lastResult.transcript);
  }, [lastResult, handleUtterance]);

  // Робот иногда мягко поворачивает голову, пока ничего не происходит.
  useEffect(() => {
    if (scene || zoomed) return;
    let back: ReturnType<typeof setTimeout>;
    const t = setInterval(() => {
      const options: Array<-1 | 0 | 1> = [-1, 0, 1, 0];
      setHeadTurn(options[Math.floor(Math.random() * options.length)]);
      back = setTimeout(() => setHeadTurn(0), 1400);
    }, 6000);
    return () => {
      clearInterval(t);
      clearTimeout(back);
    };
  }, [scene, zoomed]);

  useEffect(() => {
    shift.value = withSpring(-headTurn * PARALLAX_PX * R, { damping: 18, stiffness: 90 });
  }, [headTurn, shift]);

  useEffect(() => {
    if (!thanks) return;
    const t = setTimeout(() => setThanks(null), THANKS_MS);
    return () => clearTimeout(t);
  }, [thanks]);

  /** Робот-оверлей: сдвиг от места покоя и масштаб. */
  const moveRobot = useCallback(
    (x: number, y: number, s: number, ms = ZOOM_MS) => {
      robotX.value = withTiming(x, { duration: ms });
      robotY.value = withTiming(y, { duration: ms });
      robotS.value = withTiming(s, { duration: ms });
    },
    [robotX, robotY, robotS],
  );
  const robotToSide = useCallback(
    (side: 'left' | 'right') => {
      const sign = side === 'right' ? 1 : -1;
      moveRobot(
        sign * (size.w / 2 - (ROBOT_SIZE * ROBOT_SIDE_SCALE) / 2 - 8),
        (ROBOT_SIZE * (1 - ROBOT_SIDE_SCALE)) / 2,
        ROBOT_SIDE_SCALE,
      );
      setMirror(side === 'right');
    },
    [moveRobot, size.w],
  );
  const robotToRest = useCallback(() => {
    moveRobot(0, 0, 1);
    setMirror(false);
  }, [moveRobot]);

  const zoomWithOffset = useCallback(
    (off: { x: number; y: number }) => {
      zoom.value = withTiming(ZOOM_IN, { duration: ZOOM_MS });
      tx.value = withTiming(off.x, { duration: ZOOM_MS });
      ty.value = withTiming(off.y, { duration: ZOOM_MS });
      setZoomed(true);
    },
    [zoom, tx, ty],
  );

  const zoomTo = useCallback(
    (x: number, y: number) => {
      if (size.w === 0) return;
      zoomWithOffset(zoomOffset({ x, y }, size.w, size.h, ZOOM_IN));
      robotToSide('left');
    },
    [size, zoomWithOffset, robotToSide],
  );

  const zoomOut = useCallback(() => {
    zoom.value = withTiming(1, { duration: ZOOM_MS });
    tx.value = withTiming(0, { duration: ZOOM_MS });
    ty.value = withTiming(0, { duration: ZOOM_MS });
    setZoomed(false);
    setThanks(null);
    setNewItemId(null);
    setPlan(null);
    robotToRest();
  }, [zoom, tx, ty, robotToRest]);

  // ─── Инструмент: подошёл → достал → показал ─────────────────────────────
  const openToolScene = useCallback(
    (tool: ToolKey) => {
      if (size.w === 0) return;
      // Скрытый в настройках инструмент не достаём (как раньше: скрытая вкладка не открывалась).
      if (!visibleToolKeys.includes(tool)) return;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (zoomed) zoomOut();
      setThanks(null);
      setExplain(null);
      setExplainHidden(false);
      const seq = ++explainSeq.current;
      dealsRevAtOpen.current = useDealStore.getState().revision;
      replyIdAtOpen.current = useChatStore.getState().messages[0]?.id;

      const source = toolSource(tool, useRoomStore.getState().items, { x: 0.5, y: 0.96 });
      const from = toolOrigin(source, size.w, size.h);
      const stand = robotStandPoint(source, size.w, size.h);
      const { dx, dy } = robotShift(stand, size.w, size.h);
      setScene({ tool, from, sourceId: source?.id ?? null, phase: 'walking', closing: false });
      sceneOpenedAt.current = Date.now();
      setMirror(!!source && source.x * size.w < stand.x);
      moveRobot(dx, dy, source ? 0.8 : 1, source ? WALK_MS : 120);
      hapticLight();

      later(
        () => {
          setScene((s) => (s ? { ...s, phase: 'fetching' } : s));
          setNewItemId(source?.id ?? null);
        },
        source ? WALK_MS : 120,
      );
      later(
        () => {
          setScene((s) => (s ? { ...s, phase: 'open' } : s));
          recede.value = withTiming(1, { duration: 420 });
          // Маленький робот в углу показывает на инструмент.
          moveRobot(
            -(size.w / 2 - (ROBOT_SIZE * ROBOT_CORNER_SCALE) / 2 - 6),
            (ROBOT_SIZE * (1 - ROBOT_CORNER_SCALE)) / 2,
            ROBOT_CORNER_SCALE,
            420,
          );
          setMirror(false);
          setNewItemId(null);
          api
            .post<{ text: string }>('/robot/explain', { panel: tool }, token ?? undefined)
            .then((r) => {
              if (seq === explainSeq.current) setExplain(r.text);
            })
            .catch(() => {
              if (seq === explainSeq.current) setExplain(`Вот ${TOOL_TITLE[tool].toLowerCase()} — смотри!`);
            });
        },
        (source ? WALK_MS : 120) + FETCH_MS,
      );
    },
    [size, zoomed, zoomOut, moveRobot, later, recede, token, visibleToolKeys],
  );

  const closeTool = useCallback(() => {
    setScene((s) => (s ? { ...s, closing: true } : s));
    recede.value = withTiming(0, { duration: 420 });
    explainSeq.current += 1;
    setExplain(null);
  }, [recede]);

  // Сделки поправили руками, пока открыт инструмент «Сделки», — цифры в объяснении устарели.
  const dealsRevision = useDealStore((s) => s.revision);
  const sceneTool = scene?.tool ?? null;
  useEffect(() => {
    if (sceneTool === 'deals' && dealsRevision !== dealsRevAtOpen.current) setExplainHidden(true);
  }, [sceneTool, dealsRevision]);
  // Новый ответ робота после открытия (голосом что-то поменяли) — объяснение тоже устарело.
  const latestAssistantId = messages[0]?.role === 'assistant' ? messages[0].id : undefined;
  useEffect(() => {
    if (sceneTool && latestAssistantId && latestAssistantId !== replyIdAtOpen.current) setExplainHidden(true);
  }, [sceneTool, latestAssistantId]);

  const onToolClosed = useCallback(() => {
    setScene(null);
    robotToRest();
    void fetchCoins(); // в инструменте могли закрыть задачи/привычки
  }, [robotToRest, fetchCoins]);

  // Запросы «достань инструмент» из пушей/голоса/дашборда.
  // Забираем запрос, только когда комната уже знает свой размер — иначе пуш на
  // холодном старте «съедался» бы до раскладки и ничего не открывалось.
  useEffect(() => {
    if (size.w === 0) return;
    const tool = useRoomToolStore.getState().take();
    if (tool) openToolScene(tool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolSeq, size.w]);

  // «Покажи задачи» → мозг присылает openPanel → робот достаёт (один раз на ответ).
  const openedFor = useRef<string | null>(reply?.id ?? null);
  useEffect(() => {
    if (!reply || openedFor.current === reply.id || !isToolKey(reply.openPanel)) return;
    openedFor.current = reply.id;
    openToolScene(reply.openPanel);
  }, [reply, openToolScene]);

  // ─── Жесты сцены: двойное нажатие — приблизить/отдалить, вблизи — панорама ──
  const onDoubleTap = useCallback(
    (sx: number, sy: number) => {
      if (scene) return;
      if (zoomed) zoomOut();
      else zoomTo(sx, sy);
    },
    [scene, zoomed, zoomOut, zoomTo],
  );
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e, ok) => {
      if (ok) runOnJS(onDoubleTap)(e.x, e.y);
    });
  const lookAround = Gesture.Pan()
    .enabled(zoomed && !scene)
    .minDistance(6)
    .onStart(() => {
      panStartX.value = tx.value;
      panStartY.value = ty.value;
    })
    .onUpdate((e) => {
      const t = clampPan(
        { x: panStartX.value + e.translationX, y: panStartY.value + e.translationY },
        size.w,
        size.h,
        zoom.value,
      );
      tx.value = t.x;
      ty.value = t.y;
    });
  const sceneGesture = Gesture.Simultaneous(doubleTap, lookAround);

  const sceneStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sceneScale.value }],
  }));
  const furnitureStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));
  const robotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: robotX.value }, { translateY: robotY.value }, { scale: robotS.value }],
  }));
  // Комната «отъезжает», когда достали инструмент.
  const recedeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - 0.1 * recede.value }],
    borderRadius: 24 + 8 * recede.value,
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: 0.55 * recede.value }));

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  }, []);

  const onRemove = useCallback(
    (id: string) => {
      Alert.alert('Убрать в кладовку?', 'Предмет остаётся твоим — поставить обратно бесплатно («Обставить» → «Кладовка»).', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'В кладовку', onPress: () => storeItem(id) },
      ]);
    },
    [storeItem],
  );

  const onDragState = useCallback(
    (id: string, on: boolean) => {
      setDragging(on);
      const it = useRoomStore.getState().owned.find((o) => o.id === id);
      setDragSpot(on && it ? spotOf(it.itemKey) : null);
    },
    [],
  );

  const onPlace = useCallback(
    (id: string) => {
      if (!placeFromStorage(id)) Alert.alert('Места нет', 'Все подходящие ячейки заняты — убери что-нибудь долгим нажатием.');
    },
    [placeFromStorage],
  );

  // Тап по мебели с инструментом — робот достаёт его (два в предмете — спрашиваем какой).
  const onItemTap = useCallback(
    (id: string) => {
      const it = useRoomStore.getState().items.find((i) => i.id === id);
      if (!it) return;
      const inside = toolsInItem(it.itemKey).filter((t) => tools.some((p) => p.key === t));
      if (inside.length === 1) openToolScene(inside[0]);
      else if (inside.length > 1) {
        Alert.alert('Что достать?', undefined, [
          ...inside.map((t) => ({ text: TOOL_TITLE[t], onPress: () => openToolScene(t) })),
          { text: 'Отмена', style: 'cancel' as const },
        ]);
      }
    },
    [tools, openToolScene],
  );

  const onBuy = useCallback(
    async (v: RoomVariant) => {
      if (scene) closeTool();
      setBuying(v.key);
      const res = await buy(v.key);
      setBuying(null);
      if (!res.ok) {
        Alert.alert('Не получилось', res.error);
        return;
      }
      setReactionKey(String(Date.now()));
      const slot = res.item.slot;
      if (!slot) {
        Alert.alert('Куплено — в кладовке', 'Подходящие ячейки заняты. Освободи место долгим нажатием и поставь из «Кладовки».');
        return;
      }
      if (size.w === 0) return;
      // Робот «понимает» экран: где окажется предмет и где свободно для реплики.
      // Отделка — смотрим на стену/пол; мебель — на её ячейку.
      const at = isPlaceSlot(slot) ? SLOT_POS[slot] : slot === 'finish-walls' ? { x: 0.5, y: 0.4 } : { x: 0.5, y: 0.78 };
      const text = thanksFor(v.kind, storage.getString('assistantStyle'), userName, Math.random, v.tier);
      const layout = planPurchaseView(at.x, at.y, size.w, size.h, text);
      zoomWithOffset(layout.offset);
      robotToSide(layout.robotSide);
      setPlan(layout);
      setNewItemId(isPlaceSlot(slot) ? res.item.id : null);
      setThanks(text);
    },
    [scene, closeTool, buy, zoomWithOffset, robotToSide, size, userName],
  );

  // Обставляем: комната короче (магазин снизу) — робот уменьшается, чтобы не
  // закрывать задние ячейки; ноги остаются на полу.
  const chatMode = kbOpen && !zoomed && !scene && introStep == null;
  useEffect(() => {
    if (zoomed || scene) return;
    if (chatMode) {
      // Левый нижний угол: ноги на полу, сразу над строкой ввода.
      moveRobot(
        -(size.w / 2 - (ROBOT_SIZE * CHAT_ROBOT_SCALE) / 2 - 6),
        (ROBOT_SIZE * (1 - CHAT_ROBOT_SCALE)) / 2,
        CHAT_ROBOT_SCALE,
        220,
      );
    } else if (furnishing) moveRobot(0, (ROBOT_SIZE * (1 - FURNISH_ROBOT_SCALE)) / 2, FURNISH_ROBOT_SCALE);
    else robotToRest();
  }, [chatMode, size.w, furnishing, zoomed, scene, moveRobot, robotToRest]);

  const onShelfChange = useCallback(
    (shelf: 'tools' | 'furnish' | null) => {
      setFurnishing(shelf === 'furnish');
      if (shelf === 'furnish') {
        fetchCatalog();
        fetchCoins();
      }
    },
    [fetchCatalog, fetchCoins],
  );

  const onTool = useCallback((key: string) => isToolKey(key) && openToolScene(key), [openToolScene]);
  const introTarget = introStep == null ? null : INTRO_STEPS[introStep].target;
  const finishIntro = useCallback(() => {
    markIntroDone();
    setIntroStep(null);
  }, []);
  const nextIntro = useCallback(() => {
    setIntroStep((s) => (s == null || s >= INTRO_STEPS.length - 1 ? (markIntroDone(), null) : s + 1));
  }, []);
  const onSend = handleUtterance;
  const onConfirm = useCallback(
    (yes: boolean) => {
      if (reply) void confirmPendingAction(reply.id, yes);
    },
    [reply, confirmPendingAction],
  );

  const pointing = zoomed || scene?.phase === 'fetching' || scene?.phase === 'open';
  const showReply =
    introStep == null && !scene && !zoomed && (chatLoading || (reply && dismissedReply !== reply.id));
  // Пока открыта карточка: ответ робота, пришедший уже при ней (в т.ч.
  // предложение сдвинуть график после сохранения задачи), — над маленьким
  // роботом, с кнопками. Раньше ответ на «Скажи роботу…» был не виден до закрытия.
  const sceneReply =
    reply &&
    dismissedReply !== reply.id &&
    ((reply.kind === 'proposal' && !!reply.pendingAction) || new Date(reply.createdAt).getTime() >= sceneOpenedAt.current)
      ? reply
      : undefined;
  const showProposal = !!scene && scene.phase === 'open' && !scene.closing && (chatLoading || !!sceneReply);
  const voiceBubble = isRecording
    ? liveTranscript || 'Слушаю… говори, пока держишь кнопку'
    : isProcessing
      ? 'Распознаю…'
      : voiceNote;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <GestureDetector gesture={sceneGesture}>
        <View style={styles.roomOuter} onLayout={onLayout}>
          <Animated.View style={[styles.room, recedeStyle]}>
            <Animated.View
              style={[
                styles.scene,
                {
                  left: (size.w - size.w * R) / 2,
                  top: (size.h - size.h * R) / 2,
                  width: size.w * R,
                  height: size.h * R,
                },
                sceneStyle,
              ]}
            >
              <RoomDiorama width={size.w * R} height={size.h * R} hour={hour} wallsTier={wallsTier} floorTier={floorTier} />
              <Animated.View style={[StyleSheet.absoluteFill, furnitureStyle]} pointerEvents="box-none">
                {size.w > 0 && (furnishing || dragging) && !scene && (
                  <SlotGrid width={size.w * R} height={size.h * R} owned={owned} dragSpot={dragSpot} />
                )}
                {size.w > 0 &&
                  items.map((item) => (
                    <RoomFurnitureItem
                      key={item.id}
                      item={item}
                      roomWidth={size.w * R}
                      roomHeight={size.h * R}
                      blockGestures={[lookAround]}
                      zoom={sceneScale}
                      onMove={moveItem}
                      onRemove={onRemove}
                      onTap={onItemTap}
                      highlight={item.id === newItemId}
                      badge={furnitureBadge(item.itemKey, visibleToolKeys)}
                      pulseBadge={introTarget === 'furniture'}
                      onDragState={(on) => onDragState(item.id, on)}
                    />
                  ))}
              </Animated.View>
            </Animated.View>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} pointerEvents="none" />
          </Animated.View>

          {/* Затемнение отъехавшей комнаты; тап — убрать инструмент. */}
          {scene && (
            <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]}>
              <Pressable style={StyleSheet.absoluteFill} onPress={closeTool} accessibilityLabel="Убрать инструмент" />
            </Animated.View>
          )}

          {scene && scene.phase === 'open' && (
            <ToolCard
              tool={scene.tool}
              from={scene.from}
              width={size.w}
              height={size.h}
              closing={scene.closing}
              onClose={closeTool}
              onClosed={onToolClosed}
            />
          )}

          {/* Реплики под роботом: поднятая рука робота поверх облачка. */}
          {zoomed && thanks && plan && (
            <View
              style={
                plan.zone === 'top'
                  ? styles.bubbleTop
                  : plan.robotSide === 'left'
                    ? styles.bubbleBottomRight
                    : styles.bubbleBottomLeft
              }
              pointerEvents="none"
            >
              <RobotSpeechBubble text={thanks} tail={plan.tail} />
            </View>
          )}
          {showProposal && (
            <View style={styles.bubbleProposal}>
              <ChatReplyBubble
                text={sceneReply?.content ?? ''}
                thinking={chatLoading}
                tail="bottom"
                confirm={!chatLoading && !!sceneReply?.pendingAction}
                onConfirm={onConfirm}
                onDismiss={sceneReply ? () => setDismissedReply(sceneReply.id) : undefined}
              />
            </View>
          )}
          {/* Карточка открыта, держишь микрофон — что расслышал, в полосе под карточкой. */}
          {scene?.phase === 'open' && !scene.closing && !showProposal && voiceBubble && (
            <View style={styles.bubbleExplain} pointerEvents="none">
              <ChatReplyBubble text={voiceBubble} tail="left" />
            </View>
          )}
          {/* Скрытое (устаревшее) объяснение не показываем вовсе — иначе вместо него висело бы «…».
              Клавиатура открыта — комната сжата, облачко легло бы на карточку: прячем. */}
          {scene?.phase === 'open' && !scene.closing && !showProposal && !voiceBubble && !explainHidden && !kbOpen && (
            <View style={styles.bubbleExplain} pointerEvents="none">
              {explain ? <RobotSpeechBubble text={explain} tail="left" /> : <ChatReplyBubble text="" thinking tail="left" />}
            </View>
          )}
          {showReply && !chatMode && !voiceBubble && (
            <View style={[styles.bubbleReply, { bottom: size.h * 0.04 + ROBOT_SIZE + 6 }]}>
              <ChatReplyBubble
                text={reply?.content ?? ''}
                thinking={chatLoading}
                tail="bottom"
                confirm={!chatLoading && !!reply?.pendingAction}
                onConfirm={onConfirm}
                onDismiss={reply ? () => setDismissedReply(reply.id) : undefined}
              />
            </View>
          )}
          {/* Пишем роботу: ответ справа от маленького робота, длинный — прокручивается. */}
          {chatMode && (showReply || voiceBubble) && (
            <View style={[styles.bubbleChat, { maxHeight: Math.max(80, size.h - 56) }]}>
              <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <ChatReplyBubble
                  text={voiceBubble ?? reply?.content ?? ''}
                  thinking={!voiceBubble && chatLoading}
                  tail="left"
                  confirm={!voiceBubble && !chatLoading && !!reply?.pendingAction}
                  onConfirm={onConfirm}
                  onDismiss={!voiceBubble && reply ? () => setDismissedReply(reply.id) : undefined}
                />
              </ScrollView>
            </View>
          )}
          {/* Голос: пока держишь — что расслышал; ошибка — подсказка. */}
          {!chatMode && voiceBubble && !scene && !zoomed && (
            <View style={[styles.bubbleReply, { bottom: size.h * 0.04 + ROBOT_SIZE + 6 }]} pointerEvents="none">
              <ChatReplyBubble text={voiceBubble} tail="bottom" />
            </View>
          )}

          {introStep != null && (
            <RoomIntro
              step={introStep}
              bubbleBottom={size.h * 0.04 + ROBOT_SIZE + 6}
              onNext={nextIntro}
              onSkip={finishIntro}
            />
          )}

          <Animated.View style={[styles.robot, robotStyle]} pointerEvents="none">
            <View style={mirror ? styles.mirror : undefined}>
              <RobotAvatar
                emotion={emotion}
                size={ROBOT_SIZE}
                headTurn={pointing ? 1 : headTurn}
                pointing={pointing}
                attention={typing || isRecording ? 'listening' : 'idle'}
              />
            </View>
          </Animated.View>

          {!scene && (
          <View style={styles.topLeft}>
            <Pressable
              style={styles.iconBtn}
              onPress={() => navigation.navigate('ChatHistory')}
              accessibilityRole="button"
              accessibilityLabel="История разговора"
            >
              <Feather name="message-circle" size={18} color="#FFFFFF" />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel="Настройки"
            >
              <Feather name="settings" size={18} color="#FFFFFF" />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => setIntroStep(0)}
              accessibilityRole="button"
              accessibilityLabel="Показать подсказки ещё раз"
            >
              <Feather name="help-circle" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
          )}
          {!zoomed && !scene && (
            <View style={styles.topRight} pointerEvents="none">
              <CoinCounter coins={coins} gain={coinGain} />
            </View>
          )}
          {zoomed && !scene && (
            <Pressable
              onPress={zoomOut}
              style={[styles.iconBtn, styles.topRight]}
              accessibilityRole="button"
              accessibilityLabel="Отдалить комнату"
            >
              <Feather name="minimize-2" size={18} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
      </GestureDetector>

      <RoomBottomBar
        tools={tools}
        onTool={onTool}
        shop={
          <RoomShop
            catalog={catalog}
            owned={owned}
            coins={coins}
            busy={buying}
            onBuy={(v) => void onBuy(v)}
            onPlace={onPlace}
          />
        }
        onShelfChange={onShelfChange}
        onSend={onSend}
        sending={chatLoading}
        isRecording={isRecording}
        isProcessing={isProcessing}
        onMicIn={() => void startRecording()}
        onMicOut={() => void stopRecording()}
        onTyping={setTyping}
        compact={kbOpen}
        highlight={introTarget === 'input' || introTarget === 'tools' || introTarget === 'furnish' ? introTarget : null}
      />
      <DictationModal visible={utterance.dictationOpen} onClose={utterance.closeDictation} />
    </SafeAreaView>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    roomOuter: { flex: 1, marginHorizontal: spacing.sm, marginTop: spacing.sm },
    room: { flex: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#0B1022' },
    scene: { position: 'absolute' },
    dim: { backgroundColor: '#05070F', borderRadius: 24 },
    robot: { position: 'absolute', left: 0, right: 0, bottom: '4%', alignItems: 'center' },
    // Облачко благодарности там, где свободно (services/speech-layout).
    bubbleBottomRight: { position: 'absolute', left: ROBOT_SIDE_W - 8, right: -6, bottom: 4 },
    bubbleBottomLeft: { position: 'absolute', left: -6, right: ROBOT_SIDE_W - 8, bottom: 4 },
    bubbleTop: { position: 'absolute', left: -4, right: -4, top: 4 },
    // Пояснение к инструменту — в полосе под карточкой, справа от маленького робота.
    bubbleExplain: { position: 'absolute', left: 64, right: -6, bottom: 2, maxHeight: ROBOT_STRIP_H },
    // Ответ робота в разговоре — над ним, хвостик вниз.
    bubbleReply: { position: 'absolute', left: 0, right: 0 },
    // Режим разговора: справа от маленького робота, низ — на уровне пола.
    bubbleChat: { position: 'absolute', left: ROBOT_SIZE * CHAT_ROBOT_SCALE + 6, right: 2, bottom: 6 },
    // Предложение перегруза поверх низа карточки, хвостик к маленькому роботу.
    bubbleProposal: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: ROBOT_STRIP_H - 8 },
    mirror: { transform: [{ scaleX: -1 }] },
    topLeft: { position: 'absolute', top: spacing.sm, left: spacing.sm, flexDirection: 'row', gap: spacing.sm },
    topRight: { position: 'absolute', top: spacing.sm, right: spacing.sm },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: borderRadius.lg,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
