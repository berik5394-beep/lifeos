import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, type LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { RoomShop } from '@/components/room/room-shop';
import { CoinCounter } from '@/components/room/coin-counter';
import { ROOM_INK, ROOM_INK_HALO } from '@/constants/room-ui';
import { RoomTilt } from '@/components/room/room-tilt';
import { SoftSpot, Vignette } from '@/components/room/face-light';
import { useScheduleStore } from '@/stores/schedule-store';
import { RoomIntro } from '@/components/room/room-intro';
import { useColors } from '@/hooks/use-colors';
import { useRobotReaction } from '@/hooks/use-robot-reaction';
import { useCurrentRoute, useReplyBubble } from '@/hooks/use-reply-bubble';
import { useRobotReactionStore } from '@/stores/robot-reaction-store';
import { useSharedVoice } from '@/hooks/shared-voice';
import { useRoomStore } from '@/stores/room-store';
import { useRoomToolStore } from '@/stores/room-tool-store';
import { useChatStore } from '@/stores/chat-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { useDealStore } from '@/stores/deal-store';
import { storage } from '@/services/storage';
import { thanksFor } from '@/services/robot-thanks';
import { visiblePanels } from '@/services/panels';
import { ROBOT_SIDE_W, planPurchaseView, type SpeechLayout } from '@/services/speech-layout';
import { finishTier, placedItems, roomItemLabel, spotOf, type RoomVariant } from '@/services/room-catalog';
import { RENDER_SCALE as R, ZOOM_IN, clampPan, headingFor, nearestTurn, surfaceToScene, zoomOffset, type RoomCam } from '@/services/room-geometry';
import { furnitureTapNote, toolsInItem, type ToolKey } from '@/services/room-tools';
import { TOOL_TITLE } from '@/components/room/tool-screens';
import { INTRO_STEPS, furnitureBadge, isIntroDone, markIntroDone } from '@/services/room-intro';
import { spacing } from '@/constants';

/**
 * Комната робота — отдельный экран (свайп от инструментов). 3D-диорама квартиры
 * в духе СНГ, обстановка за монеты, ответ робота — комиксовое облачко над ним.
 * Мебель с инструментом: тап — переходим на экран инструментов, нужная вкладка.
 * Покупка предмета — приближение, робот показывает и благодарит (speech-layout).
 */
function timeTint(hour: number): string {
  if (hour >= 21 || hour < 6) return 'rgba(20,16,40,0.35)'; // ночь (абажур светит)
  if (hour < 10) return 'rgba(255,220,150,0.10)'; // утро
  if (hour >= 18) return 'rgba(255,140,90,0.12)'; // вечер
  return 'rgba(255,255,255,0)';
}

/** Поворот головы робота сдвигает дальнюю стену на столько pt — комната «приоткрывается». */
const PARALLAX_PX = 10;
const ZOOM_MS = 380;
/** Поворот к стене (встать лицом к предмету / осмотреться). */
const TURN_MS = 650;
/** Встать перед предметом: приблизить мягче, чтобы было видно и стену вокруг. */
const LOOK_ZOOM = 1.6;
const THANKS_MS = 8000;
/** Робот, пока открыт магазин (комната короче). */
const FURNISH_ROBOT_SCALE = 0.6;
const ROBOT_SIZE = 150;
/** Пишем роботу (клавиатура открыта): комната короткая — маленький робот в углу над вводом. */
const CHAT_ROBOT_SCALE = 0.42;
const VOICE_NOTE_MS = 4000;
const ROBOT_SIDE_SCALE = 0.68;
/** Ответ робота показываем, если он свежий (пришёл в этой сессии). */
/** Ответ робота без «Подтвердить» сам уходит (как на экране инструментов). */
const REPLY_BUBBLE_MS = 9000;
/** Щипок: отпустил мельче этого — комната целиком; меньше 1× — лёгкая «резинка». */
const PINCH_OUT_BELOW = 1.15;
const PINCH_MIN = 0.85;

export const RoomPage = memo(function RoomPage({ active = true }: { active?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const [headTurn, setHeadTurn] = useState<-1 | 0 | 1>(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoomed, setZoomed] = useState(false);
  const [reactionKey, setReactionKey] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  const [plan, setPlan] = useState<SpeechLayout | null>(null);
  const [newItemId, setNewItemId] = useState<string | null>(null);
  const [mirror, setMirror] = useState(false);
  // Знакомство после установки: робот показывает, что где. null — тур не идёт.
  const [introStep, setIntroStep] = useState<number | null>(() => (isIntroDone() ? null : 0));

  const userName = useAuthStore((s) => s.user?.name ?? null);
  const token = useAuthStore((s) => s.token);
  const items = useRoomStore((s) => s.items);
  const owned = useRoomStore((s) => s.owned);
  const catalog = useRoomStore((s) => s.catalog);
  const coins = useRoomStore((s) => s.coins);
  const coinGain = useRoomStore((s) => s.coinGain);
  const friendship = useRoomStore((s) => s.friendship);
  const fetchFriendship = useRoomStore((s) => s.fetchFriendship);
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
  /** Направление взгляда (целое 0..3) и предмет, перед которым «стоим». */
  const [heading, setHeading] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
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
  // Голос — общий для обоих экранов (один микрофон под ними).
  const { isRecording, isProcessing, liveTranscript, error: voiceError, typing, setInputHighlight } = useSharedVoice();
  // Ошибка/подсказка голоса («удерживай кнопку…», «не расслышал») — облачком робота, ненадолго.
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  useEffect(() => {
    if (!voiceError) return;
    setVoiceNote(voiceError);
    const t = setTimeout(() => setVoiceNote(null), VOICE_NOTE_MS);
    return () => clearTimeout(t);
  }, [voiceError]);

  // Ответ робота — одно облачко на всё приложение (use-reply-bubble).
  const route = useCurrentRoute();
  const host = active && (route ?? 'Home') === 'Home' ? 'room' : null;
  const { reply, dismiss: dismissReply } = useReplyBubble(host);
  const replyEmotion = useRobotReaction(reply?.emotion, reply?.id ?? null);
  const happy = useRobotReaction('happy', reactionKey);
  // Действие с экрана инструментов — эмоцию видно и здесь, если свайпнул сразу.
  const screenReaction = useRobotReactionStore((s) => s.reaction);
  const freshScreen =
    screenReaction && Date.now() - screenReaction.at < REPLY_BUBBLE_MS ? screenReaction : null;
  const screenEmotion = useRobotReaction(freshScreen?.emotion, freshScreen?.id ?? null);
  const emotion = chatLoading
    ? 'thinking'
    : reactionKey && happy !== 'neutral'
      ? happy
      : screenEmotion !== 'neutral'
        ? screenEmotion
        : replyEmotion;

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
  // Камера комнаты: поворот головы робота + наклон телефона (пиксели сцены).
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  // Куда смотрим: 0 — задняя стена, 1 — правая, 2 — передняя, 3 — левая (дробное — поворот).
  const turn = useSharedValue(0);
  const cam = useDerivedValue<RoomCam>(() => ({ x: shift.value + tiltX.value, y: tiltY.value, turn: turn.value }));
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
    // Робот-друг №4: уровень дружбы растёт от тех же разговоров и дел.
    fetchFriendship();
  }, [fetchCoins, fetchFriendship, latestId, scheduleRevision]);

  // Робот иногда мягко поворачивает голову, пока ничего не происходит.
  useEffect(() => {
    if (zoomed) return;
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
  }, [zoomed]);

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
    (off: { x: number; y: number }, scale: number = ZOOM_IN) => {
      zoom.value = withTiming(scale, { duration: ZOOM_MS });
      tx.value = withTiming(off.x, { duration: ZOOM_MS });
      ty.value = withTiming(off.y, { duration: ZOOM_MS });
      setZoomed(true);
    },
    [zoom, tx, ty],
  );

  const zoomOut = useCallback(() => {
    zoom.value = withTiming(1, { duration: ZOOM_MS });
    tx.value = withTiming(0, { duration: ZOOM_MS });
    ty.value = withTiming(0, { duration: ZOOM_MS });
    setZoomed(false);
    setThanks(null);
    setNewItemId(null);
    setPlan(null);
    setViewing(null);
    robotToRest();
  }, [zoom, tx, ty, robotToRest]);

  // Инструмент — на соседнем экране: просим дом показать нужную вкладку.
  const showTool = useCallback((tool: ToolKey) => {
    useRoomToolStore.getState().openTool(tool);
  }, []);

  // ─── Жесты сцены: щипок — приблизить/отдалить (как фото), вблизи — панорама ──
  // Berik 2026-11-09: «увеличение не тапом, а раздвиганием пальцев». Масштаб
  // плавный, вокруг точки между пальцами; отпустил почти на 1× — комната
  // возвращается целиком.
  const pinchStartZ = useSharedValue(1);
  const pinchFX = useSharedValue(0);
  const pinchFY = useSharedValue(0);
  const onPinchEnd = useCallback(
    (z: number) => {
      if (z < PINCH_OUT_BELOW) {
        zoomOut();
        return;
      }
      if (!zoomed) robotToSide('left');
      setZoomed(true);
    },
    [zoomed, zoomOut, robotToSide],
  );
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      pinchStartZ.value = zoom.value;
      panStartX.value = tx.value;
      panStartY.value = ty.value;
      pinchFX.value = e.focalX - size.w / 2;
      pinchFY.value = e.focalY - size.h / 2;
    })
    .onUpdate((e) => {
      const z = Math.min(ZOOM_IN, Math.max(PINCH_MIN, pinchStartZ.value * e.scale));
      // Точка между пальцами остаётся под пальцами: t = f − (z/z0)·(f − t0).
      const k = z / pinchStartZ.value;
      const t = clampPan(
        { x: pinchFX.value - k * (pinchFX.value - panStartX.value), y: pinchFY.value - k * (pinchFY.value - panStartY.value) },
        size.w,
        size.h,
        Math.max(1, z),
      );
      zoom.value = z;
      tx.value = t.x;
      ty.value = t.y;
    })
    .onEnd(() => {
      runOnJS(onPinchEnd)(zoom.value);
    });
  // Вблизи — одним пальцем смотреть по сторонам.
  const lookAround = Gesture.Pan()
    .enabled(zoomed)
    .maxPointers(1)
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
  const sceneGesture = Gesture.Simultaneous(pinch, lookAround);

  const sceneStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sceneScale.value }],
  }));
  const robotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: robotX.value }, { translateY: robotY.value }, { scale: robotS.value }],
  }));

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


  const onPlace = useCallback(
    (id: string) => {
      // Встаёт на свободное привычное место — дальше двигай пальцем куда хочешь.
      placeFromStorage(id);
    },
    [placeFromStorage],
  );

  // Повернуться к стене h (короткой дорогой); по окончании — onDone.
  const turnTo = useCallback(
    (h: number, onDone?: () => void) => {
      const target = nearestTurn(turn.value, h);
      const norm = ((h % 4) + 4) % 4;
      setHeading(norm);
      if (target === turn.value) {
        onDone?.();
        return;
      }
      turn.value = withTiming(target, { duration: TURN_MS }, (finished) => {
        if (!finished) return;
        turn.value = norm; // то же направление, без накопления оборотов
        if (onDone) runOnJS(onDone)();
      });
    },
    [turn],
  );

  // Открыть то, что лежит в предмете (два — спрашиваем какой).
  const openItemTools = useCallback(
    (itemKey: string) => {
      const inside = toolsInItem(itemKey as never).filter((t) => tools.some((p) => p.key === t));
      if (inside.length === 1) showTool(inside[0]);
      else if (inside.length > 1) {
        Alert.alert('Что достать?', undefined, [
          ...inside.map((t) => ({ text: TOOL_TITLE[t], onPress: () => showTool(t) })),
          { text: 'Отмена', style: 'cancel' as const },
        ]);
      }
    },
    [tools, showTool],
  );

  /**
   * Тап по предмету (Berik 2026-11-09): «экран встаёт прямо перед ним» — комната
   * поворачивается к его стене и приближает его. Повторный тап (или кнопка
   * «Открыть») — достать инструмент, если он в предмете лежит.
   */
  const onItemTap = useCallback(
    (id: string) => {
      const it = useRoomStore.getState().items.find((i) => i.id === id);
      if (!it || size.w === 0) return;
      if (viewing === id) {
        openItemTools(it.itemKey);
        return;
      }
      const h = headingFor(it.surface) ?? heading;
      // Без инструмента внутри — робот скажет, что это (раньше тап был тишиной).
      const inside = toolsInItem(it.itemKey).filter((t) => tools.some((tool) => tool.key === t));
      const note = inside.length === 0 ? furnitureTapNote(it.itemKey, roomItemLabel(it.itemKey), visibleToolKeys, TOOL_TITLE) : null;
      turnTo(h, () => {
        // Где предмет окажется, когда стена будет напротив, — туда и приближаем.
        const sp = surfaceToScene(size.w * R, size.h * R, { x: 0, y: 0, turn: h }, it.surface, it.u, it.v);
        // Сцена нарисована в R раз крупнее и уменьшена вокруг центра: экран = сцена / R.
        const p = { x: sp.x / R, y: sp.y / R };
        zoomWithOffset(zoomOffset(p, size.w, size.h, LOOK_ZOOM), LOOK_ZOOM);
        robotToSide(p.x > size.w / 2 ? 'left' : 'right');
        // Облачку нужен план раскладки (раньше его не было — пояснение не
        // показывалось никогда, аудит 2026-11-09). Камеру он не двигает.
        if (note) {
          const layout = planPurchaseView(p.x / size.w, p.y / size.h, size.w, size.h, note);
          setPlan({ ...layout, robotSide: p.x > size.w / 2 ? 'left' : 'right' });
          setThanks(note);
        }
      });
      setViewing(id);
    },
    [size, viewing, heading, turnTo, openItemTools, zoomWithOffset, robotToSide, tools, visibleToolKeys],
  );

  const viewingItem = viewing ? items.find((i) => i.id === viewing) ?? null : null;
  const viewingTools = viewingItem ? toolsInItem(viewingItem.itemKey).filter((t) => tools.some((p) => p.key === t)) : [];

  const onBuy = useCallback(
    async (v: RoomVariant) => {
      setBuying(v.key);
      const res = await buy(v.key);
      setBuying(null);
      if (!res.ok) {
        Alert.alert('Не получилось', res.error);
        return;
      }
      setReactionKey(String(Date.now()));
      const finish = spotOf(res.item.itemKey) === 'finish';
      const placed = finish ? null : placedItems([res.item])[0] ?? null;
      if (!finish && !placed) {
        Alert.alert('Куплено — в кладовке', 'Поставь его из «Кладовки» и передвинь пальцем куда хочешь.');
        return;
      }
      if (size.w === 0) return;
      // Робот «понимает» экран: где окажется предмет и где свободно для реплики.
      // Отделка — смотрим на стену/пол; мебель — на её место.
      const at = placed ? { x: placed.x, y: placed.y } : res.item.slot === 'finish-walls' ? { x: 0.5, y: 0.4 } : { x: 0.5, y: 0.78 };
      const text = thanksFor(v.kind, storage.getString('assistantStyle'), userName, Math.random, v.tier);
      const layout = planPurchaseView(at.x, at.y, size.w, size.h, text);
      zoomWithOffset(layout.offset);
      robotToSide(layout.robotSide);
      setPlan(layout);
      setNewItemId(placed ? res.item.id : null);
      setThanks(text);
    },
    [buy, zoomWithOffset, robotToSide, size, userName],
  );

  // Обставляем: комната короче (магазин снизу) — робот уменьшается, чтобы не
  // закрывать задние ячейки; ноги остаются на полу.
  const chatMode = kbOpen && !zoomed && introStep == null;
  useEffect(() => {
    if (zoomed) return;
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
  }, [chatMode, size.w, furnishing, zoomed, moveRobot, robotToRest]);

  const onShelfChange = useCallback(
    (shelf: 'furnish' | null) => {
      setFurnishing(shelf === 'furnish');
      if (shelf === 'furnish') {
        // Обставляем в обычном виде (задняя стена напротив) — так понятнее, куда ставишь.
        if (zoomed) zoomOut();
        turnTo(0);
        fetchCatalog();
        fetchCoins();
        fetchFriendship();
      }
    },
    [fetchCatalog, fetchCoins, fetchFriendship, zoomed, zoomOut, turnTo],
  );

  const introTarget = introStep == null ? null : INTRO_STEPS[introStep].target;
  useEffect(() => setInputHighlight(introTarget === 'input'), [introTarget, setInputHighlight]);
  const finishIntro = useCallback(() => {
    markIntroDone();
    setIntroStep(null);
  }, []);
  const nextIntro = useCallback(() => {
    setIntroStep((s) => (s == null || s >= INTRO_STEPS.length - 1 ? (markIntroDone(), null) : s + 1));
  }, []);

  const onConfirm = useCallback(
    (yes: boolean) => {
      if (reply) void confirmPendingAction(reply.id, yes);
    },
    [reply, confirmPendingAction],
  );

  const pointing = zoomed;
  const showReply =
    introStep == null && !zoomed && ((chatLoading && !!host) || !!reply);
  const voiceBubble = isRecording
    ? liveTranscript || 'Слушаю… говори, пока держишь кнопку'
    : isProcessing
      ? 'Распознаю…'
      : voiceNote;

  // Ближние предметы рисуем поверх дальних.
  const byDepth = useMemo(() => [...items].sort((a, b) => a.y - b.y), [items]);
  const topInset = insets.top + spacing.xs;

  return (
    <View style={styles.container}>
      {active && !zoomed && <RoomTilt tiltX={tiltX} tiltY={tiltY} />}
      <GestureDetector gesture={sceneGesture}>
        <View style={styles.roomOuter} onLayout={onLayout}>
          <View style={styles.room}>
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
              <RoomDiorama
                width={size.w * R}
                height={size.h * R}
                hour={hour}
                cam={cam}
                wallsTier={wallsTier}
                floorTier={floorTier}
              />
              <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                {size.w > 0 &&
                  byDepth.map((item) => (
                    <RoomFurnitureItem
                      key={item.id}
                      item={item}
                      roomWidth={size.w * R}
                      roomHeight={size.h * R}
                      blockGestures={[lookAround]}
                      zoom={sceneScale}
                      cam={cam}
                      onMove={moveItem}
                      onRemove={onRemove}
                      onTap={onItemTap}
                      editable={furnishing}
                      highlight={item.id === newItemId}
                      badge={furnitureBadge(item.itemKey, visibleToolKeys)}
                      pulseBadge={introTarget === 'furniture'}
                    />
                  ))}
              </View>
            </Animated.View>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} pointerEvents="none" />
            <Vignette />
          </View>

          {/* Реплики под роботом: поднятая рука робота поверх облачка. */}
          {zoomed && thanks && plan && (
            <View
              style={
                plan.zone === 'top'
                  ? [styles.bubbleTop, { top: topInset }]
                  : plan.robotSide === 'left'
                    ? styles.bubbleBottomRight
                    : styles.bubbleBottomLeft
              }
              pointerEvents="none"
            >
              <RobotSpeechBubble text={thanks} tail={plan.tail} />
            </View>
          )}
          {showReply && !chatMode && !voiceBubble && (
            <View style={[styles.bubbleReply, { bottom: size.h * 0.04 + ROBOT_SIZE + 6 }]} pointerEvents="box-none">
              <ChatReplyBubble
                text={reply?.content ?? ''}
                thinking={chatLoading}
                tail="bottom"
                confirm={!chatLoading && !!reply?.pendingAction}
                onConfirm={onConfirm}
                onDismiss={reply ? dismissReply : undefined}
              />
            </View>
          )}
          {/* Пишем роботу: ответ справа от маленького робота, длинный — прокручивается. */}
          {chatMode && (showReply || voiceBubble) && (
            <View style={[styles.bubbleChat, { maxHeight: Math.max(80, size.h - 56 - insets.top) }]}>
              <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <ChatReplyBubble
                  text={voiceBubble ?? reply?.content ?? ''}
                  thinking={!voiceBubble && chatLoading}
                  tail="left"
                  confirm={!voiceBubble && !chatLoading && !!reply?.pendingAction}
                  onConfirm={onConfirm}
                  onDismiss={!voiceBubble && reply ? dismissReply : undefined}
                  horizontalOnly
                />
              </ScrollView>
            </View>
          )}
          {/* Голос: пока держишь — что расслышал; ошибка — подсказка. */}
          {!chatMode && voiceBubble && !zoomed && (
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
            {/* Робот стоит на полу: мягкая тень под ногами. */}
            <View style={styles.robotShadow}>
              <SoftSpot id="robotShadow" cx={0.5} cy={0.5} rx={0.5} ry={0.5} color="#0E0802" opacity={0.8} />
            </View>
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

          <View style={[styles.topLeft, { top: topInset }]}>
            <Pressable
              style={styles.iconBtn}
              onPress={() => navigation.navigate('ChatHistory')}
              accessibilityRole="button"
              accessibilityLabel="История разговора"
            >
              <Feather name="message-circle" size={22} color={ROOM_INK} style={ROOM_INK_HALO} />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel="Настройки"
            >
              <Feather name="settings" size={22} color={ROOM_INK} style={ROOM_INK_HALO} />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => navigation.navigate('RobotMemory')}
              accessibilityRole="button"
              accessibilityLabel="Что я о тебе помню"
            >
              <Feather name="heart" size={22} color={ROOM_INK} style={ROOM_INK_HALO} />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => navigation.navigate('RobotDiary')}
              accessibilityRole="button"
              accessibilityLabel="Дневник робота"
            >
              <Feather name="book-open" size={22} color={ROOM_INK} style={ROOM_INK_HALO} />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => setIntroStep(0)}
              accessibilityRole="button"
              accessibilityLabel="Показать подсказки ещё раз"
            >
              <Feather name="help-circle" size={22} color={ROOM_INK} style={ROOM_INK_HALO} />
            </Pressable>
          </View>
          {!zoomed && (
            <View style={[styles.topRight, { top: topInset }]} pointerEvents="none">
              <CoinCounter coins={coins} gain={coinGain} />
              {friendship && (
                <View style={styles.friendPill} accessibilityLabel={`Уровень дружбы: ${friendship.title}`}>
                  <Text style={styles.friendPillText}>💛 {friendship.title}</Text>
                </View>
              )}
            </View>
          )}
          {/* Осмотреться: повернуться к соседней стене (вся комната видна). */}
          {!zoomed && !furnishing && !chatMode && introStep == null && size.w > 0 && (
            <>
              <Pressable
                onPress={() => turnTo(heading - 1)}
                style={[styles.turnBtn, styles.turnLeft]}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Повернуться налево"
              >
                <Feather name="chevron-left" size={30} color={ROOM_INK} style={ROOM_INK_HALO} />
              </Pressable>
              <Pressable
                onPress={() => turnTo(heading + 1)}
                style={[styles.turnBtn, styles.turnRight]}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Повернуться направо"
              >
                <Feather name="chevron-right" size={30} color={ROOM_INK} style={ROOM_INK_HALO} />
              </Pressable>
            </>
          )}
          {/* Стоим перед предметом с инструментом внутри — открыть его. */}
          {zoomed && viewingTools.length > 0 && (
            <Pressable
              onPress={() => viewingItem && openItemTools(viewingItem.itemKey)}
              style={styles.openPill}
              accessibilityRole="button"
            >
              <Text style={styles.openPillText}>
                Открыть {viewingTools.length === 1 ? `«${TOOL_TITLE[viewingTools[0]]}»` : 'что внутри'}
              </Text>
            </Pressable>
          )}
          {zoomed && (
            <Pressable
              onPress={zoomOut}
              style={[styles.iconBtn, styles.topRight, { top: topInset }]}
              accessibilityRole="button"
              accessibilityLabel="Отдалить комнату"
            >
              <Feather name="minimize-2" size={22} color={ROOM_INK} style={ROOM_INK_HALO} />
            </Pressable>
          )}
        </View>
      </GestureDetector>

      <RoomBottomBar
        onTools={() => useRoomToolStore.getState().focusTools()}
        shop={
          <RoomShop
            catalog={catalog}
            owned={owned}
            coins={coins}
            friendship={friendship}
            busy={buying}
            onBuy={(v) => void onBuy(v)}
            onPlace={onPlace}
          />
        }
        onShelfChange={onShelfChange}
        compact={kbOpen}
        highlight={introTarget === 'tools' || introTarget === 'furnish' ? introTarget : null}
      />
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    // Комната на весь экран: без полей, рамки и скруглений, под статус-баром.
    roomOuter: { flex: 1 },
    room: { flex: 1, overflow: 'hidden', backgroundColor: '#0B1022' },
    scene: { position: 'absolute' },
    robot: { position: 'absolute', left: 0, right: 0, bottom: '4%', alignItems: 'center' },
    // Облачко благодарности там, где свободно (services/speech-layout).
    bubbleBottomRight: { position: 'absolute', left: ROBOT_SIDE_W - 8, right: -6, bottom: 4 },
    bubbleBottomLeft: { position: 'absolute', left: -6, right: ROBOT_SIDE_W - 8, bottom: 4 },
    bubbleTop: { position: 'absolute', left: -4, right: -4, top: 4 },
    // Ответ робота в разговоре — над ним, хвостик вниз.
    bubbleReply: { position: 'absolute', left: 0, right: 0 },
    // Режим разговора: справа от маленького робота, низ — на уровне пола.
    bubbleChat: { position: 'absolute', left: ROBOT_SIZE * CHAT_ROBOT_SCALE + 6, right: 2, bottom: 6 },
    mirror: { transform: [{ scaleX: -1 }] },
    robotShadow: { position: 'absolute', bottom: -16, left: '50%', marginLeft: -ROBOT_SIZE * 0.45, width: ROBOT_SIZE * 0.9, height: 32 },
    topLeft: { position: 'absolute', top: spacing.sm, left: spacing.sm, flexDirection: 'row', gap: spacing.sm },
    topRight: { position: 'absolute', top: spacing.sm, right: spacing.sm, alignItems: 'flex-end', gap: 6 },
    friendPill: { height: 22, justifyContent: 'center' },
    friendPillText: { color: ROOM_INK, fontSize: 13, fontWeight: '700', ...ROOM_INK_HALO },
    // Просто иконка, без кружка-подложки; зона нажатия прежняя 36×36.
    iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    turnBtn: { position: 'absolute', top: '42%', width: 40, height: 56, alignItems: 'center', justifyContent: 'center' },
    turnLeft: { left: 2 },
    turnRight: { right: 2 },
    openPill: {
      position: 'absolute',
      bottom: spacing.md,
      alignSelf: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: 999,
      backgroundColor: 'rgba(255,248,235,0.92)',
      borderWidth: 2,
      borderColor: '#2A1A0E',
    },
    openPillText: { fontSize: 16, fontWeight: '700', color: '#2A1A0E' },
  });
}
