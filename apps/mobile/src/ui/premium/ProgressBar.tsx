import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { brandColor, motion, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { clamp01 } from './logic';
import { useReduceMotion } from './useReduceMotion';

interface Props {
  /** Avancement de 0 à 1. */
  value: number;
  label: string;
  color?: string;
  height?: number;
}

/** Barre de progression à remplissage animé (instantané si animations réduites), annoncée en pourcentage. */
export function ProgressBar({ value, label, color = brandColor, height = 8 }: Props) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const v = clamp01(value);
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = reduce ? v : withTiming(v, { duration: motion.base * 2 });
  }, [v, reduce, p]);
  const anim = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={{ height, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}
    >
      <Animated.View style={[{ height, borderRadius: radius.pill, backgroundColor: color }, anim]} />
    </View>
  );
}
