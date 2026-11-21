import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { fetchPayments } from '../../../premium/api';
import { planNameKey } from '../../../premium/logic';
import { Card, PagedList } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { useTheme } from '../../../theme/use-theme';
import { Text } from '../../../ui';

/** Historique des paiements d'abonnement, avec le numéro de reçu de chacun (paiements de test). */
export default function PaymentHistory() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const query = useInfiniteQuery({
    queryKey: ['subscription-payments'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPayments(pageParam),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('mon.history') }} />
      <PagedList
        query={query}
        keyExtractor={(p) => p.id}
        empty={{ icon: 'receipt-outline', title: t('mon.history.empty'), body: t('mon.history.emptyBody') }}
        renderItem={({ item: p }) => (
          <Card
            style={{ gap: 4 }}
          >
            <Text style={{ fontWeight: '700' }}>
              {t(planNameKey(p.planCode))} · {t(`mon.history.kind.${p.kind}` as MessageKey)}
            </Text>
            <Text>{formatMoney(p.amountMinor, p.currency, locale)}</Text>
            <Text variant="small" muted>
              {new Date(p.createdAt).toLocaleString(locale)} · {t('mon.history.receipt', { no: p.receiptNo })}
            </Text>
            <Text variant="small" muted>
              {t(p.payer === 'org' ? 'mon.history.payer.org' : 'mon.history.payer.user')}
            </Text>
          </Card>
        )}
      />
    </View>
  );
}
