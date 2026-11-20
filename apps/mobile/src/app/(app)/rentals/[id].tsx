import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { bookRental, extraKeys, fetchRental } from '../../../mobility/extra/api';
import { extraErrorMessage } from '../../../mobility/extra/errors';
import { checkRentalPeriod, rentalDays, rentalTotal, todayUtc } from '../../../mobility/extra/logic';
import { ErrorLine, formatDay } from '../../../mobility/extra/ui';
import { Row } from '../../../mobility/ui';
import { Card, Loading, SectionTitle } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { AuthImage, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Détail d’un véhicule : fiche, périodes déjà prises, demande de location. Total calculé par le serveur ; réglé sur place. */
export default function RentalDetail() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; from?: string; to?: string }>();
  const [from, setFrom] = useState(params.from ?? '');
  const [to, setTo] = useState(params.to ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const check = from && to ? checkRentalPeriod(from.trim(), to.trim(), todayUtc()) : null;
  const periodOk = check === 'ok';
  const q = useQuery({
    queryKey: extraKeys.rentalVehicle(params.id, periodOk ? `${from}|${to}` : ''),
    queryFn: () => fetchRental(params.id, periodOk ? from.trim() : undefined, periodOk ? to.trim() : undefined),
    enabled: !!params.id,
    retry: false,
    placeholderData: (prev) => prev,
  });

  const book = useMutation({
    mutationFn: () => bookRental(params.id, { startsOn: from.trim(), endsOn: to.trim(), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      setSent(true);
      void qc.invalidateQueries({ queryKey: extraKeys.rentalAll });
    },
    onError: (e) => setError(extraErrorMessage(e, t, locale)),
  });

  const title = <Stack.Screen options={{ title: q.data?.title ?? t('rentals.title') }} />;
  if (q.isPending) return <>{title}<Loading /></>;
  if (q.isError) return <>{title}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;
  const v = q.data;
  const spec = [v.make, v.model, v.year ? String(v.year) : null, v.seats ? t('rentals.seats', { n: v.seats }) : null, v.transmission ? t(`rentals.transmission.${v.transmission}` as MessageKey) : null, v.fuel ? t(`rentals.fuel.${v.fuel}` as MessageKey) : null].filter(Boolean).join(' · ');
  const days = periodOk ? rentalDays(from.trim(), to.trim()) : null;
  // Le serveur renvoie le total pour la période ; avant son retour, une estimation locale pour l’affichage.
  const total = periodOk && days !== null ? (v.totalMinor ?? rentalTotal(days, v.dailyRateMinor)) : null;

  return (
    <Screen>
      {title}
      {v.photoUrls.slice(0, 4).map((u) => (
        <AuthImage key={u} contentUrl={u} label={v.title} style={{ height: 180, borderRadius: 12 }} />
      ))}
      <Text variant="title" accessibilityRole="header">
        {v.title}
      </Text>
      <Text muted>
        {t(`rentals.kind.${v.kind}` as MessageKey)} · {v.city} · {v.org.name}
      </Text>
      {spec ? <Text>{spec}</Text> : null}
      {v.description ? <Text>{v.description}</Text> : null}
      <Card style={{ gap: spacing.xs }}>
        <Row label={t('rentals.daily')} value={formatMoney(v.dailyRateMinor, v.currency, locale)} />
        {v.depositMinor !== null ? <Row label={t('rentals.deposit')} value={formatMoney(v.depositMinor, v.currency, locale)} /> : null}
      </Card>
      <Text variant="small" muted>
        {t('rentals.cash')}
      </Text>
      {v.busy.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <SectionTitle>{t('rentals.busy')}</SectionTitle>
          {v.busy.map((b) => (
            <Text key={`${b.from}${b.to}`} variant="small">
              {formatDay(b.from, locale)} → {formatDay(b.to, locale)}
            </Text>
          ))}
        </View>
      ) : null}

      <SectionTitle>{t('rentals.book.title')}</SectionTitle>
      {sent ? (
        <View style={{ gap: spacing.sm }}>
          <Text accessibilityLiveRegion="polite">{t('rentals.book.sent')}</Text>
          <Button label={t('rentals.link.mine')} onPress={() => router.replace('/rentals/mine' as never)} />
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField label={t('rentals.from')} value={from} onChangeText={setFrom} maxLength={10} placeholder="2026-12-24" keyboardType="numbers-and-punctuation" autoCorrect={false} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label={t('rentals.to')} value={to} onChangeText={setTo} maxLength={10} placeholder="2026-12-27" keyboardType="numbers-and-punctuation" autoCorrect={false} />
            </View>
          </View>
          {check && check !== 'ok' ? <ErrorLine message={t(`rentals.period.${check}` as MessageKey)} /> : null}
          {total !== null && days !== null ? <Text variant="bodyStrong">{t('rentals.total', { days, total: formatMoney(total, v.currency, locale) })}</Text> : null}
          <TextField label={t('rentals.note')} value={note} onChangeText={setNote} maxLength={200} multiline />
          <ErrorLine message={error} />
          <Button
            label={t('rentals.book.go')}
            disabled={!periodOk}
            loading={book.isPending}
            onPress={() => {
              setError(null);
              book.mutate();
            }}
          />
        </View>
      )}
    </Screen>
  );
}
