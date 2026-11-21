import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useReduceMotion } from './useReduceMotion';

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Échelle au toucher (0.96 par défaut). */
  pressedScale?: number;
}

/** Pressable à léger enfoncement animé au toucher (aucune animation si « réduire les animations »). */
export function PressableScale({ children, style, pressedScale = 0.96, onPressIn, onPressOut, ...rest }: Props) {
  const reduce = useReduceMotion();
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const to = (v: number) => {
    s.value = reduce ? 1 : withSpring(v, { damping: 18, stiffness: 260 });
  };
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      onPressIn={(e) => {
        to(pressedScale);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, anim]}>{children}</Animated.View>
    </Pressable>
  );
}
