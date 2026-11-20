import { useQueries } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { formatMinor } from '../../../seller/money';
import { buildCompareRows } from '../../../shop/compare-logic';
import { clearCompareProducts, toggleCompareProductId, useCompareProductIds } from '../../../shop/compare-store';
import { fetchProduct } from '../../../shop/api';
import { shopKeys } from '../../../shop/hooks';
import { Card } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, EmptyState, Text } from '../../../ui';

/** Comparaison de 2 à 4 produits : prix (promotion comprise), boutique, disponibilité, variantes et options. */
export default function CompareProducts() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const ids = useCompareProductIds();
  const results = useQueries({ queries: ids.map((id) => ({ queryKey: shopKeys.product(id), queryFn: () => fetchProduct(id), retry: false })) });
  const details = results.flatMap((r) => (r.data ? [r.data] : []));
  const rows = buildCompareRows(details);
  const mixed = new Set(rows.map((r) => r.currency)).size > 1;

  return (
    <>
      <Stack.Screen options={{ title: t('cmp.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {ids.length < 2 ? <EmptyState icon="git-compare-outline" title={t('cmp.title')} body={t('cmp.empty')} /> : null}
        {ids.length >= 2 && results.some((r) => r.isPending) ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
        {rows.map((r) => (
          <Card key={r.id} style={{ gap: spacing.xs, borderWidth: r.cheapest ? 2 : 0, borderColor: colors.primary, borderRadius: radius.lg }}>
            <View style={styles.line}>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                {r.title}
              </Text>
              {r.cheapest ? <Badge tone="accent" label={t('cmp.cheapest')} /> : null}
              {r.hasPromotion ? <Badge tone="neutral" label={t('cmp.promo')} /> : null}
            </View>
            <Text variant="small" muted>
              {t('cmp.shop')} : {r.shop}
            </Text>
            <Text color={colors.primary} style={{ fontWeight: '600' }}>
              {t('cmp.price')} : {r.minPriceMinor === r.maxPriceMinor ? formatMinor(r.minPriceMinor, r.currency, locale) : `${formatMinor(r.minPriceMinor, r.currency, locale)} – ${formatMinor(r.maxPriceMinor, r.currency, locale)}`}
            </Text>
            <Text variant="small">
              {t('cmp.stock')} : {r.inStock ? t('cmp.inStock') : t('cmp.outOfStock')}
            </Text>
            <Text variant="small">
              {t('cmp.variants')} : {r.variantCount}
            </Text>
            <Text variant="small">
              {t('cmp.options')} : {r.optionNames.length ? r.optionNames.join(', ') : t('cmp.none')}
            </Text>
            <View style={styles.line}>
              <Button variant="secondary" label={t('cmp.open')} onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: r.id } })} />
              <Button variant="ghost" label={t('cmp.remove', { title: r.title })} onPress={() => toggleCompareProductId(r.id)} />
            </View>
          </Card>
        ))}
        {results.some((r) => r.isError) ? <Text variant="small" muted>{t('cmp.unavailable')}</Text> : null}
        {mixed ? <Text variant="caption" muted>{t('cmp.currencyNote')}</Text> : null}
        {ids.length > 0 ? <Button variant="ghost" label={t('cmp.clear')} onPress={clearCompareProducts} /> : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({ line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' } });
