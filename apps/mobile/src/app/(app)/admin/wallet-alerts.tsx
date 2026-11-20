import type { AdminWalletAlert } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { cck } from '../../../admin/console-api';
import { AdminList, Denied, adminErrorMessage, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { fetchWalletAlerts, reviewWalletAlert } from '../../../admin/ops2-api';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips } from '../../../seller/ui';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text } from '../../../ui';

const STATUSES = ['open', 'reviewed', 'dismissed'] as const;

function AlertCard({ a }: { a: AdminWalletAlert }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: () => reviewWalletAlert(a.id),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: cck.all }); },
    onError: (e) => setError(adminErrorMessage(e, t, locale)),
  });
  return (
    <Card style={adminStyles.card}>
      <Text variant="bodyStrong">{t(`ops2.walletAlerts.rule.${a.rule}` as MessageKey)}</Text>
      <View style={adminStyles.badges}>
        <Badge tone={a.severity === 'high' ? 'accent' : 'neutral'} label={t(`ops2.walletAlerts.severity.${a.severity}` as MessageKey)} />
        <Badge tone={a.status === 'open' ? 'primary' : 'neutral'} label={t(`ops2.walletAlerts.status.${a.status}` as MessageKey)} />
      </View>
      <Text variant="small" muted>{a.user.displayName} · @{a.user.handle} · {when(a.createdAt, locale)}</Text>
      {a.reported ? <Text variant="small">{t('ops2.walletAlerts.reported')}</Text> : null}
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      {a.status === 'open' ? <Button variant="secondary" label={t('ops2.walletAlerts.review')} loading={review.isPending} onPress={() => review.mutate()} /> : null}
    </Card>
  );
}

/** Alertes d'anomalie du portefeuille (information seulement : aucun transfert n'est bloqué par une alerte). */
export default function WalletAlerts() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin']);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('open');
  const query = useCursorList(['wallet-alerts', status], (c) => fetchWalletAlerts(status, c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<AdminWalletAlert>
      title={t('ops2.walletAlerts.title')}
      query={query}
      keyExtractor={(a) => a.id}
      emptyTitle={t('adm.empty')}
      header={
        <View>
          <Text variant="small" muted style={{ padding: 16 }}>{t('ops2.walletAlerts.note')}</Text>
          <Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`ops2.walletAlerts.status.${s}` as MessageKey) }))} />
        </View>
      }
      renderItem={({ item }) => <AlertCard a={item} />}
    />
  );
}
