import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';

interface Props {
  icon: ComponentProps<typeof Ionicons>['name'];
  /** Obligatoire : un bouton-icône sans libellé est inaccessible. */
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  disabled?: boolean;
  badge?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ icon, label, onPress, size = 24, color, disabled, badge, style }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.base, { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 }, style]}
    >
      <Ionicons name={icon} size={size} color={color ?? colors.text} />
      {badge ? <View style={styles.badge}>{badge}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 2, right: 2 },
});
