import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { motion } from '../../theme/tokens';
import { staggerDelay } from './logic';
import { useReduceMotion } from './useReduceMotion';

interface Props {
  children: ReactNode;
  /** Rang dans la liste : décale l'apparition (40 ms par rang, plafonné). */
  index?: number;
  style?: StyleProp<ViewStyle>;
}

/** Apparition douce (fondu + léger glissement vers le haut), décalée selon le rang ; immédiate si animations réduites. */
export function FadeInView({ children, index = 0, style }: Props) {
  const reduce = useReduceMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = reduce ? 1 : withDelay(staggerDelay(index), withTiming(1, { duration: motion.base }));
  }, [reduce, index, p]);
  const anim = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 10 }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
