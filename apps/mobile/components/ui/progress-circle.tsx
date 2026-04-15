import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface ProgressCircleProps {
  progress: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  showPercent?: boolean;
  textColor?: string;
}

export const ProgressCircle = React.memo(function ProgressCircle({
  progress,
  size = 80,
  strokeWidth = 6,
  color,
  trackColor,
  label,
  showPercent = true,
  textColor,
}: ProgressCircleProps) {
  const c = useColors();
  const resolvedColor = color ?? c.primary;
  const resolvedTrackColor = trackColor ?? c.surfaceLight;
  const resolvedTextColor = textColor ?? c.text;
  const clamped = Math.min(100, Math.max(0, progress));
  const fraction = clamped / 100;

  const animatedValue = useRef(new Animated.Value(0)).current;
  const [displayFraction, setDisplayFraction] = useState(0);

  useEffect(() => {
    const listenerId = animatedValue.addListener(({ value }) => {
      setDisplayFraction(value);
    });

    Animated.timing(animatedValue, {
      toValue: fraction,
      duration: 700,
      useNativeDriver: false,
    }).start();

    return () => {
      animatedValue.removeListener(listenerId);
    };
  }, [fraction, animatedValue]);

  const rightRotation = displayFraction <= 0.5 ? displayFraction * 360 : 180;
  const leftRotation = displayFraction > 0.5 ? (displayFraction - 0.5) * 360 : 0;
  const leftVisible = displayFraction > 0.5;

  const innerSize = size - strokeWidth * 2;
  const displayPercent = Math.round(displayFraction * 100);

  const styles = useMemo(() => StyleSheet.create({
    wrapper: {
      alignItems: 'center',
    },
    container: {
      position: 'relative',
    },
    absolute: {
      position: 'absolute',
    },
    halfClip: {
      position: 'absolute',
      top: 0,
      overflow: 'hidden',
    },
    halfArc: {
      position: 'absolute',
      top: 0,
    },
    center: {
      position: 'absolute',
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    percentText: {
      fontWeight: '700',
    },
    label: {
      color: c.textSecondary,
      marginTop: 6,
      fontWeight: '500',
    },
  }), [c]);

  return (
    <View style={styles.wrapper}>
      <View style={[styles.container, { width: size, height: size }]}>
        {/* Track circle */}
        <View
          style={[
            styles.absolute,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: strokeWidth,
              borderColor: resolvedTrackColor,
            },
          ]}
        />

        {/* Right half (0-50%) */}
        <View
          style={[
            styles.halfClip,
            {
              width: size / 2,
              height: size,
              left: size / 2,
              borderTopRightRadius: size / 2,
              borderBottomRightRadius: size / 2,
            },
          ]}
        >
          <View
            style={[
              styles.halfArc,
              {
                width: size / 2,
                height: size,
                left: -size / 2,
                borderTopLeftRadius: size / 2,
                borderBottomLeftRadius: size / 2,
                borderWidth: strokeWidth,
                borderRightWidth: 0,
                borderColor: resolvedColor,
                transform: [{ rotate: `${rightRotation}deg` }],
              },
            ]}
          />
        </View>

        {/* Left half (50-100%) */}
        <View
          style={[
            styles.halfClip,
            {
              width: size / 2,
              height: size,
              left: 0,
              borderTopLeftRadius: size / 2,
              borderBottomLeftRadius: size / 2,
              opacity: leftVisible ? 1 : 0,
            },
          ]}
        >
          <View
            style={[
              styles.halfArc,
              {
                width: size / 2,
                height: size,
                left: size / 2,
                borderTopRightRadius: size / 2,
                borderBottomRightRadius: size / 2,
                borderWidth: strokeWidth,
                borderLeftWidth: 0,
                borderColor: resolvedColor,
                transform: [{ rotate: `${leftRotation}deg` }],
              },
            ]}
          />
        </View>

        {/* Center content */}
        <View
          style={[
            styles.center,
            {
              width: innerSize,
              height: innerSize,
              borderRadius: innerSize / 2,
              top: strokeWidth,
              left: strokeWidth,
            },
          ]}
        >
          {showPercent && (
            <Text
              style={[
                styles.percentText,
                {
                  color: resolvedTextColor,
                  fontSize: size < 60 ? fontSize.sm : size < 100 ? fontSize.lg : fontSize.xl,
                },
              ]}
            >
              {displayPercent}%
            </Text>
          )}
        </View>
      </View>

      {label ? (
        <Text
          style={[
            styles.label,
            { fontSize: size < 60 ? fontSize.xs : fontSize.sm },
          ]}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
});
