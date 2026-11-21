import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { radius, shadow, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Text } from '../Text';
import { formatDelta } from './logic';

interface Props {
  label: string;
  /** Chiffre clé déjà formaté. */
  value: string;
  /** Variation en pourcentage (positive = vert, négative = rouge) ; omise = rien. */
  deltaPct?: number | null;
}

/** Carte chiffre clé + variation (flèche et signe : l'information ne repose pas sur la couleur seule). */
export function StatCard({ label, value, deltaPct }: Props) {
  const { colors } = useTheme();
  const d = formatDelta(deltaPct);
  const up = (deltaPct ?? 0) >= 0;
  const c = up ? colors.success : colors.danger;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}${d ? `, ${d}` : ''}`} style={[styles.card, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="caption" muted numberOfLines={1}>
        {label}
      </Text>
      <Text variant="heading" numberOfLines={2}>
        {value}
      </Text>
      {d ? (
        <View style={styles.delta}>
          <Ionicons name={up ? 'trending-up' : 'trending-down'} size={14} color={c} />
          <Text variant="caption" color={c}>
            {d}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 140, gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  delta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
