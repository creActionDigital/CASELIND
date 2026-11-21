import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Text } from '../Text';
import { PressableScale } from './PressableScale';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: ComponentProps<typeof Ionicons>['name'];
}

/** Pastille de filtre (pleine bleue si sélectionnée) ; état exposé aux lecteurs d'écran. */
export function Chip({ label, selected, onPress, icon }: ChipProps) {
  const { colors } = useTheme();
  const fg = selected ? colors.onPrimary : colors.text;
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} accessibilityState={{ selected: !!selected }} style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border }]}>
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Text variant="small" color={fg} style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Rangée horizontale défilante de pastilles. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <View style={styles.row}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, minHeight: TOUCH, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
});
