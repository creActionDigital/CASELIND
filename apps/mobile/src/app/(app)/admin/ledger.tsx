import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { cck, fetchReconcile } from '../../../admin/console-api';
import { Denied, adminStyles, isDenied, useHasRole, when } from '../../../admin/kit';
import { useI18n } from '../../../i18n';
import { Card, Loading, SectionTitle } from '../../../seller/ui';
import { Badge, Button, ErrorState, Screen, Text } from '../../../ui';

/** Rapprochement du ledger : lecture seule (soldes en cache contre somme des écritures). Mode bac à sable, aucun argent réel. */
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
    </Screen>
  );
}
