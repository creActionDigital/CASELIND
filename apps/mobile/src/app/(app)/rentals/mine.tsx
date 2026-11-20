import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { cancelRental, extraKeys, fetchMyRentals } from '../../../mobility/extra/api';
import { extraErrorMessage } from '../../../mobility/extra/errors';
import { ErrorLine, formatDay } from '../../../mobility/extra/ui';
import { Card, Loading } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';

/** Mes locations : historique et annulation tant que le véhicule n’a pas été remis. */
export default function MyRentals() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: extraKeys.rentalMine, queryFn: fetchMyRentals, retry: false });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelRental(id),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: extraKeys.rentalAll });
    },
    onError: (e) => setError(extraErrorMessage(e, t, locale)),
  });
  return (
    <Screen>
      <Stack.Screen options={{ title: t('rentals.mine.title') }} />
      <Text variant="title" accessibilityRole="header">
        {t('rentals.mine.title')}
      </Text>
      <ErrorLine message={error} />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon="car-sport-outline" title={t('rentals.mine.empty')} />
      ) : (
        q.data.items.map((b) => (
          <Card key={b.id} style={{ gap: spacing.xs, marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {b.vehicleTitle}
              </Text>
              <Badge tone="accent" label={t(`rentals.status.${b.status}` as MessageKey)} />
            </View>
            <Text variant="small" muted>
              {b.orgName} · {formatDay(b.startsOn, locale)} → {formatDay(b.endsOn, locale)}
            </Text>
            <Text variant="small">{t('rentals.total', { days: b.days, total: formatMoney(b.totalMinor, b.currency, locale) })}</Text>
            {b.depositMinor !== null ? <Text variant="small" muted>{t('rentals.depositAmount', { amount: formatMoney(b.depositMinor, b.currency, locale) })}</Text> : null}
            <Text variant="caption" muted>
              {t('rentals.cash')}
            </Text>
            {b.status === 'requested' || b.status === 'confirmed' ? (
              <Button
                variant="danger"
                label={t('rentals.cancel')}
                loading={cancel.isPending}
                onPress={() =>
                  alertConfirm(t('rentals.cancel.confirm'), undefined, [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('rentals.cancel'), style: 'destructive', onPress: () => cancel.mutate(b.id) },
                  ])
                }
              />
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
