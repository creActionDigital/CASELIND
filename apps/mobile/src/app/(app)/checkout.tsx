import type { DeliverySpeed, DeliveryZone, Fulfillment } from '@caselind/contracts';
import { Steps } from '../../shop/Steps';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deliveryKeys, fetchPublicZones } from '../../delivery/api';
import { deliveryErrorMessage, zoneRefusal } from '../../delivery/errors';
import { checkSlot, expressOffered } from '../../delivery/schedule-logic';
import { addressRequired, expressSupplement, feeFor, plannedTotals, totalsByCurrencyWithFees, usableZones, zoneChoices, zoneCovers, zoneFee, type OrderPlan } from '../../delivery/logic';
import { useI18n, type MessageKey } from '../../i18n';
import { uuidv4 } from '../../lib/uuid';
import { loadAddress, saveAddress, type SavedAddress } from '../../shop/address-store';
import { checkout, fetchPaymentMethods } from '../../shop/api';
import { canCheckout } from '../../shop/cart-logic';
import { couponErrorCode, couponErrorKey, stockConflict, type StockConflict } from '../../shop/errors';
import { formatMoney } from '../../shop/format';
import { shopKeys, useCart } from '../../shop/hooks';
import { feeKind, normalizePhone } from '../../shop/order-logic';
import { radius, spacing, TOUCH } from '../../theme/tokens';
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
  const { coupon } = useLocalSearchParams<{ coupon?: string }>();
  // Clé d'idempotence conservée pour les nouvelles tentatives de cette commande.
  const clientId = useRef(uuidv4());

  // Moyens acceptés par le serveur ; en attendant la réponse (ou en cas d'échec) le paiement à la livraison reste proposé.
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: fetchPaymentMethods });
  const payMethod = methods.data?.methods[0] ?? 'cash_on_delivery';
  const [form, setForm] = useState<SavedAddress>(EMPTY);
  const [coupons, setCoupons] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Partial<Record<keyof SavedAddress, string>>>({});
  const [couponErrors, setCouponErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<StockConflict | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<Fulfillment>('delivery');
  const [zoneSel, setZoneSel] = useState<Record<string, string | undefined>>({});
  const [zoneErrors, setZoneErrors] = useState<Record<string, string>>({});
  const [speed, setSpeed] = useState<DeliverySpeed>('standard');
  const [slotOn, setSlotOn] = useState(false);
  const [slotText, setSlotText] = useState('');
  const [slotError, setSlotError] = useState<string | null>(null);

  // Code saisi dans le panier : préremplit le champ de la première boutique (validé par le serveur à la commande).
  const firstOrg = cart.data?.groups[0]?.orgId;
  useEffect(() => {
    if (coupon && firstOrg) setCoupons((c) => (Object.keys(c).length ? c : { [firstOrg]: String(coupon) }));
  }, [coupon, firstOrg]);
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
        paymentMethod: payMethod,
        fulfillment: mode,
        speed: mode === 'delivery' ? speed : 'standard',
        ...(mode === 'delivery' && slotOn ? { scheduledFor: slotIso! } : {}),
        // Adresse obligatoire en livraison seulement ; en retrait, jamais envoyée.
        ...(needsAddress
          ? {
              address: {
                name: form.name.trim(),
                phone: normalizePhone(form.phone)!,
                city: form.city.trim(),
                line1: form.line1.trim(),
                ...(form.line2.trim() ? { line2: form.line2.trim() } : {}),
                ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
              },
            }
          : {}),
        ...(mode === 'delivery' && chosenZones.choices.length > 0 ? { zones: chosenZones.choices } : {}),
        couponCodes: Object.values(coupons).map((c) => c.trim()).filter(Boolean),
      }),
    onSuccess: async (res) => {
      if (needsAddress) await saveAddress(form);
      qc.setQueryData(shopKeys.cart, { groups: [], unavailable: [], itemCount: 0 });
      void qc.invalidateQueries({ queryKey: shopKeys.orders });
      if (res.orders.length === 1) router.replace({ pathname: '/orders/[orderId]', params: { orderId: res.orders[0]!.id } });
      else router.replace('/orders');
    },
    onError: (e) => {
      setConflict(null);
      setCouponErrors({});
      setFormError(null);
      setZoneErrors({});
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
      const zone = zoneRefusal(e);
      if (zone?.orgId) return setZoneErrors({ [zone.orgId]: deliveryErrorMessage(e, t, locale) });
      setFormError(deliveryErrorMessage(e, t, locale));
    },
  });

  const groups = useMemo(() => cart.data?.groups ?? [], [cart.data]);
  const orgCount = groups.length;

  // Zones actives de chaque boutique (une erreur vaut « aucune zone » : le serveur tranche à l'envoi).
  const zoneQueries = useQueries({
    queries: groups.map((g) => ({ queryKey: deliveryKeys.publicZones(g.orgId), queryFn: () => fetchPublicZones(g.orgId), retry: false, staleTime: 60_000 })),
  });
  const zonesByOrg: Record<string, DeliveryZone[]> = {};
  const zonesLoading = zoneQueries.some((q) => q.isPending);
  groups.forEach((g, i) => {
    zonesByOrg[g.orgId] = (zoneQueries[i]?.data?.items ?? []).filter((z) => z.active);
  });
  const modes = Object.fromEntries(groups.map((g) => [g.orgId, mode])) as Record<string, Fulfillment>;
  const activeCounts = Object.fromEntries(groups.map((g) => [g.orgId, (zonesByOrg[g.orgId] ?? []).length]));
  const expressOk = expressOffered(groups, zonesByOrg, zoneSel);
  const slot = slotOn ? checkSlot(slotText) : null;
  const slotIso = slot?.ok ? slot.iso : null;
  const plans: Record<string, OrderPlan> = Object.fromEntries(
    groups.map((g) => [g.orgId, { fulfillment: mode, speed: expressOk ? speed : 'standard', zone: zonesByOrg[g.orgId]?.find((z) => z.id === zoneSel[g.orgId]) ?? null } satisfies OrderPlan]),
  );
  const totals = totalsByCurrencyWithFees(plannedTotals(groups, plans));
  const needsAddress = addressRequired(groups, modes);
  const chosenZones = zoneChoices(groups, modes, activeCounts, zoneSel);

  function submit() {
    const next: typeof errors = {};
    if (needsAddress) {
      if (!form.name.trim()) next.name = t('field.required');
      if (!normalizePhone(form.phone)) next.phone = t('checkout.phoneInvalid');
      if (!form.city.trim()) next.city = t('field.required');
      if (!form.line1.trim()) next.line1 = t('field.required');
    }
    setErrors(next);
    setSlotError(null);
    if (mode === 'delivery' && slot && !slot.ok) return setSlotError(t(`courier.slot.${slot.reason}` as MessageKey));
    if (mode === 'delivery' && speed === 'express' && !expressOk) return setFormError(t('courier.error.express_unavailable'));
    setZoneErrors(Object.fromEntries(chosenZones.missing.map((id) => [id, t('delivery.error.zone_required')])));
    if (Object.keys(next).length > 0 || chosenZones.missing.length > 0) return;
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
        <Steps current={1} />
        {conflict ? (
          <View style={[styles.card, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]} accessibilityLiveRegion="polite">
            <Text variant="bodyStrong">{t('checkout.conflictBanner')}</Text>
            <Button variant="secondary" label={t('checkout.editCart')} onPress={() => router.replace('/cart')} />
          </View>
        ) : null}

        <Text variant="heading" accessibilityRole="header">
          {t('delivery.fulfillment')}
        </Text>
        <View style={styles.row} accessibilityRole="radiogroup">
          {(['delivery', 'pickup'] as const).map((m) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === m }}
              accessibilityLabel={t(m === 'delivery' ? 'delivery.mode.delivery' : 'delivery.mode.pickup')}
              onPress={() => setMode(m)}
              style={[styles.mode, { borderColor: mode === m ? colors.primary : colors.border, backgroundColor: mode === m ? colors.primarySoft : colors.surface }]}
            >
              <Ionicons name={m === 'delivery' ? 'bicycle-outline' : 'storefront-outline'} size={22} color={colors.primary} />
              <Text variant="bodyStrong" style={styles.flex}>
                {t(m === 'delivery' ? 'delivery.mode.delivery' : 'delivery.mode.pickup')}
              </Text>
            </Pressable>
          ))}
        </View>
        {mode === 'pickup' ? (
          <Text variant="small" muted>
            {t('delivery.pickupBody')}
          </Text>
        ) : null}

        {mode === 'delivery' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('courier.speed.title')}
            </Text>
            <View style={styles.row} accessibilityRole="radiogroup">
              {(['standard', 'express'] as const).map((s) => {
                const disabled = s === 'express' && !expressOk;
                const extra = s === 'express' ? groups.map((g) => zonesByOrg[g.orgId]?.find((z) => z.id === zoneSel[g.orgId])).map((z, i) => (z ? expressSupplement(z, groups[i]!.currency) : null)) : [];
                const label = s === 'express' ? `${t('courier.speed.express')}${extra.length === 1 && extra[0] !== null && extra[0] !== undefined ? ` (+${formatMoney(extra[0], groups[0]!.currency, locale)})` : ''}` : t('courier.speed.standard');
                return (
                  <Pressable
                    key={s}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: speed === s, disabled }}
                    accessibilityLabel={label}
                    disabled={disabled}
                    onPress={() => setSpeed(s)}
                    style={[styles.mode, { opacity: disabled ? 0.5 : 1, borderColor: speed === s ? colors.primary : colors.border, backgroundColor: speed === s ? colors.primarySoft : colors.surface }]}
                  >
                    <Ionicons name={s === 'express' ? 'flash-outline' : 'time-outline'} size={22} color={colors.primary} />
                    <Text variant="bodyStrong" style={styles.flex}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!expressOk ? (
              <Text variant="small" muted>
                {t('courier.speed.expressHint')}
              </Text>
            ) : null}
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: slotOn }} accessibilityLabel={t('courier.slot.toggle')} onPress={() => setSlotOn((v) => !v)} style={styles.row}>
              <Ionicons name={slotOn ? 'checkbox' : 'square-outline'} size={24} color={colors.primary} />
              <Text variant="bodyStrong" style={styles.flex}>
                {t('courier.slot.toggle')}
              </Text>
            </Pressable>
            {slotOn ? (
              <TextField label={t('courier.slot.field')} hint={t('courier.slot.hint')} value={slotText} onChangeText={setSlotText} maxLength={16} placeholder="2026-12-24 09:30" keyboardType="numbers-and-punctuation" autoCorrect={false} error={slotError ?? undefined} />
            ) : null}
          </>
        ) : null}

        {needsAddress ? (
          <>
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
          </>
        ) : null}

        <Text variant="heading" accessibilityRole="header">
          {t('checkout.payment')}
        </Text>
        {payMethod === 'cash_on_delivery' ? (
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
        ) : null}

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
            {mode === 'delivery' && (zonesByOrg[g.orgId]?.length ?? 0) > 0 ? (
              <ZonePicker
                zones={usableZones(zonesByOrg[g.orgId]!, g.currency, form.city, form.line2)}
                currency={g.currency}
                selected={zoneSel[g.orgId]}
                onSelect={(id) => {
                  setZoneSel((z) => ({ ...z, [g.orgId]: id }));
                  setZoneErrors({});
                }}
                city={form.city}
                line2={form.line2}
                error={zoneErrors[g.orgId]}
              />
            ) : null}
            {mode === 'delivery' && (zonesByOrg[g.orgId]?.length ?? 0) === 0 ? (
              <Text variant="small" muted>
                {t('delivery.freeShop')}
              </Text>
            ) : null}
            <View style={styles.row}>
              <Text variant="small" muted style={styles.flex}>
                {t('delivery.fee')}
              </Text>
              {(() => {
                const fee = feeFor(plans[g.orgId], g.currency);
                const kind = feeKind({ delivery: mode === 'delivery', zoneCount: zonesByOrg[g.orgId]?.length ?? 0, zoneChosen: !!zoneSel[g.orgId], feeMinor: fee });
                return <Text variant="small">{kind === 'pending' ? t('delivery.feePending') : kind === 'amount' ? formatMoney(fee, g.currency, locale) : t('delivery.free')}</Text>;
              })()}
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
        <Button label={t('checkout.submit')} onPress={submit} loading={place.isPending} disabled={zonesLoading} />
      </View>
    </View>
  );
}

function ZonePicker({
  zones,
  currency,
  selected,
  onSelect,
  city,
  line2,
  error,
}: {
  zones: DeliveryZone[];
  currency: string;
  selected: string | undefined;
  onSelect: (id: string) => void;
  city: string;
  line2: string;
  error?: string;
}) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="small" style={{ fontWeight: '600' }}>
        {t('delivery.zone')}
      </Text>
      {zones.length === 0 ? (
        <Text variant="small" color={colors.danger}>
          {t('delivery.error.zone_currency_unsupported')}
        </Text>
      ) : null}
      {zones.map((z) => {
        const on = selected === z.id;
        const covers = zoneCovers(z, city, line2);
        const fee = formatMoney(zoneFee(z, currency) ?? 0, currency, locale);
        return (
          <Pressable
            key={z.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${z.name}, ${fee}, ${t('delivery.eta', { n: z.etaMinutes })}`}
            onPress={() => onSelect(z.id)}
            style={[styles.zone, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySoft : colors.surface }]}
          >
            <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.primary} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">{z.name}</Text>
              <Text variant="caption" muted>
                {t('delivery.eta', { n: z.etaMinutes })}
                {(city.trim() || line2.trim()) && !covers ? ` · ${t('delivery.maybeNotCovered')}` : ''}
              </Text>
            </View>
            <Text variant="small">{fee}</Text>
          </Pressable>
        );
      })}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mode: { flex: 1, minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md },
  zone: { minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm },
  codCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.xs },
});
