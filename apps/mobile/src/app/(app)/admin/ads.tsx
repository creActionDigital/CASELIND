import type { AdminCampaign, AdStatus } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { fetchAdminAds, reviewAd } from '../../../ads/api';
import { AD_STATUSES } from '../../../ads/logic';
import { cck, settleAds } from '../../../admin/console-api';
import { AdminList, Denied, adminErrorMessage, adminStyles, useCursorList, useHasRole } from '../../../admin/kit';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Chips } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text, TextField } from '../../../ui';

function AdCard({ c }: { c: AdminCampaign }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => reviewAd(c.id, { decision, reason: decision === 'reject' ? reason.trim() : undefined }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: cck.all });
    },
    onError: (e) => setError(adminErrorMessage(e, t, locale)),
  });
  const open = c.status === 'pending' || c.status === 'approved' || c.status === 'paused';
  return (
    <Card style={adminStyles.card}>
      <View style={adminStyles.badges}>
        <Badge tone={c.status === 'pending' ? 'accent' : 'neutral'} label={t(`mon.ads.status.${c.status}` as MessageKey)} />
        <Text variant="small">{formatMoney(c.budgetMinor, c.currency, locale)}</Text>
      </View>
      <Text style={{ fontWeight: '700' }}>{c.name}</Text>
      {c.preview ? <Text numberOfLines={4}>{c.preview}</Text> : null}
      <Text variant="small" muted>
        {c.placements.map((p) => t(`mon.ads.pl.${p}` as MessageKey)).join(', ')} · {c.startsOn} → {c.endsOn}
      </Text>
      <Text variant="small" muted>
        {t('mon.adm.ads.audience', { country: c.audience.country ?? t('mon.adm.ads.anyCountry') })}
      </Text>
      {c.rejectionReason ? <Text variant="small" color={colors.danger}>{t('mon.ads.reason', { reason: c.rejectionReason })}</Text> : null}
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      {open ? <TextField label={t('mon.adm.ads.reason')} value={reason} onChangeText={setReason} maxLength={300} /> : null}
      {c.status === 'pending' ? (
        <Button
          label={t('mon.adm.ads.approve')}
          loading={review.isPending}
          onPress={() => alertConfirm(t('mon.adm.ads.approve'), t('mon.adm.ads.approve.confirm'), [{ text: t('adm.cancel'), style: 'cancel' }, { text: t('mon.adm.ads.approve'), onPress: () => review.mutate('approve') }])}
        />
      ) : null}
      {open ? (
        <Button
          variant="danger"
          label={t('mon.adm.ads.reject')}
          disabled={reason.trim().length < 3 || review.isPending}
          onPress={() => alertConfirm(t('mon.adm.ads.reject'), t('mon.adm.ads.reject.confirm'), [{ text: t('adm.cancel'), style: 'cancel' }, { text: t('mon.adm.ads.reject'), style: 'destructive', onPress: () => review.mutate('reject') }])}
        />
      ) : null}
    </Card>
  );
}

/** Revue des campagnes publicitaires avant diffusion : approuver, ou refuser avec motif (le budget non dépensé est remboursé). */
export default function AdminAds() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [settled, setSettled] = useState<{ ok: boolean; text: string } | null>(null);
  const settle = useMutation({
    mutationFn: settleAds,
    onSuccess: (r) => {
      setSettled({ ok: true, text: t('adm.ads.settle.done', { n: r.settled }) });
      void qc.invalidateQueries({ queryKey: cck.all });
    },
    onError: (e) => setSettled({ ok: false, text: adminErrorMessage(e, t, locale) }),
  });
  const allowed = useHasRole(['admin', 'moderator']);
  const [status, setStatus] = useState<AdStatus>('pending');
  const query = useCursorList(['ads', status], (c) => fetchAdminAds(status, c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<AdminCampaign>
      title={t('mon.adm.ads.title')}
      query={query}
      keyExtractor={(c) => c.id}
      emptyTitle={t('adm.empty')}
      header={
        <View style={{ gap: 12 }}>
          <Button variant="secondary" label={t('adm.ads.settle')} loading={settle.isPending} onPress={() => alertConfirm(t('adm.ads.settle'), t('adm.ads.settle'), [{ text: t('adm.cancel'), style: 'cancel' }, { text: t('adm.ads.settle'), onPress: () => settle.mutate() }])} />
          {settled ? <Text variant="small" accessibilityLiveRegion="polite">{settled.text}</Text> : null}
          <Chips value={status} onChange={setStatus} options={AD_STATUSES.map((s) => ({ value: s, label: t(`mon.ads.status.${s}` as MessageKey) }))} />
        </View>
      }
      renderItem={({ item }) => <AdCard c={item} />}
    />
  );
}
