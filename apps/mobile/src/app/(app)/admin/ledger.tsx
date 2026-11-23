import type { AdminLedgerAccount } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { cck, fetchLedgerAccount, fetchReconcile, setLedgerAccountFrozen } from '../../../admin/console-api';
import { Denied, adminErrorMessage, adminStyles, isDenied, useHasRole, when } from '../../../admin/kit';
import { useI18n } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Loading, SectionTitle } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Consulte un compte du registre par son identifiant, puis le gèle ou le dégèle (double validation : 202 en attente d'un second admin). */
function AccountLookup() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [id, setId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = UUID.test(raw.trim());
  const account = useQuery({ queryKey: cck.list('ledger-account', id ?? ''), queryFn: () => fetchLedgerAccount(id as string), enabled: !!id, retry: false });
  const freeze = useMutation({
    mutationFn: (frozen: boolean) => setLedgerAccountFrozen(id as string, frozen),
    onSuccess: (r) => {
      setMsg({ ok: true, text: 'approvalId' in r ? t('adm.ledger.pending') : t('adm.ledger.done') });
      void qc.invalidateQueries({ queryKey: cck.list('ledger-account', id ?? '') });
    },
    onError: (e) => setMsg({ ok: false, text: adminErrorMessage(e, t, locale) }),
  });
  const a: AdminLedgerAccount | undefined = account.data;
  return (
    <>
      <SectionTitle>{t('adm.ledger.lookup')}</SectionTitle>
      <TextField label={t('adm.ledger.accountId')} value={raw} onChangeText={(v) => { setRaw(v); setMsg(null); }} autoCapitalize="none" autoCorrect={false} />
      {raw.trim() && !valid ? <Text variant="small" color={colors.danger}>{t('adm.ledger.invalidId')}</Text> : null}
      <Button variant="secondary" label={t('adm.ledger.find')} disabled={!valid} loading={account.isFetching} onPress={() => { setMsg(null); setId(raw.trim().toLowerCase()); }} />
      {id && account.isError ? <ErrorState error={account.error} onRetry={() => account.refetch()} /> : null}
      {a ? (
        <Card style={adminStyles.cardFlat}>
          <View style={adminStyles.badges}>
            <Badge tone={a.status === 'active' ? 'primary' : 'accent'} label={t(a.status === 'active' ? 'adm.ledger.state.active' : 'adm.ledger.state.frozen')} />
            <Badge tone="neutral" label={a.currency} />
          </View>
          <Text variant="small" selectable>{a.id}</Text>
          <Text variant="small" muted>{when(a.createdAt, locale)}</Text>
          <Text variant="small">{t('adm.ledger.balances', { cached: formatMoney(a.balanceMinor, a.currency, locale), ledger: formatMoney(a.ledgerBalanceMinor, a.currency, locale), currency: a.currency })}</Text>
          {msg ? <Text variant="small" color={msg.ok ? colors.success : colors.danger} accessibilityLiveRegion="polite">{msg.text}</Text> : null}
          {a.ownerKind !== 'system' ? (
            <Button
              variant={a.status === 'active' ? 'danger' : 'secondary'}
              label={t(a.status === 'active' ? 'adm.ledger.freeze' : 'adm.ledger.unfreeze')}
              loading={freeze.isPending}
              onPress={() =>
                alertConfirm(t(a.status === 'active' ? 'adm.ledger.freeze' : 'adm.ledger.unfreeze'), t(a.status === 'active' ? 'adm.ledger.freeze.confirm' : 'adm.ledger.unfreeze.confirm'), [
                  { text: t('adm.cancel'), style: 'cancel' },
                  { text: t(a.status === 'active' ? 'adm.ledger.freeze' : 'adm.ledger.unfreeze'), style: a.status === 'active' ? 'destructive' : 'default', onPress: () => freeze.mutate(a.status === 'active') },
                ])
              }
            />
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

/** Rapprochement du ledger (soldes en cache contre somme des écritures), puis consultation et gel d'un compte. Mode bac à sable, aucun argent réel. */
export default function Ledger() {
  const { t, locale } = useI18n();
  const allowed = useHasRole(['admin']);
  const q = useQuery({ queryKey: cck.list('ledger'), queryFn: fetchReconcile, enabled: allowed });
  if (!allowed || isDenied(q.error)) return <Denied />;
  const r = q.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('adm.ledger.title') }} />
      <Button variant="ghost" label={t('adm.ledger.refresh')} loading={q.isFetching} onPress={() => void q.refetch()} />
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : r ? (
        <>
          <Card style={adminStyles.cardFlat}>
            <View style={adminStyles.badges}>
              <Badge tone={r.ok ? 'primary' : 'accent'} label={t(r.ok ? 'adm.ledger.ok' : 'adm.ledger.ko')} />
            </View>
            <Text variant="small" muted>{t('adm.ledger.checked', { n: r.accountsChecked, date: when(r.checkedAt, locale) })}</Text>
            <Text variant="small" muted>{t('adm.ledger.mode', { mode: r.mode })}</Text>
          </Card>
          <SectionTitle>{t('adm.ledger.divergences')}</SectionTitle>
          {r.divergences.length === 0 ? <Text muted>{t('adm.ledger.none')}</Text> : r.divergences.map((d) => (
            <Card key={`${d.accountId}:${d.currency}`} style={adminStyles.cardFlat}>
              <Text variant="small" selectable>{t('adm.ledger.divergence', { id: d.accountId.slice(0, 8), cached: d.cachedMinor, ledger: d.ledgerMinor, currency: d.currency })}</Text>
            </Card>
          ))}
          <SectionTitle>{t('adm.ledger.totals')}</SectionTitle>
          {r.currencyTotals.map((c) => (
            <Text key={c.currency} variant="body">{c.currency} : {c.totalMinor}</Text>
          ))}
        </>
      ) : null}
      <AccountLookup />
    </Screen>
  );
}
