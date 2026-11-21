import { useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { useReduceMotion } from './useReduceMotion';

interface Props {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}

/** Bloc squelette qui pulse doucement (fixe si animations réduites) ; masqué aux lecteurs d'écran. */
export function Skeleton({ width = '100%', height = 16, rounded = radius.sm, style }: Props) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = reduce ? 1 : withRepeat(withTiming(0.45, { duration: 800 }), -1, true);
  }, [reduce, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: rounded, backgroundColor: colors.surfaceAlt }, style, anim]}
    />
  );
}

/** Liste de lignes squelettes (pastille ronde + 2 lignes) pendant un chargement. */
export function SkeletonList({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={{ gap: spacing.lg }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Skeleton width={48} height={48} rounded={radius.pill} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Skeleton width="70%" />
            <Skeleton width="45%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}
