import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { canCheckout, totalsByCurrency } from '../../shop/cart-logic';
import { formatMoney } from '../../shop/format';
import { useCart, useSetCartItem } from '../../shop/hooks';
import { mediaContentUrl } from '../../shop/order-logic';
import { brandAccent, fonts, onMedia, radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { AuthImage, EmptyState, ErrorState, Text } from '../../ui';
import { PressableScale } from '../../ui/premium';
import { safeBack } from '../../lib/back-target';

/** « option: unique, couleur: noir » → « noir » (les valeurs seules, sans l'axe ni la valeur « unique »). */
function shortVariant(label?: string | null): string {
  return (label ?? '')
    .split(',')
    .map((x) => x.split(':').pop()!.trim())
    .filter((x) => x && !/^(unique|default)$/i.test(x))
    .join(' · ');
}

export default function Cart() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const setItem = useSetCartItem();
  const [promo, setPromo] = useState('');
  const [applied, setApplied] = useState('');

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
    <View style={[styles.flex, { backgroundColor: colors.background, paddingTop: insets.top + spacing.sm }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('product.back')} onPress={() => safeBack(router, '/shop')} style={[styles.round, { backgroundColor: colors.surface }]}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text variant="heading" accessibilityRole="header" style={styles.headTitle}>
          {t('mc.mk.cartTitle')}
        </Text>
        <View style={styles.round} />
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {setItem.isError ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {errorMessage(setItem.error, t, locale)}
          </Text>
        ) : null}
        {data.unavailable.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: StyleSheet.hairlineWidth }]}>
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('cart.unavailableTitle')}
            </Text>
            <Text variant="small">{t('cart.unavailableBody')}</Text>
            {data.unavailable.map((u) => (
              <View key={u.variantId} style={styles.line}>
                <Text variant="small" style={styles.flex}>
                  {t('cart.unavailableLine', { n: u.quantity })}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('cart.remove')} onPress={() => setItem.mutate({ variantId: u.variantId, quantity: 0 })} style={styles.removeBtn}>
                  <Text color={colors.danger} style={{ fontWeight: '600' }}>
                    {t('cart.remove')}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {data.groups.map((g) => (
          <View key={`${g.orgId}-${g.currency}`} style={{ gap: spacing.sm }}>
            {data.groups.length > 1 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={g.orgName} onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: g.orgSlug } })} style={styles.groupHead}>
                <Text numberOfLines={1} style={[styles.shopName, { color: colors.text }]}>
                  {g.orgName}
                </Text>
                <Text variant="caption" muted>
                  {g.currency}
                </Text>
              </Pressable>
            ) : null}
            {g.lines.map((l) => (
              <View key={l.variantId} style={[styles.card, styles.line, { backgroundColor: colors.surface }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={l.title} onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: l.productId } })}>
                  <AuthImage contentUrl={mediaContentUrl(l.imageAssetId)} label={l.title} contentFit="contain" style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]} />
                </Pressable>
                <View style={styles.flex}>
                  <View style={styles.nameRow}>
                    <Text numberOfLines={2} style={[styles.lineName, { color: colors.text }]}>
                      {l.title}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('cart.deleteLine', { title: l.title })} onPress={() => setItem.mutate({ variantId: l.variantId, quantity: 0 })} hitSlop={8} style={styles.trash}>
                      <Ionicons name="trash-outline" size={22} color={brandAccent} />
                    </Pressable>
                  </View>
                  <Text variant="small" muted numberOfLines={1}>
                    {shortVariant(l.variantLabel) || g.orgName}
                  </Text>
                  <View style={styles.lineFoot}>
                    <View>
                      <Text style={[styles.linePrice, { color: colors.text }]}>{formatMoney(l.lineTotalMinor, g.currency, locale)}</Text>
                      {l.compareAtPriceMinor ? (
                        <Text variant="caption" muted style={{ textDecorationLine: 'line-through' }}>
                          {formatMoney(l.compareAtPriceMinor * l.quantity, g.currency, locale)}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
                      <Pressable accessibilityRole="button" accessibilityLabel={t('product.dec')} accessibilityState={{ disabled: l.quantity <= 1 }} disabled={l.quantity <= 1} onPress={() => setItem.mutate({ variantId: l.variantId, quantity: l.quantity - 1 })} style={[styles.pillBtn, { opacity: l.quantity <= 1 ? 0.4 : 1 }]}>
                        <Ionicons name="remove" size={18} color={colors.text} />
                      </Pressable>
                      <Text variant="bodyStrong" style={styles.qty}>
                        {l.quantity}
                      </Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={t('product.inc')} accessibilityState={{ disabled: l.quantity >= 99 }} disabled={l.quantity >= 99} onPress={() => setItem.mutate({ variantId: l.variantId, quantity: l.quantity + 1 })} style={[styles.pillBtn, { opacity: l.quantity >= 99 ? 0.4 : 1 }]}>
                        <Ionicons name="add" size={18} color={colors.text} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </View>
        ))}
        {data.groups.length > 1 ? (
          <Text variant="small" muted>
            {t('cart.perStore')}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.panel, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
        <View style={[styles.promo, { backgroundColor: colors.surfaceAlt }]}>
          <TextInput
            accessibilityLabel={t('mc.mk.promo')}
            placeholder={t('mc.mk.promo')}
            placeholderTextColor={colors.textMuted}
            value={promo}
            onChangeText={setPromo}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={40}
            style={[styles.promoInput, { color: colors.text }]}
          />
          <PressableScale accessibilityLabel={t('mc.mk.apply')} disabled={!promo.trim()} onPress={() => setApplied(promo.trim())} style={[styles.apply, { opacity: promo.trim() ? 1 : 0.5 }]}>
            <Text color={brandAccent} style={styles.applyTxt}>
              {t('mc.mk.apply')}
            </Text>
          </PressableScale>
        </View>
        {applied ? (
          <Text variant="small" color={colors.success} accessibilityLiveRegion="polite">
            {t('mc.mk.promoSaved', { code: applied })}
          </Text>
        ) : null}
        {totals.map((x) => (
          <View key={x.currency} style={{ gap: spacing.xs }}>
            <View style={styles.subtotal}>
              <Text muted style={styles.sumLabel}>{t('cart.subtotal')}</Text>
              <Text style={[styles.sumValue, { color: colors.text }]}>{formatMoney(x.totalMinor, x.currency, locale)}</Text>
            </View>
            <View style={[styles.subtotal, styles.totalRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.sumLabel, { color: colors.text }]}>{t('cart.total')}</Text>
              <Text style={[styles.totalValue, { color: colors.text }]}>{formatMoney(x.totalMinor, x.currency, locale)}</Text>
            </View>
          </View>
        ))}
        <PressableScale
          accessibilityLabel={t('cart.checkout')}
          disabled={!ready}
          onPress={() => (applied ? router.push({ pathname: '/checkout', params: { coupon: applied } }) : router.push('/checkout'))}
          style={[styles.checkout, { opacity: ready ? 1 : 0.5 }]}
        >
          <Text color={onMedia} style={styles.checkoutTxt}>
            {t('cart.checkout')}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  headTitle: { fontSize: 20, lineHeight: 26 },
  round: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.xl, padding: spacing.md, gap: spacing.md },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TOUCH },
  line: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  trash: { minWidth: TOUCH - 8, minHeight: 32, alignItems: 'flex-end', justifyContent: 'center' },
  lineFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  thumb: { width: 76, height: 76, borderRadius: radius.md },
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill },
  pillBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  qty: { minWidth: 22, textAlign: 'center' },
  subtotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  removeBtn: { minHeight: TOUCH, justifyContent: 'center' },
  panel: { borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  promo: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, paddingLeft: spacing.lg, paddingRight: spacing.xs, minHeight: 56 },
  promoInput: { flex: 1, minHeight: TOUCH, fontFamily: fonts.regular, fontSize: 16 },
  apply: { minHeight: 44, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  applyTxt: { fontFamily: fonts.semibold, fontWeight: '600', fontSize: 18, lineHeight: 24 },
  shopName: { flex: 1, fontFamily: fonts.semibold, fontWeight: '600', fontSize: 16, lineHeight: 22 },
  lineName: { flex: 1, fontFamily: fonts.semibold, fontWeight: '600', fontSize: 17, lineHeight: 24 },
  linePrice: { fontFamily: fonts.bold, fontWeight: '700', fontSize: 16, lineHeight: 22 },
  sumLabel: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 24 },
  sumValue: { fontFamily: fonts.semibold, fontWeight: '600', fontSize: 19, lineHeight: 26 },
  totalValue: { fontFamily: fonts.semibold, fontWeight: '600', fontSize: 22, lineHeight: 30 },
  checkoutTxt: { fontFamily: fonts.medium, fontWeight: '500', fontSize: 20, lineHeight: 26 },
  checkout: { minHeight: 60, borderRadius: radius.pill, backgroundColor: brandAccent, alignItems: 'center', justifyContent: 'center' },
  big: { fontSize: 18, lineHeight: 24, fontWeight: '700', fontFamily: fonts.bold },
});
