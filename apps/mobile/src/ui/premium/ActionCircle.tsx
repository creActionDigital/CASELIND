import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { brandColor, onMedia, radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Text } from '../Text';
import { PressableScale } from './PressableScale';

interface Props {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  /** Cercle plein bleu de marque (action principale) au lieu de la teinte douce. */
  filled?: boolean;
}

/** Action ronde (icône dans un cercle de 56 px + libellé dessous), style wallet. */
export function ActionCircle({ icon, label, onPress, filled }: Props) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} style={styles.wrap}>
      <View style={[styles.disc, { backgroundColor: filled ? brandColor : colors.primarySoft }]}>
        <Ionicons name={icon} size={24} color={filled ? onMedia : colors.primary} />
      </View>
      <Text variant="caption" style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs + 2, minWidth: 64, minHeight: 44 },
  disc: { width: 56, height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  label: { textAlign: 'center' },
});
