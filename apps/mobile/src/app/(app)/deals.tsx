import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { fetchFlashSales, promoKeys } from '../../promotions/api';
import { useI18n } from '../../i18n';
import { ProductGrid } from '../../shop/ProductGrid';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, Text } from '../../ui';

/** Promotions et coupons côté acheteur : ventes flash en cours + comment utiliser un code promo. */
export default function Deals() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const query = useInfiniteQuery({
    queryKey: [...promoKeys.flash, 'all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFlashSales(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const header = (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {t('mc.deals.couponTitle')}
      </Text>
      <Text variant="small" muted>
        {t('mc.deals.couponBody')}
      </Text>
      <Button variant="secondary" label={t('mc.deals.cart')} onPress={() => router.push('/cart')} />
      <Text variant="heading" accessibilityRole="header">
        {t('mc.deals.flash')}
      </Text>
    </View>
  );
  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: t('mc.deals.title') }} />
      <ProductGrid query={query} header={header} emptyTitle={t('mc.deals.flashEmpty')} emptyBody={t('mc.deals.flashEmptyBody')} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: 20, padding: spacing.lg, gap: spacing.sm },
});
