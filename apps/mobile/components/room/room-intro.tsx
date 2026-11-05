import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ComicBubble } from '@/components/robot/comic-bubble';
import { ComicText } from '@/components/robot/comic-text';
import { COMIC } from '@/constants/comic';
import { INTRO_STEPS } from '@/services/room-intro';

/**
 * Робот-эпик: знакомство после установки. Комната чуть затемнена, робот
 * говорит облачком из комикса, что где; нужное место подсвечивает сама
 * комната/нижняя панель (по INTRO_STEPS[step].target).
 */
export const RoomIntro = memo(function RoomIntro({
  step,
  bubbleBottom,
  onNext,
  onSkip,
}: {
  step: number;
  /** Где низ облачка (над роботом). */
  bubbleBottom: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const s = INTRO_STEPS[step];
  const last = step === INTRO_STEPS.length - 1;
  // Когда речь о мебели/комнате — облачко наверху, чтобы не закрывать то, что показываем.
  const onTop = s.target === 'furniture' || s.target === 'room';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[StyleSheet.absoluteFill, styles.dim]} pointerEvents="none" />
      <View style={[styles.bubble, onTop ? styles.top : { bottom: bubbleBottom }]}>
        <ComicBubble tail="bottom">
          <Text style={styles.counter}>
            {step + 1} / {INTRO_STEPS.length}
          </Text>
          <ComicText key={step} text={s.text} typewrite />
          <View style={styles.actions}>
            {!last && (
              <Pressable onPress={onSkip} style={styles.btn} accessibilityRole="button">
                <Text style={styles.btnText}>Пропустить</Text>
              </Pressable>
            )}
            <Pressable onPress={onNext} style={[styles.btn, styles.next]} accessibilityRole="button">
              <Text style={styles.btnText}>{last ? 'Начнём!' : 'Дальше →'}</Text>
            </Pressable>
          </View>
        </ComicBubble>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(5,7,15,0.35)', borderRadius: 24 },
  bubble: { position: 'absolute', left: 0, right: 0 },
  top: { top: 40 },
  counter: { fontFamily: COMIC.font, fontSize: 12, color: '#6B6680', marginBottom: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COMIC.ink,
    backgroundColor: COMIC.paper,
  },
  next: { backgroundColor: COMIC.userPaper },
  btnText: { fontFamily: COMIC.font, fontSize: 14, color: COMIC.ink },
});
