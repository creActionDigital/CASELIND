import type { DeliveryZone } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { deliveryKeys, fetchZones, patchZone } from '../../../../../delivery/api';
import { deliveryErrorMessage } from '../../../../../delivery/errors';
import { useI18n } from '../../../../../i18n';
import { useMembership } from '../../../../../seller/api';
import { formatMinor } from '../../../../../seller/money';
import { can } from '../../../../../seller/permissions';
import { Card, Loading } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, EmptyState, ErrorState, IconButton, Text } from '../../../../../ui';

/** Zones de livraison de l'organisation : liste, création, modification, désactivation (avec confirmation). */
export default function SellerZones() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role } = useMembership(orgId);
  const canManage = can(role, 'orders.manage');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({ queryKey: deliveryKeys.zones(orgId), queryFn: () => fetchZones(orgId), enabled: canManage });
  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => patchZone(orgId, v.id, { active: v.active }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setConfirmId(null);
      void qc.invalidateQueries({ queryKey: deliveryKeys.zones(orgId) });
    },
    onError: (e) => setError(deliveryErrorMessage(e, t, locale)),
  });
  const open = (zoneId: string) => router.push({ pathname: '/seller/[orgId]/zones/[zoneId]', params: { orgId, zoneId } });

  let body;
  if (!canManage) body = <EmptyState icon="lock-closed-outline" title={t('seller.noAccess')} />;
  else if (q.isPending) body = <Loading />;
  else if (q.isError) body = <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else if (q.data.items.length === 0)
    body = <EmptyState icon="bicycle-outline" title={t('delivery.zones.emptyTitle')} body={t('delivery.zones.emptyBody')} actionLabel={t('delivery.zones.new')} onAction={() => open('new')} />;
  else
    body = (
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {q.data.items.map((z: DeliveryZone) => (
          <Card key={z.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {z.name}
              </Text>
              <Badge tone={z.active ? 'primary' : 'neutral'} label={z.active ? t('seller.coupon.active') : t('seller.coupon.inactive')} />
            </View>
            <Text variant="small" muted numberOfLines={2}>
              {z.areas.join(', ')}
            </Text>
            <Text variant="small" muted>
              {Object.entries(z.fees)
                .map(([c, n]) => formatMinor(n, c, locale))
                .join(' · ')}{' '}
              · {t('delivery.eta', { n: z.etaMinutes })}
            </Text>
            <Button variant="secondary" label={t('delivery.zones.edit')} accessibilityLabel={`${t('delivery.zones.edit')} ${z.name}`} onPress={() => open(z.id)} />
            {confirmId === z.id ? (
              <View style={{ gap: spacing.sm }}>
                <Text variant="small">{t('delivery.zones.deactivateBody')}</Text>
                <Button variant="danger" label={t('delivery.zones.deactivate')} loading={toggle.isPending} onPress={() => toggle.mutate({ id: z.id, active: false })} />
                <Button variant="secondary" label={t('common.cancel')} onPress={() => setConfirmId(null)} />
              </View>
            ) : z.active ? (
              <Button variant="ghost" label={t('delivery.zones.deactivate')} onPress={() => setConfirmId(z.id)} />
            ) : (
              <Button variant="ghost" label={t('delivery.zones.activate')} loading={toggle.isPending} onPress={() => toggle.mutate({ id: z.id, active: true })} />
            )}
          </Card>
        ))}
      </ScrollView>
    );

  return (
    <>
      <Stack.Screen
        options={{
          title: t('delivery.zones.title'),
          headerRight: () => (canManage ? <IconButton icon="add" label={t('delivery.zones.new')} onPress={() => open('new')} /> : null),
        }}
      />
      {body}
    </>
  );
}
