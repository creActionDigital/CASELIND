import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { fetchCustomers } from '../../../../seller/api';
import { formatMinor } from '../../../../seller/money';
import { Card, Loading } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { ErrorState, Text } from '../../../../ui';

/** Clients de la boutique (CRM léger) : dérivés des commandes, meilleurs clients d'abord. */
export default function Customers() {
  const { t, locale } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const q = useQuery({ queryKey: ['seller', orgId, 'customers'], queryFn: () => fetchCustomers(orgId) });
  return (
    <>
      <Stack.Screen options={{ title: t('customers.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data?.items.length === 0 ? <Text muted>{t('customers.empty')}</Text> : null}
        {q.data?.items.map((c) => (
          <Card key={c.handle + c.currency}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
              <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {c.displayName}
              </Text>
              <Text variant="bodyStrong">{formatMinor(c.spentMinor, c.currency, locale)}</Text>
            </View>
            <Text variant="small" muted>
              @{c.handle} · {t('customers.line', { n: c.orders, date: new Date(c.lastOrderAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) })}
            </Text>
          </Card>
        ))}
      </ScrollView>
    </>
  );
}
