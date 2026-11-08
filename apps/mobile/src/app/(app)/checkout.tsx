import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { uuidv4 } from '../../lib/uuid';
import { loadAddress, saveAddress, type SavedAddress } from '../../shop/address-store';
import { checkout } from '../../shop/api';
import { canCheckout, totalsByCurrency } from '../../shop/cart-logic';
import { couponErrorCode, couponErrorKey, stockConflict, type StockConflict } from '../../shop/errors';
import { formatMoney } from '../../shop/format';
import { shopKeys, useCart } from '../../shop/hooks';
import { normalizePhone } from '../../shop/order-logic';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text, TextField } from '../../ui';

const EMPTY: SavedAddress = { name: '', phone: '', city: '', line1: '', line2: '', notes: '' };

export default function Checkout() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  // Clé d'idempotence conservée pour les nouvelles tentatives de cette commande.
  const clientId = useRef(uuidv4());

  const [form, setForm] = useState<SavedAddress>(EMPTY);
  const [coupons, setCoupons] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Partial<Record<keyof SavedAddress, string>>>({});
  const [couponErrors, setCouponErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<StockConflict | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadAddress().then((a) => live && a && setForm((f) => (f.name || f.line1 ? f : a)));
    return () => {
      live = false;
    };
  }, []);

  const place = useMutation({
    mutationFn: () =>
      checkout({
        clientId: clientId.current,
        paymentMethod: 'cash_on_delivery',
        // Delivery zones and in-store pickup (lot 8) get their own UI later; orgs without zones deliver for free.
        fulfillment: 'delivery',
        address: {
          name: form.name.trim(),
          phone: normalizePhone(form.phone)!,
          city: form.city.trim(),
          line1: form.line1.trim(),
          ...(form.line2.trim() ? { line2: form.line2.trim() } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        },
        couponCodes: Object.values(coupons).map((c) => c.trim()).filter(Boolean),
      }),
    onSuccess: async (res) => {
      await saveAddress(form);
      qc.setQueryData(shopKeys.cart, { groups: [], unavailable: [], itemCount: 0 });
      void qc.invalidateQueries({ queryKey: shopKeys.orders });
      if (res.orders.length === 1) router.replace({ pathname: '/orders/[orderId]', params: { orderId: res.orders[0]!.id } });
      else router.replace('/orders');
    },
    onError: (e) => {
      setConflict(null);
      setCouponErrors({});
      setFormError(null);
      const stock = stockConflict(e);
      if (stock) {
        setConflict(stock);
        void qc.invalidateQueries({ queryKey: shopKeys.cart });
        return;
      }
      const key = couponErrorKey(e);
      if (key) {
        const code = couponErrorCode(e)?.toUpperCase();
        const orgId = Object.keys(coupons).find((id) => coupons[id]!.trim().toUpperCase() === code) ?? Object.keys(coupons).find((id) => coupons[id]!.trim());
        if (orgId) return setCouponErrors({ [orgId]: t(key) });
      }
      setFormError(errorMessage(e, t, locale));
    },
  });

  const groups = useMemo(() => cart.data?.groups ?? [], [cart.data]);
  const totals = totalsByCurrency(groups);
  const orgCount = groups.length;

  function submit() {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = t('field.required');
    if (!normalizePhone(form.phone)) next.phone = t('checkout.phoneInvalid');
    if (!form.city.trim()) next.city = t('field.required');
    if (!form.line1.trim()) next.line1 = t('field.required');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setFormError(null);
    place.mutate();
  }

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
  if (!cart.data || !canCheckout(cart.data)) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: t('checkout.title') }} />
        <EmptyState icon="cart-outline" title={t('cart.emptyTitle')} body={t('cart.emptyBody')} actionLabel={t('checkout.editCart')} onAction={() => router.replace('/cart')} />
      </View>
    );
  }

  const set = (k: keyof SavedAddress) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('checkout.title') }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 140 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {conflict ? (
          <View style={[styles.card, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]} accessibilityLiveRegion="polite">
            <Text variant="bodyStrong">{t('checkout.conflictBanner')}</Text>
            <Button variant="secondary" label={t('checkout.editCart')} onPress={() => router.replace('/cart')} />
          </View>
        ) : null}

        <Text variant="heading" accessibilityRole="header">
          {t('checkout.address')}
        </Text>
        <View>
          <TextField label={t('checkout.name')} value={form.name} onChangeText={set('name')} error={errors.name} autoComplete="name" textContentType="name" maxLength={100} />
          <TextField
            label={t('checkout.phone')}
            hint={t('checkout.phoneHint')}
            value={form.phone}
            onChangeText={set('phone')}
            error={errors.phone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
          />
          <TextField label={t('checkout.city')} value={form.city} onChangeText={set('city')} error={errors.city} maxLength={100} textContentType="addressCity" />
          <TextField label={t('checkout.line1')} value={form.line1} onChangeText={set('line1')} error={errors.line1} maxLength={200} textContentType="streetAddressLine1" />
          <TextField label={t('checkout.line2')} value={form.line2} onChangeText={set('line2')} maxLength={200} textContentType="streetAddressLine2" />
          <TextField label={t('checkout.notes')} value={form.notes} onChangeText={set('notes')} maxLength={500} multiline />
        </View>

        <Text variant="heading" accessibilityRole="header">
          {t('checkout.payment')}
        </Text>
        <View style={[styles.card, styles.codCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
          <Ionicons name="cash-outline" size={26} color={colors.primary} />
          <View style={styles.flex}>
            <Text variant="bodyStrong">{t('checkout.cod')}</Text>
            <Text variant="small" muted>
              {t('checkout.codBody')}
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
        </View>

        <Text variant="heading" accessibilityRole="header">
          {t('checkout.summary')}
        </Text>
        {orgCount > 1 ? <Text variant="small" muted>{t('checkout.split', { n: orgCount })}</Text> : null}
        {groups.map((g) => (
          <View key={`${g.orgId}-${g.currency}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="bodyStrong">{t('checkout.orderOf', { shop: g.orgName })}</Text>
            {g.lines.map((l) => {
              const bad = conflict?.variantIds.includes(l.variantId);
              return (
                <View key={l.variantId} style={[styles.row, bad && { backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: spacing.xs }]}>
                  <View style={styles.flex}>
                    <Text variant="small" numberOfLines={2}>
                      {l.quantity} × {l.title}
                      {l.variantLabel ? ` (${l.variantLabel})` : ''}
                    </Text>
                    {bad ? (
                      <Text variant="caption" color={colors.danger}>
                        {t(`checkout.conflict.${conflict!.reason}`)}
                      </Text>
                    ) : null}
                  </View>
                  <Text variant="small">{formatMoney(l.lineTotalMinor, g.currency, locale)}</Text>
                </View>
              );
            })}
            <View style={styles.row}>
              <Text variant="bodyStrong" style={styles.flex}>
                {t('cart.subtotal')}
              </Text>
              <Text variant="bodyStrong">{formatMoney(g.subtotalMinor, g.currency, locale)}</Text>
            </View>
            <TextField
              label={t('checkout.couponFor', { shop: g.orgName })}
              hint={t('checkout.couponHint')}
              value={coupons[g.orgId] ?? ''}
              onChangeText={(v) => {
                setCoupons((c) => ({ ...c, [g.orgId]: v }));
                setCouponErrors({});
              }}
              error={couponErrors[g.orgId]}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={32}
            />
          </View>
        ))}
        {formError ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {formError}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.bottom, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + spacing.md }]}>
        {totals.map((x) => (
          <View key={x.currency} style={styles.row}>
            <Text variant="small" muted style={styles.flex}>
              {t('checkout.totalNote')}
            </Text>
            <Text variant="heading">{formatMoney(x.totalMinor, x.currency, locale)}</Text>
          </View>
        ))}
        <Button label={t('checkout.submit')} onPress={submit} loading={place.isPending} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm },
  codCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.xs },
});
