import type { HealthEntry, HealthEntryKind } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { createEntry, deleteEntry, fetchEntries, healthKeys } from '../../../health/api';
import { ENTRY_KINDS, isConsentRequired, isDate, kindKey, todayLocal } from '../../../health/logic';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text, TextField } from '../../../ui';

/** Mon dossier : allergies, maladies, traitements, vaccins, mesures, symptômes, notes. Privé et chiffré. */
export default function HealthRecord() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<HealthEntryKind | ''>('');
  const [kind, setKind] = useState<HealthEntryKind>('allergy');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [severity, setSeverity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: healthKeys.entries(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchEntries(filter, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const fail = (e: unknown) => {
    if (isConsentRequired(e)) return setError(t('health.consent.title'));
    setError(e instanceof ApiRequestError && e.status === 400 ? t('health.err.invalid') : errorMessage(e, t, locale));
  };
  const add = useMutation({
    mutationFn: () => {
      const sev = kind === 'symptom' && severity.trim() ? Number(severity) : null;
      if (!isDate(date) || (sev !== null && (!Number.isInteger(sev) || sev < 1 || sev > 5))) throw new Error('invalid');
      return createEntry({ kind, recordedOn: date, title: title.trim(), details: details.trim(), severity: sev });
    },
    onSuccess: () => {
      setError(null);
      setTitle('');
      setDetails('');
      setSeverity('');
      void qc.invalidateQueries({ queryKey: ['health', 'entries'] });
    },
    onError: (e) => (e instanceof Error && e.message === 'invalid' ? setError(t('health.err.invalid')) : fail(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteEntry(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['health', 'entries'] }), onError: fail });

  const form = (
    <View style={styles.form}>
      <Chips options={ENTRY_KINDS.map((k) => ({ value: k, label: t(kindKey(k)) }))} value={kind} onChange={setKind} />
      <TextField label={t('health.field.title')} value={title} onChangeText={setTitle} maxLength={120} />
      <TextField label={t('health.field.details')} value={details} onChangeText={setDetails} multiline maxLength={2000} />
      <TextField label={t('health.field.date')} value={date} onChangeText={setDate} autoCapitalize="none" maxLength={10} />
      {kind === 'symptom' ? <TextField label={t('health.field.severity')} value={severity} onChangeText={setSeverity} keyboardType="number-pad" maxLength={1} /> : null}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={t('health.addEntry')} loading={add.isPending} disabled={!title.trim()} onPress={() => add.mutate()} />
      <Chips options={[{ value: '' as const, label: t('health.all') }, ...ENTRY_KINDS.map((k) => ({ value: k, label: t(kindKey(k)) }))]} value={filter} onChange={(v) => setFilter(v === filter ? '' : v)} />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('health.record') }} />
      <PagedList
        query={query}
        keyExtractor={(e: HealthEntry) => e.id}
        header={form}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <View style={styles.row}>
              <Badge tone="neutral" label={t(kindKey(item.kind))} />
              <Text variant="small" muted>
                {item.recordedOn}
              </Text>
            </View>
            <Text variant="bodyStrong">{item.title}</Text>
            {item.details ? <Text variant="small">{item.details}</Text> : null}
            {item.severity !== null ? <Text variant="small">{t('health.severityOf', { n: item.severity })}</Text> : null}
            <Button variant="ghost" label={t('health.delete')} onPress={() => remove.mutate(item.id)} />
          </Card>
        )}
        empty={{ icon: 'medkit-outline', title: t('health.recordEmpty') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { padding: spacing.lg, gap: spacing.md },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
