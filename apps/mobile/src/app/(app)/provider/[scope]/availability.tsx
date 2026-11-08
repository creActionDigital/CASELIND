import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { uuidv4 } from '../../../../lib/uuid';
import { Card, Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { fetchOwnOffer, setAvailability, svcKeys } from '../../../../services/api';
import {
  hasAvailabilityErrors,
  toAvailabilityBody,
  validateAvailability,
  type ExceptionDraft,
  type RuleDraft,
} from '../../../../services/logic';
import { svcErrorMessage } from '../../../../services/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Text, TextField } from '../../../../ui';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Disponibilités d'une offre : semaine type (jours ISO) et exceptions datées ; l'enregistrement remplace tout. */
export default function Availability() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { scope, offerId } = useLocalSearchParams<{ scope: string; offerId: string }>();
  const offer = useQuery({ queryKey: svcKeys.ownOffer(scope, offerId), queryFn: () => fetchOwnOffer(scope, offerId) });
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionDraft[]>([]);
  const [day, setDay] = useState<number>(1);
  const [loaded, setLoaded] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!offer.data || loaded) return;
    setRules(offer.data.availability.rules.map((r) => ({ key: uuidv4(), weekday: r.weekday, start: r.start, end: r.end })));
    setExceptions(
      offer.data.availability.exceptions.map((x) => ({ key: uuidv4(), date: x.date, closed: x.closed, start: x.start ?? '09:00', end: x.end ?? '17:00' })),
    );
    setLoaded(true);
  }, [offer.data, loaded]);

  const save = useMutation({
    mutationFn: () => setAvailability(scope, offerId, toAvailabilityBody(rules, exceptions)),
    onMutate: () => {
      setError(null);
      setSaved(false);
    },
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: svcKeys.ownOffer(scope, offerId) });
      void qc.invalidateQueries({ queryKey: svcKeys.slots(offerId) });
    },
    onError: (e) => setError(svcErrorMessage(e, t, locale)),
  });

  const title = <Stack.Screen options={{ title: t('services.pro.avail.title') }} />;
  if (offer.isPending || !loaded) {
    if (offer.isError) return <>{title}<ErrorState error={offer.error} onRetry={() => offer.refetch()} /></>;
    return <>{title}<Loading /></>;
  }

  const errs = validateAvailability(rules, exceptions);
  const patchRule = (key: string, p: Partial<RuleDraft>) => setRules((c) => c.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const patchEx = (key: string, p: Partial<ExceptionDraft>) => setExceptions((c) => c.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const show = checked;

  function submit() {
    setChecked(true);
    if (!hasAvailabilityErrors(validateAvailability(rules, exceptions))) save.mutate();
  }

  return (
    <>
      {title}
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
        <SectionTitle>{t('services.pro.avail.weekly')}</SectionTitle>
        {rules.length === 0 ? <Text muted>{t('services.pro.avail.none')}</Text> : null}
        {WEEKDAYS.map((w) => {
          const list = rules.filter((r) => r.weekday === w);
          if (list.length === 0) return null;
          return (
            <Card key={w}>
              <Text variant="bodyStrong">{t(`services.weekday.${w}` as MessageKey)}</Text>
              {list.map((r) => (
                <View key={r.key}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <TextField label={t('services.pro.avail.start')} value={r.start} onChangeText={(v) => patchRule(r.key, { start: v })} maxLength={5} keyboardType="numbers-and-punctuation" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField label={t('services.pro.avail.end')} value={r.end} onChangeText={(v) => patchRule(r.key, { end: v })} maxLength={5} keyboardType="numbers-and-punctuation" />
                    </View>
                  </View>
                  {show && errs.rules[r.key] ? (
                    <Text variant="small" color={colors.danger}>
                      {t(errs.rules[r.key])}
                    </Text>
                  ) : null}
                  <Button variant="ghost" label={t('services.pro.avail.remove')} onPress={() => setRules((c) => c.filter((x) => x.key !== r.key))} />
                </View>
              ))}
            </Card>
          );
        })}
        <View style={{ marginHorizontal: -spacing.lg }}>
          <Chips options={WEEKDAYS.map((w) => ({ value: String(w), label: t(`services.weekday.${w}` as MessageKey) }))} value={String(day)} onChange={(v) => setDay(Number(v))} />
        </View>
        <Button
          variant="secondary"
          label={t('services.pro.avail.add')}
          onPress={() => setRules((c) => [...c, { key: uuidv4(), weekday: day, start: '08:00', end: '17:00' }])}
        />

        <SectionTitle>{t('services.pro.avail.exceptions')}</SectionTitle>
        {exceptions.map((x) => (
          <Card key={x.key}>
            <TextField label={t('services.pro.avail.date')} value={x.date} onChangeText={(v) => patchEx(x.key, { date: v })} maxLength={10} keyboardType="numbers-and-punctuation" />
            <View style={styles.switchRow}>
              <Text style={{ flex: 1 }}>{t('services.pro.avail.closed')}</Text>
              <Switch value={x.closed} onValueChange={(v) => patchEx(x.key, { closed: v })} accessibilityLabel={t('services.pro.avail.closed')} />
            </View>
            {!x.closed ? (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <TextField label={t('services.pro.avail.start')} value={x.start} onChangeText={(v) => patchEx(x.key, { start: v })} maxLength={5} keyboardType="numbers-and-punctuation" />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField label={t('services.pro.avail.end')} value={x.end} onChangeText={(v) => patchEx(x.key, { end: v })} maxLength={5} keyboardType="numbers-and-punctuation" />
                </View>
              </View>
            ) : null}
            {show && errs.exceptions[x.key] ? (
              <Text variant="small" color={colors.danger}>
                {t(errs.exceptions[x.key])}
              </Text>
            ) : null}
            <Button variant="ghost" label={t('services.pro.avail.remove')} onPress={() => setExceptions((c) => c.filter((e) => e.key !== x.key))} />
          </Card>
        ))}
        <Button
          variant="secondary"
          label={t('services.pro.avail.addException')}
          onPress={() => setExceptions((c) => [...c, { key: uuidv4(), date: '', closed: true, start: '09:00', end: '17:00' }])}
        />

        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {saved ? (
          <Text variant="small" color={colors.success} accessibilityLiveRegion="polite">
            {t('services.pro.avail.saved')}
          </Text>
        ) : null}
        <Button label={t('services.pro.avail.save')} loading={save.isPending} onPress={submit} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
});
