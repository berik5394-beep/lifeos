import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
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
import { RoomIntro } from '@/components/room/room-intro';
import { useColors } from '@/hooks/use-colors';
import { useRobotReaction } from '@/hooks/use-robot-reaction';
import { useVoice } from '@/hooks/use-voice';
import { useRoomStore } from '@/stores/room-store';
import { useRoomToolStore } from '@/stores/room-tool-store';
import { useChatStore } from '@/stores/chat-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { api } from '@/services/api';
import { storage } from '@/services/storage';
import { thanksFor } from '@/services/robot-thanks';
import { visiblePanels } from '@/services/panels';
import { ROBOT_SIDE_W, planPurchaseView, type SpeechLayout } from '@/services/speech-layout';
import { ROOM_MAX_ITEMS, type RoomItemKey } from '@/services/room-catalog';
import { RENDER_SCALE as R, ZOOM_IN, clampPan, zoomOffset } from '@/services/room-geometry';
import { isToolKey, toolSource, toolsInItem, type ToolKey } from '@/services/room-tools';
import { ROBOT_STRIP_H, robotShift, robotStandPoint, toolOrigin } from '@/services/tool-scene';
import { TOOL_TITLE } from '@/components/room/tool-card';
import { hapticLight } from '@/services/haptics';
import { INTRO_STEPS, furnitureBadge, isIntroDone, markIntroDone } from '@/services/room-intro';
import { spacing, borderRadius } from '@/constants';

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
const ROBOT_SIZE = 150;
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
  const [explain, setExplain] = useState<string | null>(null);
  const [mirror, setMirror] = useState(false);
  const [typing, setTyping] = useState(false);
  const [dismissedReply, setDismissedReply] = useState<string | null>(null);
  // Знакомство после установки: робот показывает, что где. null — тур не идёт.
  const [introStep, setIntroStep] = useState<number | null>(() => (isIntroDone() ? null : 0));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const userName = useAuthStore((s) => s.user?.name ?? null);
  const token = useAuthStore((s) => s.token);
  const items = useRoomStore((s) => s.items);
  const fetchRoom = useRoomStore((s) => s.fetchRoom);
  const addItem = useRoomStore((s) => s.addItem);
  const moveItem = useRoomStore((s) => s.moveItem);
  const removeItem = useRoomStore((s) => s.removeItem);
  const messages = useChatStore((s) => s.messages);
  const chatLoading = useChatStore((s) => s.isLoading);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const confirmPendingAction = useChatStore((s) => s.confirmPendingAction);
  const isFeatureVisible = useUIStore((s) => s.isFeatureVisible);
  const tools = useMemo(() => visiblePanels(isFeatureVisible), [isFeatureVisible]);
  const visibleToolKeys = useMemo(() => tools.map((t) => t.key), [tools]);
  const toolSeq = useRoomToolStore((s) => s.seq);
  const { isRecording, isProcessing, lastResult, startRecording, stopRecording } = useVoice({ transcribeOnly: true });

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
  }, [fetchRoom]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // Голос → текст → мозг (как в чате, без двойного исполнения).
  useEffect(() => {
    if (lastResult?.transcript) void sendMessage(lastResult.transcript, true);
  }, [lastResult, sendMessage]);

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
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (zoomed) zoomOut();
      setThanks(null);
      setExplain(null);

      const source = toolSource(tool, useRoomStore.getState().items, { x: 0.5, y: 0.96 });
      const from = toolOrigin(source, size.w, size.h);
      const stand = robotStandPoint(source, size.w, size.h);
      const { dx, dy } = robotShift(stand, size.w, size.h);
      setScene({ tool, from, sourceId: source?.id ?? null, phase: 'walking', closing: false });
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
            .then((r) => setExplain(r.text))
            .catch(() => setExplain(`Вот ${TOOL_TITLE[tool].toLowerCase()} — смотри!`));
        },
        (source ? WALK_MS : 120) + FETCH_MS,
      );
    },
    [size, zoomed, zoomOut, moveRobot, later, recede, token],
  );

  const closeTool = useCallback(() => {
    setScene((s) => (s ? { ...s, closing: true } : s));
    recede.value = withTiming(0, { duration: 420 });
    setExplain(null);
  }, [recede]);

  const onToolClosed = useCallback(() => {
    setScene(null);
    robotToRest();
  }, [robotToRest]);

  // Запросы «достань инструмент» из пушей/голоса/дашборда.
  useEffect(() => {
    const tool = useRoomToolStore.getState().take();
    if (tool) openToolScene(tool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolSeq]);

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
      Alert.alert('Убрать предмет?', undefined, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Убрать', style: 'destructive', onPress: () => removeItem(id) },
      ]);
    },
    [removeItem],
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

  const onPick = useCallback(
    (key: RoomItemKey) => {
      if (scene) closeTool();
      if (!addItem(key)) {
        Alert.alert('Комната заполнена', `Помещается до ${ROOM_MAX_ITEMS} предметов — убери что-нибудь долгим нажатием.`);
        return;
      }
      setReactionKey(String(Date.now()));
      const added = useRoomStore.getState().items.at(-1);
      if (added && size.w > 0) {
        // Робот «понимает» экран: где окажется предмет и где свободно для реплики.
        const text = thanksFor(key, storage.getString('assistantStyle'), userName);
        const layout = planPurchaseView(added.x, added.y, size.w, size.h, text);
        zoomWithOffset(layout.offset);
        robotToSide(layout.robotSide);
        setPlan(layout);
        setNewItemId(added.id);
        setThanks(text);
      }
    },
    [scene, closeTool, addItem, zoomWithOffset, robotToSide, size, userName],
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
  const onSend = useCallback((text: string) => void sendMessage(text, true), [sendMessage]);
  const onConfirm = useCallback(
    (yes: boolean) => {
      if (reply) void confirmPendingAction(reply.id, yes);
    },
    [reply, confirmPendingAction],
  );

  const pointing = zoomed || scene?.phase === 'fetching' || scene?.phase === 'open';
  const showReply =
    introStep == null && !scene && !zoomed && (chatLoading || (reply && dismissedReply !== reply.id));

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
              <RoomDiorama width={size.w * R} height={size.h * R} hour={hour} />
              <Animated.View style={[StyleSheet.absoluteFill, furnitureStyle]} pointerEvents="box-none">
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
          {scene?.phase === 'open' && !scene.closing && (
            <View style={styles.bubbleExplain} pointerEvents="none">
              {explain ? <RobotSpeechBubble text={explain} tail="left" /> : <ChatReplyBubble text="" thinking tail="left" />}
            </View>
          )}
          {showReply && (
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
        onFurnish={onPick}
        onSend={onSend}
        sending={chatLoading}
        isRecording={isRecording}
        isProcessing={isProcessing}
        onMicIn={() => void startRecording()}
        onMicOut={() => void stopRecording()}
        onTyping={setTyping}
        highlight={introTarget === 'input' || introTarget === 'tools' || introTarget === 'furnish' ? introTarget : null}
      />
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
