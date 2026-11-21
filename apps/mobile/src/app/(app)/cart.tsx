import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { canCheckout, totalsByCurrency } from '../../shop/cart-logic';
import { formatMoney } from '../../shop/format';
import { useCart, useSetCartItem } from '../../shop/hooks';
import { mediaContentUrl } from '../../shop/order-logic';
import { Stepper } from '../../shop/parts';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { AuthImage, Button, EmptyState, ErrorState, Text } from '../../ui';

export default function Cart() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const setItem = useSetCartItem();

  if (cart.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (cart.isError && !cart.data) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <ErrorState error={cart.error} onRetry={() => cart.refetch()} />
      </View>
    );
  }
  const data = cart.data!;
  if (data.groups.length === 0 && data.unavailable.length === 0) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <EmptyState icon="cart-outline" title={t('cart.emptyTitle')} body={t('cart.emptyBody')} actionLabel={t('cart.browse')} onAction={() => router.push('/shop')} />
      </View>
    );
  }
  const totals = totalsByCurrency(data.groups);
  const ready = canCheckout(data);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 210 + insets.bottom }]}>
        {setItem.isError ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {errorMessage(setItem.error, t, locale)}
          </Text>
        ) : null}
        {data.unavailable.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}>
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('cart.unavailableTitle')}
            </Text>
            <Text variant="small">{t('cart.unavailableBody')}</Text>
            {data.unavailable.map((u) => (
              <View key={u.variantId} style={styles.line}>
                <Text variant="small" style={styles.flex}>
                  {t('cart.unavailableLine', { n: u.quantity })}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('cart.remove')}
                  onPress={() => setItem.mutate({ variantId: u.variantId, quantity: 0 })}
                  style={styles.removeBtn}
                >
                  <Text color={colors.danger} style={{ fontWeight: '600' }}>
                    {t('cart.remove')}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {data.groups.map((g) => (
          <View key={`${g.orgId}-${g.currency}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={g.orgName}
              onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: g.orgSlug } })}
              style={styles.groupHead}
            >
              <Text variant="heading" numberOfLines={1} style={styles.flex}>
                {g.orgName}
              </Text>
              <Text variant="caption" muted>
                {g.currency}
              </Text>
            </Pressable>
            {g.lines.map((l) => (
              <View key={l.variantId} style={styles.line}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={l.title}
                  onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: l.productId } })}
                >
                  <AuthImage contentUrl={mediaContentUrl(l.imageAssetId)} label={l.title} style={styles.thumb} />
                </Pressable>
                <View style={styles.flex}>
                  <Text variant="small" numberOfLines={2} style={{ fontWeight: '600' }}>
                    {l.title}
                  </Text>
                  {l.variantLabel ? (
                    <Text variant="caption" muted numberOfLines={1}>
                      {l.variantLabel}
                    </Text>
                  ) : null}
                  <Text variant="small" muted>
                    {t('cart.unit', { price: formatMoney(l.unitPriceMinor, g.currency, locale) })}
                  </Text>
                  {l.compareAtPriceMinor ? (
                    <Text variant="caption" muted style={{ textDecorationLine: 'line-through' }}>
                      {formatMoney(l.compareAtPriceMinor, g.currency, locale)}
                    </Text>
                  ) : null}
                  <View style={styles.lineFoot}>
                    <Stepper value={l.quantity} max={99} removable onChange={(n) => setItem.mutate({ variantId: l.variantId, quantity: n })} />
                    <Text variant="bodyStrong">{formatMoney(l.lineTotalMinor, g.currency, locale)}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('cart.deleteLine', { title: l.title })}
                    onPress={() => setItem.mutate({ variantId: l.variantId, quantity: 0 })}
                    style={styles.removeBtn}
                  >
                    <Text color={colors.danger} style={{ fontWeight: '600' }}>
                      {t('cart.delete')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
            <View style={styles.subtotal}>
              <Text muted>{t('cart.subtotal')}</Text>
              <Text variant="bodyStrong">{formatMoney(g.subtotalMinor, g.currency, locale)}</Text>
            </View>
          </View>
        ))}
        <Text variant="small" muted>
          {t('cart.perStore')}
        </Text>
      </ScrollView>

      <View style={[styles.bottom, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + spacing.md }]}>
        {totals.map((x) => (
          <View key={x.currency} style={styles.subtotal}>
            <Text variant="bodyStrong">{t('cart.total')}</Text>
            <Text variant="heading">{formatMoney(x.totalMinor, x.currency, locale)}</Text>
          </View>
        ))}
        <Button label={t('cart.checkout')} disabled={!ready} onPress={() => router.push('/checkout')} />
        <Button variant="secondary" label={t('cart.continue')} onPress={() => router.push('/shop')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.md },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TOUCH },
  line: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  lineFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  thumb: { width: 72, height: 72 },
  subtotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  removeBtn: { minHeight: TOUCH, justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.xs },
});
