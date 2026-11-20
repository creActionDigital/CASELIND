import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminApproval } from '@caselind/contracts';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { decideApproval, fetchApprovals, opsKeys } from '../../../admin-ops/api';
import { canCancel, canDecide, describeApproval, displayStatus, remainingHours, splitApprovals } from '../../../admin-ops/logic';
import { useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { alertConfirm } from '../../../lib/confirm';
import { errorMessage } from '../../../lib/errors';
import { Card, Chips, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';

type Tab = 'pending' | 'history';
type What = 'approve' | 'reject' | 'cancel';

/** Double validation (CDC §17, §26) : demandes d'opérations sensibles, à approuver par un autre administrateur. */
export default function AdminApprovals() {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const isAdmin = me?.roles.includes('admin') ?? false;
  const [tab, setTab] = useState<Tab>('pending');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: opsKeys.approvals, queryFn: fetchApprovals, enabled: isAdmin });

  const run = useMutation({
    mutationFn: (v: { id: string; what: What }) => decideApproval(v.id, v.what),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: opsKeys.approvals }); },
    onError: (e) => {
      const why = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      const key = `aops.approvals.err.${why ?? (e instanceof ApiRequestError && e.status === 403 ? 'forbidden' : '')}` as MessageKey;
      setError(t(key) !== key ? t(key) : errorMessage(e, t, locale));
      void qc.invalidateQueries({ queryKey: opsKeys.approvals });
    },
  });

  if (!isAdmin) return <EmptyState icon="lock-closed-outline" title={t('aops.denied')} />;

  const now = Date.now();
  const label = (a: AdminApproval) => {
    const d = describeApproval(a);
    const state = `aops.approvals.state.${d.state}` as MessageKey;
    return t(`aops.approvals.kind.${a.kind}` as MessageKey, { name: d.name, state: t(state) !== state ? t(state) : d.state });
  };
  const confirm = (a: AdminApproval, what: What) => {
    const msg = t(`aops.approvals.confirm${what === 'approve' ? 'Approve' : what === 'reject' ? 'Reject' : 'Cancel'}` as MessageKey, { what: label(a) });
    const action = t(`aops.approvals.${what}` as MessageKey);
    alertConfirm(t('aops.approvals.title'), msg, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: action, style: what === 'approve' ? 'default' : 'destructive', onPress: () => run.mutate({ id: a.id, what }) },
    ]);
  };

  const { pending, history } = splitApprovals(q.data?.items ?? [], now);
  const rows = tab === 'pending' ? pending : history;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('aops.approvals.title') }} />
      <Text variant="small" muted>{t('aops.approvals.intro')}</Text>
      <Chips<Tab>
        value={tab}
        onChange={(v) => { setTab(v); setError(null); }}
        options={[
          { value: 'pending', label: `${t('aops.approvals.tab.pending')} (${pending.length})` },
          { value: 'history', label: t('aops.approvals.tab.history') },
        ]}
      />
      {error ? <Text variant="small" color="#B91C1C" accessibilityLiveRegion="polite">{error}</Text> : null}
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon="shield-checkmark-outline" title={t(tab === 'pending' ? 'aops.approvals.emptyPending' : 'aops.approvals.emptyHistory')} />
      ) : (
        rows.map((a) => {
          const status = displayStatus(a, now);
          return (
            <Card key={a.id} style={styles.card}>
              <Text variant="bodyStrong">{label(a)}</Text>
              {a.reason ? <Text variant="small" muted>{t('aops.approvals.reason', { reason: a.reason })}</Text> : null}
              <Text variant="small" muted>{t('aops.approvals.by', { name: a.requestedByName ?? '–' })}</Text>
              <View style={styles.row}>
                <Badge tone={status === 'pending' ? 'accent' : status === 'executed' ? 'primary' : 'neutral'} label={t(`aops.approvals.status.${status}` as MessageKey)} />
                {status === 'pending' ? <Text variant="caption" muted>{t('aops.approvals.expiresIn', { h: remainingHours(a.expiresAt, now) })}</Text> : null}
                {a.decidedByName ? <Text variant="caption" muted>{t('aops.approvals.decidedBy', { name: a.decidedByName })}</Text> : null}
              </View>
              {canDecide(a, me?.id, now) ? (
                <View style={styles.row}>
                  <Button label={t('aops.approvals.approve')} loading={run.isPending} onPress={() => confirm(a, 'approve')} />
                  <Button variant="secondary" label={t('aops.approvals.reject')} disabled={run.isPending} onPress={() => confirm(a, 'reject')} />
                </View>
              ) : null}
              {canCancel(a, me?.id, now) ? (
                <>
                  <Text variant="small" muted>{t('aops.approvals.mine')}</Text>
                  <Button variant="ghost" label={t('aops.approvals.cancel')} disabled={run.isPending} onPress={() => confirm(a, 'cancel')} />
                </>
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs, marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
});
