import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { cancelOrder, fetchOrder } from '../../../shop/api';
import { formatMoney } from '../../../shop/format';
import { shopKeys } from '../../../shop/hooks';
import { canCancel, canReview, mediaContentUrl } from '../../../shop/order-logic';
import { ContactSeller } from '../../../shop/ContactSeller';
import { StatusPill } from '../../../shop/parts';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Button, ErrorState, Text } from '../../../ui';

export default function OrderDetail() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const id = String(orderId);
  const [confirming, setConfirming] = useState(false);

  const order = useQuery({ queryKey: shopKeys.order(id), queryFn: () => fetchOrder(id) });
  const cancel = useMutation({
    mutationFn: () => cancelOrder(id),
    onSuccess: (o) => {
      qc.setQueryData(shopKeys.order(id), o);
      void qc.invalidateQueries({ queryKey: shopKeys.orders });
      setConfirming(false);
    },
  });

  if (order.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (order.isError) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <ErrorState error={order.error} onRetry={() => order.refetch()} />
      </View>
    );
  }
  const o = order.data;
  const money = (n: number) => formatMoney(n, o.currency, locale);
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: o.number }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text variant="title" accessibilityRole="header">
              {t('orders.number', { number: o.number })}
            </Text>
            <Text muted>{o.orgName}</Text>
          </View>
          <StatusPill status={o.status} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {o.items.map((i) => (
            <View key={i.id} style={styles.item}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={i.title}
                onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: i.productId } })}
              >
                <AuthImage contentUrl={mediaContentUrl(i.imageAssetId)} label={i.title} style={styles.thumb} />
              </Pressable>
              <View style={styles.flex}>
                <Text variant="small" style={{ fontWeight: '600' }} numberOfLines={2}>
                  {i.title}
                </Text>
                {i.variantLabel ? (
                  <Text variant="caption" muted>
                    {i.variantLabel}
                  </Text>
                ) : null}
                <Text variant="small" muted>
                  {i.quantity} × {money(i.unitPriceMinor)}
                </Text>
                {canReview(o.status) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('orders.review')} : ${i.title}`}
                    onPress={() => router.push({ pathname: '/review/new', params: { productId: i.productId } })}
                    style={styles.link}
                  >
                    <Text color={colors.primary} style={{ fontWeight: '600' }}>
                      {t('orders.review')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <Text variant="small">{money(i.lineTotalMinor)}</Text>
            </View>
          ))}
          <View style={[styles.sep, { backgroundColor: colors.border }]} />
          <Line label={t('orders.subtotal')} value={money(o.subtotalMinor)} />
          {o.discountMinor > 0 ? <Line label={t('orders.discount', { code: o.couponCode ?? '' })} value={`− ${money(o.discountMinor)}`} /> : null}
          <Line label={t('orders.total')} value={money(o.totalMinor)} strong />
        </View>

        <Text variant="heading" accessibilityRole="header">
          {t('orders.address')}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {o.address ? (
            <>
              <Text variant="bodyStrong">{o.address.name}</Text>
              <Text>{o.address.line1}</Text>
              {o.address.line2 ? <Text>{o.address.line2}</Text> : null}
              <Text>{o.address.city}</Text>
              <Text muted>{o.address.phone}</Text>
              {o.address.notes ? <Text variant="small" muted>{o.address.notes}</Text> : null}
            </>
          ) : (
            <Text muted>{t('orders.addressErased')}</Text>
          )}
          <Text variant="small" muted style={{ marginTop: spacing.xs }}>
            {t('orders.payment')} : {t('checkout.cod')}
          </Text>
        </View>

        <Text variant="heading" accessibilityRole="header">
          {t('orders.timeline')}
        </Text>
        <View style={styles.timeline}>
          {o.events.map((e, idx) => (
            <View key={e.id} style={styles.event} accessible accessibilityLabel={`${t(`orders.status.${e.status}`)}, ${when(e.createdAt)}`}>
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: idx === o.events.length - 1 ? colors.primary : colors.border }]} />
                {idx < o.events.length - 1 ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
              </View>
              <View style={styles.flex}>
                <Text variant="bodyStrong">{t(`orders.status.${e.status}`)}</Text>
                <Text variant="caption" muted>
                  {when(e.createdAt)} · {t(`orders.actor.${e.actorKind}`)}
                </Text>
                {e.note ? <Text variant="small">{e.note}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        <ContactSeller contactUserId={o.contactUserId} />

        {cancel.isError ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {errorMessage(cancel.error, t, locale)}
          </Text>
        ) : null}
        {canCancel(o.status) ? (
          confirming ? (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text>{t('orders.cancelConfirm')}</Text>
              <Button variant="danger" label={t('orders.cancelYes')} loading={cancel.isPending} onPress={() => cancel.mutate()} />
              <Button variant="secondary" label={t('orders.keep')} onPress={() => setConfirming(false)} />
            </View>
          ) : (
            <Button variant="secondary" label={t('orders.cancel')} onPress={() => setConfirming(true)} />
          )
        ) : null}
      </ScrollView>
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant={strong ? 'bodyStrong' : 'small'} muted={!strong} style={styles.flex}>
        {label}
      </Text>
      <Text variant={strong ? 'heading' : 'small'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm },
  item: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  thumb: { width: 64, height: 64 },
  link: { minHeight: TOUCH, justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth },
  timeline: { gap: 0 },
  event: { flexDirection: 'row', gap: spacing.md, minHeight: 56 },
  rail: { alignItems: 'center', width: 14 },
  dot: { width: 12, height: 12, borderRadius: radius.pill, marginTop: 5 },
  line: { flex: 1, width: 2, marginVertical: 2 },
});
