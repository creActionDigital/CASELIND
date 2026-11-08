import type { OrderStatus } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { changeOrderStatus, fetchOrder, sk, useMembership } from '../../../../../seller/api';
import { formatMinor } from '../../../../../seller/money';
import { SellerDelivery } from '../../../../../delivery/SellerDelivery';
import { allowedNext, needsConfirmation } from '../../../../../seller/order-flow';
import { can } from '../../../../../seller/permissions';
import { Card, Loading, OrderStatusBadge, SectionTitle, sellerErrorMessage } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

const ACTION_LABEL: Record<OrderStatus, MessageKey> = {
  pending: 'seller.status.pending',
  confirmed: 'seller.action.confirmed',
  preparing: 'seller.action.preparing',
  shipped: 'seller.action.shipped',
  delivered: 'seller.action.delivered',
  cancelled: 'seller.action.cancelled',
};

/** Détail d'une commande reçue : lignes, acheteur, frise, transitions autorisées. */
export default function SellerOrderDetail() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId, orderId } = useLocalSearchParams<{ orgId: string; orderId: string }>();
  const { role } = useMembership(orgId);
  const q = useQuery({ queryKey: sk.order(orgId, orderId), queryFn: () => fetchOrder(orgId, orderId) });
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: ({ to, note }: { to: OrderStatus; note?: string }) => changeOrderStatus(orgId, orderId, to, note),
    onMutate: () => setError(null),
    onSuccess: (detail) => {
      qc.setQueryData(sk.order(orgId, orderId), detail);
      setCancelling(false);
      setNote('');
      void qc.invalidateQueries({ queryKey: sk.orders(orgId) });
      void qc.invalidateQueries({ queryKey: sk.count(orgId, 'pending-orders') });
      void qc.invalidateQueries({ queryKey: sk.products(orgId) });
    },
    onError: (e) => {
      setError(sellerErrorMessage(e, t, locale));
      void q.refetch(); // l'acheteur a pu annuler entre-temps : on réaffiche l'état réel
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const next = allowedNext(o.status, role);
  const money = (n: number) => formatMinor(n, o.currency, locale);
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <Screen>
      <Stack.Screen options={{ title: o.number }} />
      <View style={styles.head}>
        <Text variant="title" style={{ flex: 1 }}>
          {o.number}
        </Text>
        <OrderStatusBadge status={o.status} />
      </View>
      <Text variant="small" muted>
        {fmt(o.createdAt)} · {t('seller.order.cod')}
      </Text>

      <SectionTitle>{t('seller.order.buyer')}</SectionTitle>
      <Card>
        {o.fulfillment === 'pickup' && !o.address ? (
          <Text muted>{t('delivery.pickupBody')}</Text>
        ) : o.address ? (
          <>
            <Text variant="bodyStrong">{o.address.name}</Text>
            <Text>{o.address.line1}</Text>
            {o.address.line2 ? <Text>{o.address.line2}</Text> : null}
            <Text>{o.address.city}</Text>
            {o.address.notes ? (
              <Text variant="small" muted>
                {t('seller.order.notes')} : {o.address.notes}
              </Text>
            ) : null}
            <Text selectable>{o.address.phone}</Text>
            <Button
              variant="secondary"
              label={t('seller.order.call')}
              accessibilityLabel={`${t('seller.order.call')} ${o.address.phone}`}
              onPress={() => void Linking.openURL(`tel:${o.address!.phone}`)}
              style={{ marginTop: spacing.sm }}
            />
          </>
        ) : (
          <Text muted>{t('seller.order.erasedBuyer')}</Text>
        )}
      </Card>

      {o.delivery ? <SellerDelivery orgId={orgId} orderId={orderId} delivery={o.delivery} canManage={can(role, 'orders.manage')} /> : null}

      <SectionTitle>{t('seller.order.items')}</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        {o.items.map((i) => (
          <View key={i.id} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2}>{i.title}</Text>
              {i.variantLabel ? (
                <Text variant="small" muted>
                  {i.variantLabel}
                </Text>
              ) : null}
              <Text variant="small" muted>
                {i.quantity} × {money(i.unitPriceMinor)}
              </Text>
            </View>
            <Text variant="bodyStrong">{money(i.lineTotalMinor)}</Text>
          </View>
        ))}
        <View style={[styles.sep, { backgroundColor: colors.border }]} />
        <Row label={t('seller.order.subtotal')} value={money(o.subtotalMinor)} />
        {o.discountMinor > 0 ? <Row label={`${t('seller.order.discount')}${o.couponCode ? ` (${o.couponCode})` : ''}`} value={`− ${money(o.discountMinor)}`} /> : null}
        {o.fulfillment === 'delivery' ? <Row label={t('delivery.fee')} value={o.deliveryFeeMinor > 0 ? money(o.deliveryFeeMinor) : t('delivery.free')} /> : null}
        <Row label={t('seller.order.total')} value={money(o.totalMinor)} strong />
      </Card>

      <SectionTitle>{t('seller.order.timeline')}</SectionTitle>
      <View accessibilityRole="list">
        {o.events.map((e, idx) => (
          <View key={e.id} style={styles.event}>
            <View style={{ alignItems: 'center', width: 16 }}>
              <View style={[styles.dot, { backgroundColor: idx === o.events.length - 1 ? colors.primary : colors.border }]} />
              {idx < o.events.length - 1 ? <View style={[styles.rail, { backgroundColor: colors.border }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: spacing.md }}>
              <Text variant="bodyStrong">{t(`seller.status.${e.status}` as MessageKey)}</Text>
              <Text variant="caption" muted>
                {fmt(e.createdAt)} · {t(`seller.actor.${e.actorKind}` as MessageKey)}
              </Text>
              {e.note ? <Text variant="small">{e.note}</Text> : null}
            </View>
          </View>
        ))}
      </View>

      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.sm }}>
          {error}
        </Text>
      ) : null}

      {cancelling ? (
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading" accessibilityRole="header">
            {t('seller.order.cancelTitle')}
          </Text>
          <Text muted>{t('seller.order.cancelBody')}</Text>
          <TextField label={t('seller.order.cancelNote')} value={note} onChangeText={setNote} maxLength={500} multiline />
          <Button
            variant="danger"
            label={t('seller.order.cancelConfirm')}
            loading={change.isPending}
            onPress={() => change.mutate({ to: 'cancelled', note: note.trim() || undefined })}
          />
          <Button variant="secondary" label={t('seller.order.keep')} disabled={change.isPending} onPress={() => setCancelling(false)} />
        </Card>
      ) : next.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          {next.map((to) => (
            <Button
              key={to}
              variant={to === 'cancelled' ? 'danger' : 'primary'}
              label={t(ACTION_LABEL[to])}
              loading={change.isPending && change.variables?.to === to}
              disabled={change.isPending}
              onPress={() => (needsConfirmation(to) ? setCancelling(true) : change.mutate({ to }))}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={strong ? 'bodyStrong' : 'small'} muted={!strong} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'small'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  sep: { height: StyleSheet.hairlineWidth },
  event: { flexDirection: 'row', gap: spacing.md },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  rail: { width: 2, flex: 1, marginTop: 2 },
});
