import type { AdminBoost } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { cck } from '../../../admin/console-api';
import { AdminList, Denied, adminErrorMessage, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { fetchBoosts, rejectBoost } from '../../../admin/ops2-api';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Chips } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text } from '../../../ui';

const STATUSES = ['active', 'ended', 'cancelled', 'rejected'] as const;

function BoostCard({ b }: { b: AdminBoost }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const reject = useMutation({
    mutationFn: () => rejectBoost(b.id),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: cck.all }); },
    onError: (e) => setError(adminErrorMessage(e, t, locale)),
  });
  return (
    <Card style={adminStyles.card}>
      <View style={adminStyles.badges}>
        <Badge tone={b.status === 'active' ? 'primary' : 'neutral'} label={t(`ops2.boosts.status.${b.status}` as MessageKey)} />
        <Text variant="small">{t('ops2.boosts.budget', { amount: formatMoney(b.budgetMinor, b.currency, locale) })}</Text>
      </View>
      <Text variant="small" muted>{when(b.startsAt, locale)} → {when(b.endsAt, locale)}</Text>
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      {b.status === 'active' ? (
        <Button
          variant="secondary"
          label={t('ops2.boosts.reject')}
          loading={reject.isPending}
          onPress={() => alertConfirm(t('adm.confirmTitle'), t('ops2.boosts.confirm'), [{ text: t('adm.cancel'), style: 'cancel' }, { text: t('ops2.boosts.reject'), onPress: () => reject.mutate() }])}
        />
      ) : null}
    </Card>
  );
}

/** Publications boostées à examiner : rejeter un boost en cours rembourse son budget fictif. */
export default function Boosts() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin', 'moderator']);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('active');
  const query = useCursorList(['boosts', status], (c) => fetchBoosts(status, c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<AdminBoost>
      title={t('ops2.boosts.title')}
      query={query}
      keyExtractor={(b) => b.id}
      emptyTitle={t('adm.empty')}
      header={<Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`ops2.boosts.status.${s}` as MessageKey) }))} />}
      renderItem={({ item }) => <BoostCard b={item} />}
    />
  );
}
