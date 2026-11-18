import type { DeliveryView, OrgMember } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n, type MessageKey } from '../i18n';
import { sk } from '../seller/api';
import { Card, SectionTitle } from '../seller/ui';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Badge, Button, Text } from '../ui';
import { assignCourier, deliveryKeys, fetchOrgMembers, resetProof } from './api';
import { deliveryErrorMessage } from './errors';
import { canAssignCourier, courierCandidates } from './seller-logic';
import { ProofView } from './ProofSection';

/** Livraison d'une commande côté vendeur : statut, livreur, affectation / réaffectation, réinitialisation du verrou du code. */
export function SellerDelivery({ orgId, orderId, delivery, canManage }: { orgId: string; orderId: string; delivery: DeliveryView; canManage: boolean }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { me } = useAuth();
  const [picking, setPicking] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignable = canManage && canAssignCourier(delivery.status);
  // Lister les membres demande `org.members.view` : sans ce droit, seul « moi-même » reste proposé.
  const members = useQuery({ queryKey: deliveryKeys.couriers(orgId), queryFn: () => fetchOrgMembers(orgId), enabled: picking, retry: false });
  const candidates = courierCandidates((members.data?.items ?? []) as OrgMember[], me ? { id: me.id, displayName: me.displayName } : null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: sk.order(orgId, orderId) });
    void qc.invalidateQueries({ queryKey: sk.orders(orgId) });
  };
  const assign = useMutation({
    mutationFn: (courierUserId: string) => assignCourier(orgId, delivery.id, courierUserId),
    onMutate: () => setError(null),
    onSuccess: () => {
      setPicking(false);
      refresh();
    },
    onError: (e) => setError(deliveryErrorMessage(e, t, locale)),
  });
  const reset = useMutation({
    mutationFn: () => resetProof(orgId, delivery.id),
    onMutate: () => setError(null),
    onSuccess: () => {
      setConfirmReset(false);
      refresh();
    },
    onError: (e) => setError(deliveryErrorMessage(e, t, locale)),
  });

  return (
    <>
      <SectionTitle>{t('delivery.title')}</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {delivery.courier ? delivery.courier.displayName : t('delivery.noCourier')}
          </Text>
          <Badge tone="neutral" label={t(`delivery.status.${delivery.status}` as MessageKey)} />
        </View>
        {delivery.failureReason ? (
          <Text variant="small" muted>
            {delivery.failureReason}
          </Text>
        ) : null}
        {delivery.proofLocked ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {t('delivery.seller.locked')}
          </Text>
        ) : null}
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {assignable && !picking ? (
          <Button variant="secondary" label={delivery.courier ? t('delivery.seller.reassign') : t('delivery.seller.assign')} onPress={() => setPicking(true)} />
        ) : null}
        {picking ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="bodyStrong">{t('delivery.seller.pick')}</Text>
            {members.isPending ? <Text muted>{t('common.loading')}</Text> : null}
            {candidates.length === 0 && !members.isPending ? <Text variant="small" muted>{t('delivery.seller.noCouriers')}</Text> : null}
            {candidates.map((c) => (
              <Button
                key={c.userId}
                variant={c.userId === delivery.courier?.userId ? 'primary' : 'secondary'}
                label={c.self ? t('delivery.seller.me', { name: c.displayName }) : c.displayName}
                disabled={assign.isPending}
                loading={assign.isPending && assign.variables === c.userId}
                onPress={() => assign.mutate(c.userId)}
              />
            ))}
            <Button variant="ghost" label={t('common.cancel')} onPress={() => setPicking(false)} />
          </View>
        ) : null}

        {canManage && delivery.proofLocked ? (
          confirmReset ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="small">{t('delivery.seller.resetBody')}</Text>
              <Button variant="danger" label={t('delivery.seller.reset')} loading={reset.isPending} onPress={() => reset.mutate()} />
              <Button variant="secondary" label={t('common.cancel')} onPress={() => setConfirmReset(false)} />
            </View>
          ) : (
            <Button variant="secondary" label={t('delivery.seller.reset')} onPress={() => setConfirmReset(true)} />
          )
        ) : null}
      </Card>
      <ProofView deliveryId={delivery.id} status={delivery.status} />
    </>
  );
}
