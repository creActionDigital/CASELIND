import type { RentalKind } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { extraKeys, searchRentals } from '../../../mobility/extra/api';
import { extraErrorMessage } from '../../../mobility/extra/errors';
import { checkRentalPeriod, todayUtc } from '../../../mobility/extra/logic';
import { Card, Chips } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, EmptyState, Screen, Text, TextField } from '../../../ui';

type KindFilter = RentalKind | 'all';
const KINDS: KindFilter[] = ['all', 'car', 'moto', 'van', 'bike'];

/** Location de véhicules proposés par des organisations : ville, type et période libre. Caution et total à régler sur place. */
export default function RentalsHome() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [city, setCity] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Record<string, string | number | undefined>>({});

  const results = useInfiniteQuery({
    queryKey: extraKeys.rentalSearch(JSON.stringify(submitted)),
    queryFn: ({ pageParam }) => searchRentals({ ...submitted, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });

  function search() {
    setPeriodError(null);
    const hasPeriod = from.trim() !== '' || to.trim() !== '';
    if (hasPeriod) {
      const check = checkRentalPeriod(from.trim(), to.trim(), todayUtc());
      if (check !== 'ok') return setPeriodError(t(`rentals.period.${check}` as MessageKey));
    }
    setSubmitted({ city: city.trim() || undefined, kind: kind === 'all' ? undefined : kind, from: hasPeriod ? from.trim() : undefined, to: hasPeriod ? to.trim() : undefined });
  }

  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ title: t('rentals.title') }} />
      <Text variant="title" accessibilityRole="header">
        {t('rentals.title')}
      </Text>
      <Text muted>{t('rentals.intro')}</Text>
      <TextField label={t('rentals.city')} value={city} onChangeText={setCity} maxLength={80} />
      <Chips<KindFilter> options={KINDS.map((k) => ({ value: k, label: t(`rentals.kind.${k}` as MessageKey) }))} value={kind} onChange={setKind} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField label={t('rentals.from')} value={from} onChangeText={setFrom} maxLength={10} placeholder="2026-12-24" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label={t('rentals.to')} value={to} onChangeText={setTo} maxLength={10} placeholder="2026-12-27" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        </View>
      </View>
      {periodError ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {periodError}
        </Text>
      ) : null}
      <Button label={t('rentals.search')} loading={results.isFetching && items.length === 0} onPress={search} />

      {results.isError ? (
        <Text color={colors.danger} accessibilityLiveRegion="polite">
          {extraErrorMessage(results.error, t, locale)}
        </Text>
      ) : null}
      {results.isSuccess && items.length === 0 ? <EmptyState icon="car-sport-outline" title={t('rentals.empty')} body={t('rentals.empty.body')} /> : null}
      {items.map((v) => (
        <Card
          key={v.id}
          label={v.title}
          onPress={() => router.push({ pathname: `/rentals/${v.id}`, params: submitted.from ? { from: String(submitted.from), to: String(submitted.to) } : {} } as never)}
          style={{ gap: spacing.xs, marginTop: spacing.sm }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {v.title}
            </Text>
            <Badge tone="accent" label={t('rentals.perDay', { price: formatMoney(v.dailyRateMinor, v.currency, locale) })} />
          </View>
          <Text variant="small" muted>
            {t(`rentals.kind.${v.kind}` as MessageKey)} · {v.city} · {v.org.name}
          </Text>
          {v.totalMinor !== null && v.days !== null ? (
            <Text variant="small">{t('rentals.total', { days: v.days, total: formatMoney(v.totalMinor, v.currency, locale) })}</Text>
          ) : null}
        </Card>
      ))}
      {results.hasNextPage ? <Button variant="secondary" label={t('extra.more')} loading={results.isFetchingNextPage} onPress={() => void results.fetchNextPage()} /> : null}
      <Button variant="secondary" label={t('rentals.link.mine')} onPress={() => router.push('/rentals/mine' as never)} />
    </Screen>
  );
}
