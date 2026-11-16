import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { feeKeys, fetchMyFees } from '../../../school/fees-api';
import { formatMinor } from '../../../seller/money';
import { Card, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Badge, ErrorState, Text } from '../../../ui';

/** Frais scolaires des classes où la personne est inscrite : un relevé, aucun paiement n'est pris ici. */
export default function MyFees() {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: feeKeys.mine, queryFn: fetchMyFees });
  return (
    <>
      <Stack.Screen options={{ title: t('fees.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data?.items.length === 0 ? <Text muted>{t('fees.empty')}</Text> : null}
        {q.data?.items.map((f) => (
          <Card key={f.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {f.title}
              </Text>
              {f.paid === null ? null : <Badge tone="neutral" label={f.paid ? t('fees.status.paid') : t('fees.status.unpaid')} />}
            </View>
            <Text variant="small" muted>
              {f.schoolName} · {f.className}
            </Text>
            <Text variant="bodyStrong">{formatMinor(f.amountMinor, f.currency, locale)}</Text>
            {f.dueOn ? <Text variant="small">{t('fees.due', { date: f.dueOn })}</Text> : null}
          </Card>
        ))}
        <Text variant="small" muted>
          {t('fees.note')}
        </Text>
      </ScrollView>
    </>
  );
}
