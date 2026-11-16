import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { dk, fetchDocuments } from '../../../../../seller/api';
import { formatMinor } from '../../../../../seller/money';
import { can } from '../../../../../seller/permissions';
import { useMembership } from '../../../../../seller/api';
import { Card, Chips, Loading } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { Badge, Button, ErrorState, Text } from '../../../../../ui';

type Filter = 'all' | 'quote' | 'invoice';

/** Devis et factures de l'organisation : liste filtrable, création, détail. */
export default function Documents() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role } = useMembership(orgId);
  const [filter, setFilter] = useState<Filter>('all');
  const q = useQuery({ queryKey: dk.list(orgId, filter), queryFn: () => fetchDocuments(orgId, filter === 'all' ? undefined : filter) });
  return (
    <>
      <Stack.Screen options={{ title: t('docs.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {can(role, 'orders.manage') ? <Button label={t('docs.new')} onPress={() => router.push(`/seller/${orgId}/documents/new` as never)} /> : null}
        <Chips
          scroll={false}
          options={(['all', 'quote', 'invoice'] as Filter[]).map((f) => ({ value: f, label: t(`docs.kind.${f}` as const) }))}
          value={filter}
          onChange={setFilter}
        />
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data?.items.length === 0 ? <Text muted>{t('docs.empty')}</Text> : null}
        {q.data?.items.map((d) => (
          <Card key={d.id} label={`${d.number} ${d.customerName}`} onPress={() => router.push(`/seller/${orgId}/documents/${d.id}` as never)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyStrong">{d.number}</Text>
              <Badge tone="neutral" label={t(`docs.status.${d.status}` as const)} />
            </View>
            <Text numberOfLines={1}>{d.customerName}</Text>
            <Text variant="bodyStrong">{formatMinor(d.totalMinor, d.currency, locale)}</Text>
          </Card>
        ))}
        <Text variant="small" muted>
          {t('docs.note')}
        </Text>
      </ScrollView>
    </>
  );
}
