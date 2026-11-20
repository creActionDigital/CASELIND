import type { RentalBooking, RentalKind } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { alertConfirm } from '../../../../lib/confirm';
import { createOrgRental, extraKeys, fetchOrgRentalBookings, fetchOrgRentals, orgRentalStep, patchOrgRental } from '../../../../mobility/extra/api';
import { extraErrorMessage } from '../../../../mobility/extra/errors';
import { parsePriceMinor } from '../../../../mobility/extra/logic';
import { ErrorLine, formatDay } from '../../../../mobility/extra/ui';
import { useMembership } from '../../../../seller/api';
import { can } from '../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { formatMoney } from '../../../../shop/format';
import { spacing } from '../../../../theme/tokens';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

const KINDS: RentalKind[] = ['car', 'moto', 'van', 'bike'];
type Step = 'confirm' | 'decline' | 'pickup' | 'return' | 'cancel';

/** Étapes proposées à l’organisation selon l’état de la demande. */
const stepsFor = (s: RentalBooking['status']): Step[] =>
  s === 'requested' ? ['confirm', 'decline'] : s === 'confirmed' ? ['pickup', 'cancel'] : s === 'picked_up' ? ['return'] : [];

/** « Location de véhicules » (permission `catalog.manage`, tout type d’organisation) : véhicules et demandes. Aucun paiement en ligne. */
export default function OrgRentals() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const allowed = can(role, 'catalog.manage');
  const vehicles = useQuery({ queryKey: extraKeys.orgRentals(orgId), queryFn: () => fetchOrgRentals(orgId), enabled: !!orgId && allowed, retry: false });
  const bookings = useQuery({ queryKey: extraKeys.orgRentalBookings(orgId), queryFn: () => fetchOrgRentalBookings(orgId), enabled: !!orgId && allowed, retry: false });
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<RentalKind>('car');
  const [rate, setRate] = useState('');
  const [deposit, setDeposit] = useState('');
  const [city, setCity] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [description, setDescription] = useState('');
  const [info, setInfo] = useState<string | null>(null);

  const refresh = () => {
    setInfo(null);
    void qc.invalidateQueries({ queryKey: extraKeys.rentalAll });
  };
  const fail = (e: unknown) => setInfo(extraErrorMessage(e, t, locale));
  const add = useMutation({
    mutationFn: () => {
      const dailyRateMinor = parsePriceMinor(rate);
      const depositMinor = deposit.trim() ? parsePriceMinor(deposit) : undefined;
      const yearN = year.trim() ? Number(year) : undefined;
      if (!title.trim() || !city.trim() || !dailyRateMinor || depositMinor === null || (yearN !== undefined && !(yearN >= 1950 && yearN <= 2100))) throw new Error('invalid');
      return createOrgRental(orgId, {
        title: title.trim(),
        kind,
        dailyRateMinor,
        city: city.trim(),
        ...(depositMinor !== undefined ? { depositMinor } : {}),
        ...(make.trim() ? { make: make.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(yearN !== undefined ? { year: yearN } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
    },
    onSuccess: () => {
      setTitle('');
      setRate('');
      setDeposit('');
      setMake('');
      setModel('');
      setYear('');
      setDescription('');
      refresh();
    },
    onError: (e) => (e instanceof Error && e.message === 'invalid' ? setInfo(t('rentals.org.invalid')) : fail(e)),
  });
  const toggle = useMutation({ mutationFn: (a: { id: string; active: boolean }) => patchOrgRental(orgId, a.id, { active: a.active }), onSuccess: refresh, onError: fail });
  const step = useMutation({ mutationFn: (a: { id: string; step: Step }) => orgRentalStep(orgId, a.id, a.step), onSuccess: refresh, onError: fail });

  const head = <Stack.Screen options={{ title: t('rentals.org.title') }} />;
  if (isPending || (allowed && (vehicles.isPending || bookings.isPending))) return <>{head}<Loading /></>;
  if (isError) return <>{head}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!allowed) return <>{head}<Screen><Text muted>{t('rentals.org.forbidden')}</Text></Screen></>;
  if (vehicles.isError) return <>{head}<ErrorState error={vehicles.error} onRetry={() => vehicles.refetch()} /></>;
  if (bookings.isError) return <>{head}<ErrorState error={bookings.error} onRetry={() => bookings.refetch()} /></>;

  const run = (id: string, s: Step) => {
    if (s === 'decline' || s === 'cancel') {
      alertConfirm(t(`rentals.org.step.${s}.confirm` as MessageKey), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t(`rentals.org.step.${s}` as MessageKey), style: 'destructive', onPress: () => step.mutate({ id, step: s }) },
      ]);
    } else step.mutate({ id, step: s });
  };

  return (
    <Screen>
      {head}
      <Text variant="title" accessibilityRole="header">
        {t('rentals.org.title')}
      </Text>
      <Text muted>{t('rentals.org.intro')}</Text>
      <ErrorLine message={info} />

      <SectionTitle>{t('rentals.org.requests')}</SectionTitle>
      {bookings.data!.items.length === 0 ? <Text muted>{t('rentals.org.requests.empty')}</Text> : null}
      {bookings.data!.items.map((b) => (
        <Card key={b.id} style={{ gap: spacing.xs, marginTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {b.vehicleTitle}
            </Text>
            <Badge tone="accent" label={t(`rentals.status.${b.status}` as MessageKey)} />
          </View>
          <Text variant="small" muted>
            {b.renter ? `@${b.renter.handle} · ` : ''}
            {formatDay(b.startsOn, locale)} → {formatDay(b.endsOn, locale)}
          </Text>
          <Text variant="small">{t('rentals.total', { days: b.days, total: formatMoney(b.totalMinor, b.currency, locale) })}</Text>
          {b.note ? <Text variant="small">{b.note}</Text> : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {stepsFor(b.status).map((s) => (
              <Button key={s} variant={s === 'confirm' || s === 'pickup' || s === 'return' ? 'primary' : 'secondary'} label={t(`rentals.org.step.${s}` as MessageKey)} loading={step.isPending} onPress={() => run(b.id, s)} />
            ))}
          </View>
        </Card>
      ))}

      <SectionTitle>{t('rentals.org.vehicles')}</SectionTitle>
      {vehicles.data!.items.map((v) => (
        <Card key={v.id} style={{ gap: spacing.xs, marginTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {v.title}
            </Text>
            <Badge tone={v.active ? 'primary' : 'neutral'} label={t(v.active ? 'rentals.org.active' : 'rentals.org.inactive')} />
          </View>
          <Text variant="small" muted>
            {t(`rentals.kind.${v.kind}` as MessageKey)} · {v.city} · {t('rentals.perDay', { price: formatMoney(v.dailyRateMinor, v.currency, locale) })}
          </Text>
          <Button variant="secondary" label={t(v.active ? 'rentals.org.deactivate' : 'rentals.org.activate')} onPress={() => toggle.mutate({ id: v.id, active: !v.active })} />
        </Card>
      ))}

      <SectionTitle>{t('rentals.org.add')}</SectionTitle>
      <TextField label={t('rentals.org.fieldTitle')} value={title} onChangeText={setTitle} maxLength={80} />
      <Chips<RentalKind> options={KINDS.map((k) => ({ value: k, label: t(`rentals.kind.${k}` as MessageKey) }))} value={kind} onChange={setKind} />
      <TextField label={t('rentals.org.fieldRate')} value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="50,00" />
      <TextField label={t('rentals.org.fieldDeposit')} value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" />
      <TextField label={t('rentals.city')} value={city} onChangeText={setCity} maxLength={80} />
      <TextField label={t('rentals.org.fieldMake')} value={make} onChangeText={setMake} maxLength={40} />
      <TextField label={t('rentals.org.fieldModel')} value={model} onChangeText={setModel} maxLength={40} />
      <TextField label={t('rentals.org.fieldYear')} value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} />
      <TextField label={t('rentals.org.fieldDescription')} value={description} onChangeText={setDescription} maxLength={500} multiline />
      <Button label={t('rentals.org.addGo')} loading={add.isPending} onPress={() => add.mutate()} />
      <Text variant="small" muted>
        {t('rentals.org.photosLater')}
      </Text>
    </Screen>
  );
}
