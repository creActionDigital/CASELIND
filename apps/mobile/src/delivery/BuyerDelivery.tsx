import { deliveryLocationEventSchema, type DeliveryLocation, type DeliveryView } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { directionsUrl, formatDistance } from '../places/geo';
import { getDevicePosition } from '../places/device-location';
import { TileMap } from '../places/TileMap';
import { useRealtime } from '../realtime/realtime-context';
import { shopKeys } from '../shop/hooks';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { rateDelivery } from './api';
import { deliveryErrorMessage } from './errors';
import { canRate, distanceKm, formatProofCode, stepStates } from './logic';
import { ProofView } from './ProofSection';
import { formatSlot } from './schedule-logic';

/** Position du livreur en direct : valeur du serveur, puis événements `delivery.location` de la room de la commande. Rien n'est stocké. */
export function useLiveCourierLocation(orderId: string, deliveryId: string | undefined, initial: DeliveryLocation | null): DeliveryLocation | null {
  const { socket } = useRealtime();
  const [live, setLive] = useState<DeliveryLocation | null>(initial);
  useEffect(() => {
    setLive((cur) => (initial && (!cur || Date.parse(initial.updatedAt) > Date.parse(cur.updatedAt)) ? initial : cur));
  }, [initial]);
  useEffect(() => {
    if (!socket) return;
    const onLocation = (raw: unknown) => {
      const p = deliveryLocationEventSchema.safeParse(raw);
      if (!p.success || p.data.orderId !== orderId || (deliveryId && p.data.deliveryId !== deliveryId)) return;
      setLive({ lat: p.data.lat, lng: p.data.lng, updatedAt: p.data.updatedAt });
    };
    socket.on('delivery.location', onLocation);
    return () => {
      socket.off('delivery.location', onLocation);
    };
  }, [socket, orderId, deliveryId]);
  return live;
}

/** Rafraîchit la commande quand sa livraison change (`delivery.updated`). */
export function useDeliveryUpdates(orderId: string) {
  const { socket } = useRealtime();
  const qc = useQueryClient();
  useEffect(() => {
    if (!socket) return;
    const onUpdated = (ev: { orderId?: unknown } | null) => {
      if (ev?.orderId === orderId) void qc.invalidateQueries({ queryKey: shopKeys.order(orderId) });
    };
    socket.on('delivery.updated', onUpdated);
    return () => {
      socket.off('delivery.updated', onUpdated);
    };
  }, [socket, orderId, qc]);
}

const STEP_KEY: Record<string, MessageKey> = {
  pending: 'delivery.status.pending',
  assigned: 'delivery.status.assigned',
  picked_up: 'delivery.status.picked_up',
  in_transit: 'delivery.status.in_transit',
  delivered: 'delivery.status.delivered',
};

/** Livraison vue par l'acheteur : frise, livreur, code, position du livreur, évaluation. */
export function BuyerDelivery({ orderId, delivery }: { orderId: string; delivery: DeliveryView }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [revealed, setRevealed] = useState(true);
  const live = useLiveCourierLocation(orderId, delivery.id, delivery.location);
  const [distance, setDistance] = useState<number | null>(null);
  const [distanceError, setDistanceError] = useState(false);
  useDeliveryUpdates(orderId);

  const bad = delivery.status === 'failed' || delivery.status === 'returned';
  const inTransit = delivery.status === 'in_transit';
  const steps = stepStates(delivery.status);

  async function measure() {
    setDistanceError(false);
    const me = await getDevicePosition();
    if (!me.ok || !live) return setDistanceError(true);
    setDistance(distanceKm(me.position, live));
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View accessibilityRole="list" style={{ gap: 0 }}>
        {steps.map((s, i) => {
          const label = t(STEP_KEY[s.step]!);
          return (
            <View key={s.step} accessible accessibilityRole="text" accessibilityLabel={`${label}, ${t(`delivery.step.${s.state}` as MessageKey)}`} style={styles.step}>
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: s.state === 'todo' ? colors.border : colors.primary, borderColor: colors.primary }]}>
                  {s.state === 'done' ? <Ionicons name="checkmark" size={10} color={colors.onPrimary} /> : null}
                </View>
                {i < steps.length - 1 ? <View style={[styles.line, { backgroundColor: s.state === 'done' ? colors.primary : colors.border }]} /> : null}
              </View>
              <Text variant={s.state === 'current' ? 'bodyStrong' : 'small'} muted={s.state === 'todo'} style={{ flex: 1, paddingBottom: spacing.md }}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      {bad ? (
        <View style={[styles.note, { backgroundColor: colors.dangerSoft }]} accessibilityLiveRegion="polite">
          <Text variant="bodyStrong" color={colors.danger}>
            {t(delivery.status === 'failed' ? 'delivery.status.failed' : 'delivery.status.returned')}
          </Text>
          {delivery.failureReason ? <Text variant="small">{delivery.failureReason}</Text> : null}
        </View>
      ) : null}

      {delivery.speed === 'express' || delivery.scheduledFor ? (
        <Text variant="small" muted>
          {delivery.speed === 'express' ? t('courier.speed.express') : t('courier.speed.standard')}
          {delivery.scheduledFor ? ` · ${t('courier.slot.at', { when: formatSlot(delivery.scheduledFor, locale) })}` : ''}
        </Text>
      ) : null}
      {delivery.courier ? (
        <Text accessibilityLabel={t('delivery.courierIs', { name: delivery.courier.displayName })}>
          {t('delivery.courier')} : <Text variant="bodyStrong">{delivery.courier.displayName}</Text>
        </Text>
      ) : (
        <Text variant="small" muted>
          {t('delivery.noCourier')}
        </Text>
      )}
      {live && !bad && delivery.status !== 'delivered' ? (
        <TileMap
          style={styles.map}
          fit={[live]}
          fitKey={`${live.lat},${live.lng}`}
          markers={[{ id: 'courier', lat: live.lat, lng: live.lng, label: delivery.courier?.displayName ?? t('delivery.courier'), selected: true }]}
        />
      ) : null}
      {delivery.estimatedMinutes && !bad && delivery.status !== 'delivered' ? (
        <Text variant="small" muted>
          {t('delivery.eta', { n: delivery.estimatedMinutes })}
        </Text>
      ) : null}

      {delivery.proofCode ? (
        <View style={[styles.codeBox, { backgroundColor: colors.primarySoft }]}>
          <Text variant="small" muted>
            {t('delivery.code.title')}
          </Text>
          <Text
            variant="display"
            color={colors.primary}
            selectable={revealed}
            accessibilityLabel={revealed ? `${t('delivery.code.title')} ${delivery.proofCode.split('').join(' ')}` : t('delivery.code.hidden')}
            style={styles.code}
          >
            {formatProofCode(delivery.proofCode, revealed)}
          </Text>
          <Text variant="caption" muted style={{ textAlign: 'center' }}>
            {t('delivery.code.hint')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? t('delivery.code.hide') : t('delivery.code.show')}
            onPress={() => setRevealed((r) => !r)}
            style={styles.toggle}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.primary} />
            <Text color={colors.primary} style={{ fontWeight: '600' }}>
              {revealed ? t('delivery.code.hide') : t('delivery.code.show')}
            </Text>
          </Pressable>
          {delivery.proofLocked ? (
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>
              {t('delivery.code.locked')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {inTransit ? (
        <View style={{ gap: spacing.sm }}>
          {live ? (
            <>
              <Text accessibilityLiveRegion="polite" variant="bodyStrong">
                {distance !== null ? t('delivery.location.at', { distance: formatDistance(distance, locale) }) : t('delivery.location.onTheWay')}
              </Text>
              <Text variant="caption" muted>
                {t('delivery.location.updated', { time: new Date(live.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}
              </Text>
              {distanceError ? (
                <Text variant="small" color={colors.danger}>
                  {t('delivery.location.distanceError')}
                </Text>
              ) : null}
              <Button variant="secondary" label={t('delivery.location.distance')} onPress={() => void measure()} />
              <Button
                variant="secondary"
                label={t('delivery.location.route')}
                onPress={() => void Linking.openURL(directionsUrl(Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web', live))}
              />
            </>
          ) : (
            <Text variant="small" muted>
              {delivery.locationSharing ? t('delivery.location.waiting') : t('delivery.location.off')}
            </Text>
          )}
        </View>
      ) : null}

      <ProofView bare deliveryId={delivery.id} status={delivery.status} />
      {canRate(delivery.status, delivery.rating) ? <RateCourier orderId={orderId} /> : null}
      {delivery.rating !== null ? (
        <Text variant="small" muted accessibilityLabel={t('delivery.rate.done', { n: delivery.rating })}>
          {t('delivery.rate.done', { n: delivery.rating })}
        </Text>
      ) : null}
    </View>
  );
}

function RateCourier({ orderId }: { orderId: string }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const send = useMutation({
    mutationFn: () => rateDelivery(orderId, { rating: stars, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: shopKeys.order(orderId) }),
  });
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {t('delivery.rate.title')}
      </Text>
      <View style={styles.stars} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ selected: stars === n }}
            accessibilityLabel={t('delivery.rate.star', { n })}
            onPress={() => setStars(n)}
            style={styles.star}
          >
            <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={32} color={colors.primary} />
          </Pressable>
        ))}
      </View>
      <TextField label={t('delivery.rate.comment')} value={comment} onChangeText={setComment} maxLength={500} multiline />
      {send.isError ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {deliveryErrorMessage(send.error, t, locale)}
        </Text>
      ) : null}
      <Button label={t('delivery.rate.send')} disabled={stars === 0} loading={send.isPending} onPress={() => send.mutate()} />
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 200, borderRadius: radius.lg },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.md },
  step: { flexDirection: 'row', gap: spacing.md, minHeight: 36 },
  rail: { alignItems: 'center', width: 16 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, marginVertical: 2 },
  note: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  codeBox: { borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', gap: spacing.xs },
  code: { fontSize: 44, lineHeight: 52, letterSpacing: 6, fontVariant: ['tabular-nums'] },
  toggle: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  stars: { flexDirection: 'row', gap: spacing.xs },
  star: { minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
