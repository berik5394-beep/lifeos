import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Dimensions,
} from 'react-native';
// Stack header is now managed by the parent navigator in navigation/index.tsx
import MapView, { Polyline } from 'react-native-maps';
import { useStepStore } from '@/stores/step-store';
import { useSteps } from '@/hooks/use-steps';
import { useLocationTracking } from '@/hooks/use-location';
import { Card, Button } from '@/components/ui';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { formatDate, getWeekDays } from '@/utils/dates';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DAILY_GOAL = 10000;

// --- Sub-components ---

interface StepProgressProps {
  steps: number;
  goal: number;
}

const StepProgress = React.memo(function StepProgress({ steps, goal }: StepProgressProps) {
  const c = useColors();
  const progressStyles = useMemo(() => createProgressStyles(c), [c]);
  const progress = Math.min(steps / goal, 1);
  const barWidth = (SCREEN_WIDTH - spacing.md * 2 - spacing.md * 2 - 2) * progress;

  return (
    <View style={progressStyles.container}>
      <View style={progressStyles.barBackground}>
        <View
          style={[
            progressStyles.barFill,
            {
              width: barWidth,
              backgroundColor: progress >= 1 ? c.success : c.primary,
            },
          ]}
        />
      </View>
      <Text style={progressStyles.label}>
        {Math.round(progress * 100)}% от цели
      </Text>
    </View>
  );
});

function createProgressStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    marginTop: spacing.md,
  },
  barBackground: {
    height: 12,
    backgroundColor: c.surfaceLight,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  barFill: {
    height: 12,
    borderRadius: borderRadius.xl,
  },
  label: {
    color: c.textSecondary,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  });
}

interface WeekBarProps {
  label: string;
  steps: number;
  maxSteps: number;
}

const WeekBar = React.memo(function WeekBar({ label, steps, maxSteps }: WeekBarProps) {
  const c = useColors();
  const weekBarStyles = useMemo(() => createWeekBarStyles(c), [c]);
  const barMaxHeight = 100;
  const barHeight = maxSteps > 0 ? (steps / maxSteps) * barMaxHeight : 0;
  const reachedGoal = steps >= DAILY_GOAL;

  return (
    <View style={weekBarStyles.container}>
      <Text style={weekBarStyles.stepsLabel}>
        {steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : steps}
      </Text>
      <View style={weekBarStyles.barWrapper}>
        <View
          style={[
            weekBarStyles.bar,
            {
              height: Math.max(barHeight, 4),
              backgroundColor: reachedGoal ? c.success : c.primary,
            },
          ]}
        />
      </View>
      <Text style={weekBarStyles.dayLabel}>{label}</Text>
    </View>
  );
});

function createWeekBarStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
  },
  stepsLabel: {
    color: c.textSecondary,
    fontSize: fontSize.xs - 2,
    marginBottom: spacing.xs,
  },
  barWrapper: {
    height: 100,
    width: 24,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: 20,
    borderRadius: borderRadius.sm,
  },
  dayLabel: {
    color: c.textSecondary,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  });
}

// --- Main Screen ---

export default function ActivityScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const { steps, isAvailable } = useSteps();
  const { hasPermission } = useLocationTracking();

  const {
    todayDistance,
    weekLogs,
    gpsTrack,
    isTracking,
    fetchToday,
    fetchWeek,
    saveSteps,
    startTracking,
    stopTracking,
    clearGpsTrack,
  } = useStepStore();

  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => formatDate(today), [today]);
  const weekDays = useMemo(() => getWeekDays(today), [today]);
  const weekStartStr = useMemo(() => formatDate(weekDays[0].date), [weekDays]);

  useEffect(() => {
    fetchToday(todayStr);
    fetchWeek(weekStartStr);
  }, [todayStr, weekStartStr, fetchToday, fetchWeek]);

  const weekStepsData = useMemo(() => {
    return weekDays.map((day) => {
      const dateStr = formatDate(day.date);
      const log = weekLogs.find((l) => l.date === dateStr);
      return {
        label: day.label,
        steps: log ? log.steps : (dateStr === todayStr ? steps : 0),
      };
    });
  }, [weekDays, weekLogs, todayStr, steps]);

  const maxWeekSteps = useMemo(() => {
    const maxFromData = Math.max(...weekStepsData.map((d) => d.steps), 0);
    return Math.max(maxFromData, DAILY_GOAL);
  }, [weekStepsData]);

  const handleToggleTracking = useCallback(() => {
    if (isTracking) {
      stopTracking();
    } else {
      clearGpsTrack();
      startTracking();
    }
  }, [isTracking, startTracking, stopTracking, clearGpsTrack]);

  const handleSave = useCallback(async () => {
    try {
      const distanceKm = gpsTrack.length > 1 ? calculateDistance(gpsTrack) : undefined;
      await saveSteps({
        date: todayStr,
        steps,
        distanceKm,
        gpsTrack: gpsTrack.length > 0 ? gpsTrack : undefined,
      });
      Alert.alert('Готово', 'Данные сохранены');
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить данные');
    }
  }, [todayStr, steps, gpsTrack, saveSteps]);

  const mapRegion = useMemo(() => {
    if (gpsTrack.length === 0) return null;
    const lats = gpsTrack.map((p) => p.latitude);
    const lngs = gpsTrack.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latDelta = Math.max((maxLat - minLat) * 1.3, 0.005);
    const lngDelta = Math.max((maxLng - minLng) * 1.3, 0.005);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    };
  }, [gpsTrack]);

  const polylineCoords = useMemo(() => {
    return gpsTrack.map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
    }));
  }, [gpsTrack]);

  const distanceDisplay = useMemo(() => {
    if (todayDistance != null) {
      return `${todayDistance.toFixed(2)} км`;
    }
    if (gpsTrack.length > 1) {
      return `${calculateDistance(gpsTrack).toFixed(2)} км`;
    }
    return '—';
  }, [todayDistance, gpsTrack]);

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Today's Steps Card */}
        <Card style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>Шагов сегодня</Text>
          <Text style={styles.stepsCount}>{steps.toLocaleString('ru-RU')}</Text>
          <Text style={styles.goalText}>Цель: {DAILY_GOAL.toLocaleString('ru-RU')}</Text>
          <StepProgress steps={steps} goal={DAILY_GOAL} />
          <View style={styles.distanceRow}>
            <Text style={styles.distanceLabel}>Дистанция:</Text>
            <Text style={styles.distanceValue}>{distanceDisplay}</Text>
          </View>
          {!isAvailable && (
            <Text style={styles.warningText}>Шагомер недоступен на этом устройстве</Text>
          )}
        </Card>

        {/* Tracking Button */}
        <Button
          title={isTracking ? 'Остановить' : 'Начать трекинг'}
          onPress={handleToggleTracking}
          variant={isTracking ? 'danger' : 'primary'}
          size="lg"
          style={styles.trackingButton}
          disabled={!hasPermission}
        />
        {!hasPermission && (
          <Text style={styles.permissionText}>
            Для трекинга нужен доступ к геолокации
          </Text>
        )}

        {/* Weekly Chart */}
        <Card style={styles.weekCard}>
          <Text style={styles.sectionTitle}>Неделя</Text>
          <View style={styles.weekChart}>
            {weekStepsData.map((day) => (
              <WeekBar
                key={day.label}
                label={day.label}
                steps={day.steps}
                maxSteps={maxWeekSteps}
              />
            ))}
          </View>
        </Card>

        {/* GPS Map */}
        {gpsTrack.length > 0 && mapRegion && (
          <Card style={styles.mapCard}>
            <Text style={styles.sectionTitle}>Маршрут</Text>
            <View style={styles.mapContainer}>
              <MapView
                style={styles.map}
                region={mapRegion}
                scrollEnabled={false}
                zoomEnabled={false}
                pitchEnabled={false}
                rotateEnabled={false}
              >
                <Polyline
                  coordinates={polylineCoords}
                  strokeColor={c.primary}
                  strokeWidth={3}
                />
              </MapView>
            </View>
          </Card>
        )}

        {/* Save Button */}
        <Button
          title="Сохранить"
          onPress={handleSave}
          variant="secondary"
          size="lg"
          style={styles.saveButton}
        />
      </ScrollView>
    </>
  );
}

// --- Helpers ---

function calculateDistance(track: Array<{ latitude: number; longitude: number }>): number {
  let totalKm = 0;
  for (let i = 1; i < track.length; i++) {
    totalKm += haversine(
      track[i - 1].latitude,
      track[i - 1].longitude,
      track[i].latitude,
      track[i].longitude,
    );
  }
  return totalKm;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// --- Styles ---

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  stepsCard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  stepsTitle: {
    color: c.textSecondary,
    fontSize: fontSize.md,
    marginBottom: spacing.xs,
  },
  stepsCount: {
    color: c.text,
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: 1,
  },
  goalText: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  distanceLabel: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
  },
  distanceValue: {
    color: c.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  warningText: {
    color: c.warning,
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
  },
  trackingButton: {
    marginTop: spacing.md,
  },
  permissionText: {
    color: c.textSecondary,
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  weekCard: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    color: c.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  weekChart: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  mapCard: {
    marginTop: spacing.md,
  },
  mapContainer: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  map: {
    width: '100%',
    height: 250,
  },
  saveButton: {
    marginTop: spacing.lg,
  },
  });
}
