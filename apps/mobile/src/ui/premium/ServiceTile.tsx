import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, shadow, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Text } from '../Text';
import { PressableScale } from './PressableScale';

interface Props {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  /** Couleur de l'icône (bleu de marque par défaut ; l'orange pour une mise en avant). */
  tint?: string;
  /** Pastille de nombre (ex. non lus). */
  badge?: number;
}

/** Tuile de service (icône dans un carré arrondi + libellé), à poser dans une grille de 4 colonnes. */
export function ServiceTile({ icon, label, onPress, tint, badge }: Props) {
  const { colors } = useTheme();
  const c = tint ?? colors.primary;
  return (
    <PressableScale onPress={onPress} accessibilityLabel={badge ? `${label}, ${badge}` : label} style={styles.wrap}>
      <View style={[styles.box, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name={icon} size={26} color={c} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.accent }]}>
            <Text variant="caption" color={colors.onAccent} style={{ fontSize: 10, lineHeight: 14 }}>
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs + 2, minHeight: 44, flexGrow: 1 },
  box: { width: 60, height: 60, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  label: { textAlign: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
});
