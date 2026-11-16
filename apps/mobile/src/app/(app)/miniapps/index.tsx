import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { confirmPayment, declinePayment, fetchDirectory, fetchGrants, fetchPaymentRequests, maKeys, revokeGrant } from '../../../miniapps/api';
import { Card, Chips, Loading } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

type Tab = 'directory' | 'mine' | 'payments';

/** Annuaire des mini-apps, apps autorisées (révocation) et demandes de paiement (confirmation par PIN). */
export default function MiniApps() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('directory');
  return (
    <Screen>
      <Stack.Screen options={{ title: t('miniapps.title') }} />
      <Chips<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'directory', label: t('miniapps.title') },
          { value: 'mine', label: t('miniapps.mine') },
          { value: 'payments', label: t('miniapps.payments') },
        ]}
      />
      <View style={{ gap: spacing.md, marginTop: spacing.md }}>
        {tab === 'directory' ? <Directory /> : tab === 'mine' ? <Mine /> : <Payments />}
      </View>
    </Screen>
  );
}

const scopeKey = (s: string) => `miniapps.scope.${s}` as MessageKey;

function Directory() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const list = useInfiniteQuery({
    queryKey: maKeys.directory(q),
    queryFn: ({ pageParam }) => fetchDirectory(q.trim(), pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <TextField label={t('miniapps.search')} value={q} onChangeText={setQ} autoCapitalize="none" />
      {list.isPending ? <Loading /> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.data && items.length === 0 ? <Text muted>{t('miniapps.empty')}</Text> : null}
      {items.map((a) => (
        <Card key={a.id}>
          <Text variant="bodyStrong">{a.name}</Text>
          <Text variant="small" muted>{t('miniapps.by', { name: a.organization.name })}</Text>
          {a.organization.verified ? <Badge tone="accent" label={t('miniapps.verified')} /> : null}
          {a.description ? <Text>{a.description}</Text> : null}
          <Text variant="small" style={{ fontWeight: '600' }}>{t('miniapps.scopes')}</Text>
          {a.scopes.map((s) => <Text key={s} variant="small">• {t(scopeKey(s))}</Text>)}
          <Text variant="caption" muted>{t('miniapps.openHint')}</Text>
          <Button variant="secondary" label={t('miniapps.open')} onPress={() => void Linking.openURL(a.launchUrl)} />
        </Card>
      ))}
      {list.hasNextPage ? <Button variant="ghost" label={t('miniapps.more')} loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} /> : null}
    </>
  );
}

function Mine() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const q = useQuery({ queryKey: maKeys.grants, queryFn: fetchGrants });
  const revoke = useMutation({
    mutationFn: revokeGrant,
    onSuccess: () => {
      setConfirming(null);
      void qc.invalidateQueries({ queryKey: maKeys.grants });
      void qc.invalidateQueries({ queryKey: maKeys.payments });
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data.items.length === 0) return <Text muted>{t('miniapps.mine.empty')}</Text>;
  return (
    <>
      {q.data.items.map((g) => (
        <Card key={g.appId}>
          <Text variant="bodyStrong">{g.name}</Text>
          <Text variant="small" muted>{t('miniapps.by', { name: g.organizationName })}</Text>
          {g.scopes.map((s) => <Text key={s} variant="small">• {t(scopeKey(s))}</Text>)}
          <Text variant="caption" muted>{t('miniapps.mine.since', { date: new Date(g.grantedAt).toLocaleDateString(locale) })}</Text>
          {confirming === g.appId ? (
            <>
              <Text variant="small">{t('miniapps.revoke.confirm', { name: g.name })}</Text>
              <Button variant="danger" label={t('miniapps.revoke')} loading={revoke.isPending} onPress={() => revoke.mutate(g.appId)} />
              <Button variant="ghost" label={t('miniapps.pay.cancel')} onPress={() => setConfirming(null)} />
              {revoke.isError ? <ErrorState error={revoke.error} /> : null}
            </>
          ) : (
            <Button variant="secondary" label={t('miniapps.revoke')} onPress={() => setConfirming(g.appId)} />
          )}
        </Card>
      ))}
    </>
  );
}

function Payments() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [paying, setPaying] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: maKeys.payments, queryFn: fetchPaymentRequests });
  const done = () => {
    setPaying(null);
    setPin('');
    setErr(null);
    void qc.invalidateQueries({ queryKey: maKeys.payments });
  };
  const pay = useMutation({
    mutationFn: (id: string) => confirmPayment(id, pin),
    onSuccess: done,
    onError: (e) => {
      const reason = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      if (reason === 'request_closed') return done();
      setErr(t(reason === 'pin_locked' ? 'miniapps.err.locked' : 'miniapps.err.pin'));
    },
  });
  const decline = useMutation({ mutationFn: declinePayment, onSuccess: done });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const pending = q.data.items.filter((r) => r.status === 'pending');
  if (pending.length === 0) return <Text muted>{t('miniapps.pay.empty')}</Text>;
  return (
    <>
      {pending.map((r) => (
        <Card key={r.id}>
          <Text variant="bodyStrong">{formatMoney(r.amountMinor, r.currency, locale)}</Text>
          <Text variant="small" muted>{t('miniapps.pay.from', { name: r.appName })}</Text>
          {r.description ? <Text>{r.description}</Text> : null}
          <Text variant="caption" muted>{t('miniapps.pay.expires', { time: new Date(r.expiresAt).toLocaleTimeString(locale) })}</Text>
          {paying === r.id ? (
            <>
              <TextField label={t('miniapps.pay.pin')} value={pin} onChangeText={setPin} keyboardType="number-pad" maxLength={16} secure error={err} />
              <Text variant="caption" muted>{t('miniapps.pay.sandbox')}</Text>
              <Button label={t('miniapps.pay.confirm')} disabled={pin.length === 0} loading={pay.isPending} onPress={() => pay.mutate(r.id)} />
              <Button variant="ghost" label={t('miniapps.pay.cancel')} onPress={done} />
            </>
          ) : (
            <>
              <Button label={t('miniapps.pay.pay')} onPress={() => setPaying(r.id)} />
              <Button variant="ghost" label={t('miniapps.pay.decline')} loading={decline.isPending} onPress={() => decline.mutate(r.id)} />
            </>
          )}
        </Card>
      ))}
    </>
  );
}
