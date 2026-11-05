import React, { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RobotAvatar } from '@/components/robot/robot-avatar';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize } from '@/constants';

/**
 * Робот-эпик, Часть 3: экран «Комната» — робот на переднем плане в своём доме.
 * Как в прототипе Berik: подсветка по времени суток, робот иногда поворачивает
 * голову. Мебель и расстановка — Часть 4.
 */
function timeTint(hour: number): string {
  if (hour >= 21 || hour < 6) return 'rgba(20,16,40,0.55)'; // ночь
  if (hour < 10) return 'rgba(255,220,150,0.10)'; // утро
  if (hour >= 18) return 'rgba(255,140,90,0.12)'; // вечер
  return 'rgba(255,255,255,0)';
}

export const RoomPage = memo(function RoomPage({ active }: { active: boolean }) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [headTurn, setHeadTurn] = useState<-1 | 0 | 1>(0);
  const tint = timeTint(new Date().getHours());

  // Робот иногда мягко поворачивает голову, приоткрывая комнату (только когда экран виден).
  useEffect(() => {
    if (!active) return;
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
  }, [active]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.room}>
        <View style={styles.wall} />
        <View style={styles.floor} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} pointerEvents="none" />
        <View style={styles.robot}>
          <RobotAvatar emotion="neutral" size={240} headTurn={headTurn} />
        </View>
      </View>
      <Text style={styles.title}>Комната</Text>
      <Text style={styles.hint}>Скоро здесь можно будет обставить комнату. Свайп влево — к работе →</Text>
    </SafeAreaView>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    room: {
      flex: 1,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      borderRadius: 24,
      overflow: 'hidden',
    },
    wall: { flex: 3, backgroundColor: '#2A2540' },
    floor: { flex: 1, backgroundColor: '#3B3355' },
    robot: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' },
    title: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
      marginTop: spacing.md,
    },
    hint: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      textAlign: 'center',
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
      marginBottom: spacing.lg,
    },
  });
}
