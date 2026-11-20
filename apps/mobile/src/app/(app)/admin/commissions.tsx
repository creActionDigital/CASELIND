import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { UUID_RE } from '../../../admin/console-logic';
import { Denied, adminErrorMessage, useHasRole } from '../../../admin/kit';
import { fetchPlatformCommissions, o2k, setOrgCommission } from '../../../admin/ops2-api';
import { wholeBps } from '../../../admin/ops2-logic';
import { useI18n } from '../../../i18n';
import { Card } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Commissions de la plateforme : relevé indicatif (aucun prélèvement réel) et taux par organisation. Le taux par défaut se règle dans « Paramètres ». */
export default function Commissions() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const allowed = useHasRole(['admin']);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [orgId, setOrgId] = useState('');
  const [bps, setBps] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = (d: string) => d === '' || /^\d{4}-\d{2}-\d{2}$/.test(d);
  const q = useQuery({ queryKey: o2k.list('commissions', from, to), queryFn: () => fetchPlatformCommissions(from, to), enabled: allowed && valid(from) && valid(to) });
  const override = useMutation({
    mutationFn: () => setOrgCommission(orgId.trim(), bps.trim() === '' ? null : wholeBps(bps), reason.trim()),
    onSuccess: () => { setNotice(t('ops2.comm.applied')); setError(null); },
    onError: (e) => { setNotice(null); setError(adminErrorMessage(e, t, locale)); },
  });
  if (!allowed) return <Denied />;
  const bpsOk = bps.trim() === '' || wholeBps(bps) !== null;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('ops2.comm.title') }} />
      <Text muted>{t('ops2.comm.indicative')}</Text>
      <TextField label={t('ops2.comm.from')} value={from} onChangeText={setFrom} autoCapitalize="none" maxLength={10} />
      <TextField label={t('ops2.comm.to')} value={to} onChangeText={setTo} autoCapitalize="none" maxLength={10} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data?.totals.map((x) => (
        <Card key={x.currency} style={styles.card}>
          <Text variant="bodyStrong">{t('ops2.comm.total', { currency: x.currency, orders: x.orders, gross: formatMoney(x.grossMinor, x.currency, locale), commission: formatMoney(x.commissionMinor, x.currency, locale) })}</Text>
        </Card>
      ))}
      {q.data && q.data.byOrg.length > 0 ? <Text variant="bodyStrong">{t('ops2.comm.byOrg')}</Text> : null}
      {q.data?.byOrg.map((o) => (
        <Text key={`${o.orgId}${o.currency}`} variant="small">{t('ops2.comm.orgLine', { name: o.orgName, orders: o.orders, commission: formatMoney(o.commissionMinor, o.currency, locale) })}</Text>
      ))}
      <Text variant="bodyStrong" style={{ marginTop: spacing.md }}>{t('ops2.comm.override')}</Text>
      <TextField label={t('ops2.comm.orgId')} value={orgId} onChangeText={setOrgId} autoCapitalize="none" maxLength={40} />
      <TextField label={t('ops2.comm.bps')} value={bps} onChangeText={setBps} keyboardType="number-pad" maxLength={4} />
      <TextField label={t('ops2.comm.reason')} value={reason} onChangeText={setReason} maxLength={300} />
      {notice ? <Text variant="small" accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button label={t('ops2.comm.apply')} loading={override.isPending} disabled={!UUID_RE.test(orgId.trim()) || !bpsOk || reason.trim().length < 3} onPress={() => override.mutate()} />
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.xs, marginBottom: spacing.sm } });
