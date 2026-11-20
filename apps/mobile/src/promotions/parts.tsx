import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { formatMoney } from '../shop/format';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { useNow } from './hooks';
import { countdown, discountPercent } from './logic';

/** Pastille « -20 % » (le libellé du vendeur est affiché à côté, dans la fiche). */
export function PromoBadge({ priceMinor, compareAtMinor }: { priceMinor: number; compareAtMinor: number | null | undefined }) {
  const { t } = useI18n();
  const pct = discountPercent(compareAtMinor, priceMinor);
  if (pct === null) return null;
  return (
    <View style={styles.badge} importantForAccessibility="no-hide-descendants">
      <Text variant="caption" color="#FFFFFF" style={styles.badgeText}>
        {t('promo.off', { pct })}
      </Text>
    </View>
  );
}

/** Prix effectif, avec le prix de base barré quand une promotion est en cours (les deux viennent du serveur). */
export function PromoPrice({
  priceMinor,
  compareAtMinor,
  currency,
  variant = 'bodyStrong',
}: {
  priceMinor: number;
  compareAtMinor?: number | null;
  currency: string;
  variant?: 'bodyStrong' | 'title';
}) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const now = formatMoney(priceMinor, currency, locale);
  if (!compareAtMinor || compareAtMinor <= priceMinor) return <Text variant={variant}>{now}</Text>;
  const before = formatMoney(compareAtMinor, currency, locale);
  return (
    <View style={styles.priceRow} accessible accessibilityLabel={t('promo.priceA11y', { before, now })}>
      <Text variant={variant} color={colors.danger}>
        {now}
      </Text>
      <Text variant="small" muted style={styles.struck}>
        {before}
      </Text>
    </View>
  );
}

/** « Se termine dans 2 j 03:12:05 », rafraîchi chaque seconde ; « Promotion terminée » une fois la fin passée. */
export function PromoCountdown({ endsAt }: { endsAt: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const now = useNow();
  const left = countdown(endsAt, now);
  const time = left ? (left.days > 0 ? t('promo.timeDays', { d: left.days, clock: left.clock }) : left.clock) : null;
  return (
    <Text variant="small" color={left ? colors.danger : colors.textMuted} accessibilityLiveRegion="none">
      {time ? t('promo.endsIn', { time }) : t('promo.ended')}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#D70015' },
  badgeText: { fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  struck: { textDecorationLine: 'line-through' },
});
