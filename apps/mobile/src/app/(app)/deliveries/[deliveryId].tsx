import type { CourierDelivery } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { ApiRequestError } from '../../../lib/api';
import { courierStatus, deliveryKeys, fetchMyDelivery, postLocation, setLocationConsent } from '../../../delivery/api';
import { deliveryErrorMessage, isLocationStop, proofFailure } from '../../../delivery/errors';
import { formatSlot } from '../../../delivery/schedule-logic';
import { CourierProof } from '../../../delivery/ProofSection';
import { canShareLocation, courierActions, createLocationPump, isCompleteCode, type CourierAction } from '../../../delivery/logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { getDevicePosition } from '../../../places/device-location';
import { Card, Loading, SectionTitle } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { PinPad } from '../../../wallet/ui';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

const ACTION_LABEL: Record<CourierAction, MessageKey> = {
  picked_up: 'delivery.action.picked_up',
  in_transit: 'delivery.action.in_transit',
  delivered: 'delivery.action.delivered',
  failed: 'delivery.action.failed',
  returned: 'delivery.action.returned',
};

type Panel = null | 'code' | 'failed';

/** Détail d'une livraison pour le livreur : adresse, montant à encaisser, actions selon le statut, code, position. */
export default function CourierDeliveryDetail() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { deliveryId, orderId } = useLocalSearchParams<{ deliveryId: string; orderId?: string }>();
  const id = String(deliveryId);
  const q = useQuery({ queryKey: deliveryKeys.one(id), queryFn: () => fetchMyDelivery(id), retry: false });
  const [panel, setPanel] = useState<Panel>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Une notification de livraison destinée à l'acheteur arrive ici avec l'identifiant de commande : on le redirige.
  useEffect(() => {
    if (q.error instanceof ApiRequestError && q.error.status === 404 && orderId) {
      router.replace({ pathname: '/orders/[orderId]', params: { orderId: String(orderId) } });
    }
  }, [q.error, orderId, router]);

  function store(d: CourierDelivery) {
    qc.setQueryData(deliveryKeys.one(id), d);
    void qc.invalidateQueries({ queryKey: deliveryKeys.minePrefix });
  }

  const change = useMutation({
    mutationFn: (v: { status: CourierAction; code?: string; reason?: string }) => courierStatus(id, v),
    onMutate: () => {
      setError(null);
      setCodeError(null);
    },
    onSuccess: (d) => {
      store(d);
      setPanel(null);
      setCode('');
      setReason('');
    },
    onError: (e, v) => {
      const proof = proofFailure(e);
      if (v.status === 'delivered' && proof) {
        setCode('');
        setCodeError(deliveryErrorMessage(e, t, locale));
        if (proof.kind === 'locked') void q.refetch();
        return;
      }
      setError(deliveryErrorMessage(e, t, locale));
      void q.refetch();
    },
  });

  const consent = useMutation({
    mutationFn: (granted: boolean) => setLocationConsent(id, granted),
    onMutate: () => setError(null),
    onSuccess: store,
    onError: (e) => setError(deliveryErrorMessage(e, t, locale)),
  });

  const d = q.data;
  const sharing = !!d && d.locationSharing && canShareLocation(d.status);

  // Envoi de la position : seulement pendant le trajet et avec consentement, rien n'est stocké sur l'appareil.
  const stopped = useRef(() => {});
  stopped.current = () => void qc.invalidateQueries({ queryKey: deliveryKeys.one(id) });
  useEffect(() => {
    if (!sharing) return;
    const pump = createLocationPump({
      getPosition: async () => {
        const r = await getDevicePosition();
        return r.ok ? r.position : null;
      },
      send: (p) => postLocation(id, p.lat, p.lng),
      shouldStop: isLocationStop,
      onStop: () => stopped.current(),
    });
    pump.start();
    return () => pump.stop();
  }, [sharing, id]);

  if (q.isPending) return <Loading />;
  if (q.isError) {
    if (q.error instanceof ApiRequestError && q.error.status === 404 && orderId) return <Loading />;
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  }
  const dd = q.data;
  const actions = courierActions(dd.status);
  const money = formatMoney(dd.totalMinor, dd.currency, locale);

  function onAction(a: CourierAction) {
    setError(null);
    if (a === 'delivered') return setPanel('code');
    if (a === 'failed') return setPanel('failed');
    change.mutate({ status: a });
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: dd.orderNumber }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Text variant="title" style={{ flex: 1 }}>
          {dd.orderNumber}
        </Text>
        <Badge tone="neutral" label={t(`delivery.status.${dd.status}` as MessageKey)} />
      </View>
      <Text muted>{dd.orgName}</Text>
      {dd.speed === 'express' || dd.scheduledFor ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {dd.speed === 'express' ? <Badge tone="accent" label={t('courier.speed.express')} /> : null}
          {dd.scheduledFor ? <Badge tone="neutral" label={t('courier.slot.at', { when: formatSlot(dd.scheduledFor, locale) })} /> : null}
        </View>
      ) : null}

      <SectionTitle>{t('delivery.courier.address')}</SectionTitle>
      <Card>
        {dd.address ? (
          <>
            <Text variant="bodyStrong">{dd.address.name}</Text>
            <Text>{dd.address.line1}</Text>
            {dd.address.line2 ? <Text>{dd.address.line2}</Text> : null}
            <Text>{dd.address.city}</Text>
            {dd.address.notes ? (
              <Text variant="small" muted>
                {dd.address.notes}
              </Text>
            ) : null}
            <Text selectable>{dd.address.phone}</Text>
            <Button
              variant="secondary"
              label={t('seller.order.call')}
              accessibilityLabel={`${t('seller.order.call')} ${dd.address.phone}`}
              onPress={() => void Linking.openURL(`tel:${dd.address!.phone}`)}
              style={{ marginTop: spacing.sm }}
            />
          </>
        ) : (
          <Text muted>{t('orders.addressErased')}</Text>
        )}
      </Card>

      <SectionTitle>{t('delivery.courier.collect')}</SectionTitle>
      <Card>
        <Text variant="display">{money}</Text>
        <Text variant="small" muted>
          {t('delivery.mine.items', { n: dd.itemCount })} · {t('delivery.courier.cashNote')}
        </Text>
        {dd.estimatedMinutes ? (
          <Text variant="small" muted>
            {t('delivery.eta', { n: dd.estimatedMinutes })}
          </Text>
        ) : null}
      </Card>

      {dd.failureReason ? (
        <Text color={colors.danger} variant="small">
          {dd.failureReason}
        </Text>
      ) : null}
      {dd.proofLocked ? (
        <Card style={{ backgroundColor: colors.dangerSoft }}>
          <Text variant="bodyStrong" color={colors.danger} accessibilityLiveRegion="polite">
            {t('delivery.proofLocked')}
          </Text>
          <Text variant="small">{t('delivery.proofLockedBody')}</Text>
        </Card>
      ) : null}

      {canShareLocation(dd.status) ? (
        <>
          <SectionTitle>{t('delivery.share.title')}</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Text variant="small" muted>
              {t('delivery.share.body')}
            </Text>
            {dd.locationSharing ? (
              <>
                <Text variant="small" accessibilityLiveRegion="polite">
                  {t('delivery.share.on')}
                </Text>
                <Button variant="secondary" label={t('delivery.share.stop')} loading={consent.isPending} onPress={() => consent.mutate(false)} />
              </>
            ) : (
              <Button variant="secondary" label={t('delivery.share.start')} loading={consent.isPending} onPress={() => consent.mutate(true)} />
            )}
          </Card>
        </>
      ) : null}

      <CourierProof deliveryId={dd.id} status={dd.status} />

      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {panel === 'code' ? (
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading" accessibilityRole="header">
            {t('delivery.code.enterTitle')}
          </Text>
          <Text muted>{t('delivery.code.enterBody')}</Text>
          <PinPad value={code} onChange={(v) => { setCode(v); setCodeError(null); }} disabled={change.isPending || dd.proofLocked} error={codeError} />
          <Button
            label={t('delivery.action.delivered')}
            disabled={!isCompleteCode(code) || dd.proofLocked}
            loading={change.isPending}
            onPress={() => change.mutate({ status: 'delivered', code })}
          />
          <Button variant="secondary" label={t('common.cancel')} disabled={change.isPending} onPress={() => { setPanel(null); setCode(''); setCodeError(null); }} />
        </Card>
      ) : panel === 'failed' ? (
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading" accessibilityRole="header">
            {t('delivery.failed.title')}
          </Text>
          <TextField label={t('delivery.failed.reason')} value={reason} onChangeText={setReason} maxLength={500} multiline />
          <Button variant="danger" label={t('delivery.action.failed')} disabled={!reason.trim()} loading={change.isPending} onPress={() => change.mutate({ status: 'failed', reason: reason.trim() })} />
          <Button variant="secondary" label={t('common.cancel')} disabled={change.isPending} onPress={() => setPanel(null)} />
        </Card>
      ) : actions.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          {actions.map((a) => (
            <Button
              key={a}
              variant={a === 'failed' ? 'danger' : a === 'delivered' || a === 'picked_up' || a === 'in_transit' ? 'primary' : 'secondary'}
              label={t(ACTION_LABEL[a])}
              disabled={change.isPending || (a === 'delivered' && dd.proofLocked)}
              loading={change.isPending && change.variables?.status === a}
              onPress={() => onAction(a)}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
