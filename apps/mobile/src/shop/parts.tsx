import { Ionicons } from '@expo/vector-icons';
import type { OrderStatus } from '@caselind/contracts';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { brandColor, onMedia, radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';

const STAR = '#F5B301';

/** Pastille sélectionnable (catégories, options, tri) : cible ≥ 44 pt, état par couleur et par le lecteur d'écran. */
export function Chip({ label, selected, disabled, onPress }: { label: string; selected?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.surfaceAlt,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text variant="small" color={selected ? colors.onPrimary : colors.text} style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Pastille de catégorie (boutique) : pleine en bleu de marque quand elle est active, contour discret sinon. */
export function CategoryPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? brandColor : colors.surface, borderColor: selected ? brandColor : colors.border, borderWidth: StyleSheet.hairlineWidth, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text variant="small" color={selected ? onMedia : colors.text} style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Note en étoiles (lecture seule). */
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.row} accessible accessibilityLabel={t('product.stars', { n: value })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={n <= Math.round(value) ? 'star' : 'star-outline'} size={size} color={STAR} />
      ))}
    </View>
  );
}

/** Sélecteur de quantité −/+ ; à `min` le bouton moins devient « retirer » si `removable`. */
export function Stepper({
  value,
  min = 1,
  max,
  removable,
  onChange,
}: {
  value: number;
  min?: number;
  max: number;
  removable?: boolean;
  onChange: (n: number) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const atMin = value <= min;
  const btn = (icon: 'add' | 'remove' | 'trash-outline', label: string, disabled: boolean, next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onChange(next)}
      style={[styles.stepBtn, { opacity: disabled ? 0.4 : 1 }]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
  return (
    <View style={[styles.stepper, { backgroundColor: colors.surfaceAlt }]}>
      {atMin && removable
        ? btn('trash-outline', t('cart.remove'), false, 0)
        : btn('remove', t('product.dec'), atMin, value - 1)}
      <Text variant="bodyStrong" style={styles.qty} accessibilityLabel={`${t('product.quantity')} ${value}`}>
        {value}
      </Text>
      {btn('add', t('product.inc'), value >= max, value + 1)}
    </View>
  );
}

/** Statut de commande : teinte neutre, bleu de marque pour la livraison en cours, vert pour livrée (le rouge reste aux alertes). */
export function StatusPill({ status }: { status: OrderStatus }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const tone =
    status === 'delivered'
      ? { bg: colors.surfaceAlt, fg: colors.success }
      : status === 'cancelled'
        ? { bg: colors.surfaceAlt, fg: colors.textMuted }
        : { bg: colors.primarySoft, fg: colors.primary };
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text variant="caption" color={tone.fg} style={{ fontWeight: '700' }}>
        {t(`orders.status.${status}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: TOUCH, paddingHorizontal: spacing.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill },
  stepBtn: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  qty: { minWidth: 28, textAlign: 'center' },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
});
