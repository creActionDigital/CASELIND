import type { DriverProfile } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { cck, decideDriver, fetchDrivers } from '../../../admin/console-api';
import { accountDecisions, decisionNeedsReason, type Decision } from '../../../admin/console-logic';
import { Denied, adminStyles, isDenied, useHasRole } from '../../../admin/kit';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips, Loading } from '../../../seller/ui';
import { Badge, Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';
import { DecisionPanel } from '../../../admin/kit';

const STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;

function DriverCard({ d }: { d: DriverProfile }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (v: { x: 'approve' | 'reject' | 'suspend'; reason: string }) => decideDriver(d.userId, v.x, v.reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });
  return (
    <Card style={adminStyles.cardFlat}>
      <Text variant="bodyStrong">{d.displayName}</Text>
      <Text variant="small" muted>{t('adm.drv.vehicle', { make: d.vehicle.make, plate: d.vehicle.plate, zone: d.zone })}</Text>
      <Text variant="small" muted>{t('adm.drv.rating', { avg: d.ratingAverage ?? '-', n: d.ratingCount, c: d.cancellations })}</Text>
      <View style={adminStyles.badges}>
        <Badge tone={d.status === 'pending' ? 'accent' : d.status === 'approved' ? 'primary' : 'neutral'} label={t(`adm.status.${d.status}` as MessageKey)} />
      </View>
      {d.decisionReason ? <Text variant="small" muted>{t('adm.kyc.reasonShown', { reason: d.decisionReason })}</Text> : null}
      <DecisionPanel<Decision>
        name={d.displayName}
        decisions={accountDecisions(d.status)}
        needsReason={decisionNeedsReason}
        labelOf={(x) => t(`adm.decision.${x}` as MessageKey)}
        run={(x, reason) => decide.mutateAsync({ x: x as 'approve' | 'reject' | 'suspend', reason })}
      />
    </Card>
  );
}

/** Profils de chauffeurs à approuver (l'API ne pagine pas : 100 au plus par statut). */
export default function Drivers() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin']);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending');
  const q = useQuery({ queryKey: cck.list('drivers', status), queryFn: () => fetchDrivers(status), enabled: allowed });
  if (!allowed || isDenied(q.error)) return <Denied />;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('adm.drv.title') }} />
      <Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`adm.status.${s}` as MessageKey) }))} />
      <Button variant="ghost" label={t('adm.refresh')} loading={q.isRefetching} onPress={() => void q.refetch()} />
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? <EmptyState icon="car-sport-outline" title={t('adm.empty')} /> : q.data.items.map((d) => <DriverCard key={d.userId} d={d} />)}
    </Screen>
  );
}
