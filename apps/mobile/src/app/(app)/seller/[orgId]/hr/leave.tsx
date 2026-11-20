import type { LeaveRequest, LeaveStatus } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { decideLeave, fetchLeaves, hrKeys } from '../../../../../business/hr/api';
import { businessErrorMessage } from '../../../../../business/hr/errors';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { alertConfirm } from '../../../../../lib/confirm';
import { Card, Chips, Loading } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text } from '../../../../../ui';

const STATUSES: LeaveStatus[] = ['requested', 'approved', 'rejected', 'cancelled'];

/** Demandes de congé à décider : toute l'organisation pour la RH, les subordonnés directs pour un responsable (le serveur filtre). */
export default function LeaveToHandle() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [status, setStatus] = useState<LeaveStatus>('requested');
  const [info, setInfo] = useState<string | null>(null);
  const list = useQuery({ queryKey: hrKeys.leaves(orgId, status), queryFn: () => fetchLeaves(orgId, status), enabled: !!orgId });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => decideLeave(orgId, id, { decision }),
    onMutate: () => setInfo(null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: hrKeys.all(orgId) }),
    onError: (e) => setInfo(businessErrorMessage(e, t, locale)),
  });
  const reject = (l: LeaveRequest) =>
    alertConfirm(t('hr.leave.rejectConfirm'), l.displayName, [
      { text: t('hr.cancel'), style: 'cancel' },
      { text: t('hr.leave.reject'), style: 'destructive', onPress: () => decide.mutate({ id: l.id, decision: 'reject' }) },
    ]);

  const title = <Stack.Screen options={{ title: t('hr.leave.title') }} />;
  if (list.isPending) return <>{title}<Loading /></>;
  if (list.isError) return <>{title}<ErrorState error={list.error} onRetry={() => list.refetch()} /></>;
  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Chips options={STATUSES.map((s) => ({ value: s, label: t(`hr.leave.status.${s}` as MessageKey) }))} value={status} onChange={setStatus} />
          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
          {list.data.items.length === 0 ? <Text muted>{t('hr.leave.empty')}</Text> : null}
          {list.data.items.map((l) => (
            <Card key={l.id}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>{l.displayName}</Text>
                <Badge tone={l.status === 'requested' ? 'accent' : 'neutral'} label={t(`hr.leave.status.${l.status}` as MessageKey)} />
              </View>
              <Text variant="small">{t(`hr.leave.kind.${l.kind}` as MessageKey)} · {l.startsOn} {'->'} {l.endsOn} · {t('hr.leave.days', { n: l.days })}</Text>
              {l.reason ? <Text variant="small" muted>{l.reason}</Text> : null}
              {l.status === 'requested' ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button label={t('hr.leave.approve')} loading={decide.isPending && decide.variables?.id === l.id} onPress={() => decide.mutate({ id: l.id, decision: 'approve' })} />
                  <Button variant="secondary" label={t('hr.leave.reject')} onPress={() => reject(l)} />
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      </Screen>
    </>
  );
}
