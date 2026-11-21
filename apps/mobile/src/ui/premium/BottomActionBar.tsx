import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../Button';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Contenu à gauche du bouton (ex. prix total). */
  leading?: ReactNode;
}

/** Barre d'action collée en bas (zone sûre incluse) : contenu optionnel + bouton principal. À poser en dernier enfant d'un écran. */
export function BottomActionBar({ label, onPress, disabled, loading, leading }: Props) {
  const { colors } = useTheme();
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(bottom, spacing.md) }]}>
      {leading ? <View style={{ flexShrink: 1 }}>{leading}</View> : null}
      <View style={{ flex: 1 }}>
        <Button label={label} onPress={onPress} disabled={disabled} loading={loading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
