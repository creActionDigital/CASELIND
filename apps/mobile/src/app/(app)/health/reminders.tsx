import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createReminder, deleteReminder, fetchReminders, healthKeys, setReminderActive } from '../../../health/api';
import { deviceUtcOffsetMinutes, isConsentRequired, isDate, parseTimes, todayLocal } from '../../../health/logic';
import { useConsentRedirect } from '../../../health/use-consent-redirect';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Rappels de prise : heures du jour sur l'horloge de l'appareil. La notification ne nomme jamais le médicament. */
export default function HealthReminders() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [dose, setDose] = useState('');
  const [times, setTimes] = useState('08:00, 20:00');
  const [start, setStart] = useState(todayLocal());
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: healthKeys.reminders, queryFn: fetchReminders });
  useConsentRedirect(q.error);

  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: healthKeys.all });
  };
  const fail = (e: unknown) => {
    if (isConsentRequired(e)) return setError(t('health.consent.title'));
    setError(e instanceof ApiRequestError && e.status === 400 ? t('health.err.invalid') : errorMessage(e, t, locale));
  };
  const add = useMutation({
    mutationFn: () => {
      const parsed = parseTimes(times);
      if (!parsed || !isDate(start) || (end.trim() && !isDate(end))) throw new Error('invalid');
      return createReminder({ title: title.trim(), dose: dose.trim(), times: parsed, utcOffsetMinutes: deviceUtcOffsetMinutes(), startsOn: start, endsOn: end.trim() || null });
    },
    onSuccess: () => {
      setTitle('');
      setDose('');
      refresh();
    },
    onError: (e) => (e instanceof Error && e.message === 'invalid' ? setError(t('health.err.invalid')) : fail(e)),
  });
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => setReminderActive(v.id, v.active), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => deleteReminder(id), onSuccess: refresh, onError: fail });

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: t('health.reminders') }} />
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (q.isError) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: t('health.reminders') }} />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('health.reminders') }} />
      <View style={styles.body}>
        <Text variant="heading" accessibilityRole="header">
          {t('health.addReminder')}
        </Text>
        <TextField label={t('health.reminder.title')} value={title} onChangeText={setTitle} maxLength={120} />
        <TextField label={t('health.reminder.dose')} value={dose} onChangeText={setDose} maxLength={120} />
        <TextField label={t('health.reminder.times')} value={times} onChangeText={setTimes} autoCapitalize="none" />
        <TextField label={t('health.reminder.start')} value={start} onChangeText={setStart} autoCapitalize="none" maxLength={10} />
        <TextField label={t('health.reminder.end')} value={end} onChangeText={setEnd} autoCapitalize="none" maxLength={10} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('health.save')} loading={add.isPending} disabled={!title.trim()} onPress={() => add.mutate()} />

        {q.data.items.length === 0 ? <Text muted>{t('health.remindersEmpty')}</Text> : null}
        {q.data.items.map((r) => (
          <View key={r.id} style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="bodyStrong">
              {r.title} {r.dose}
            </Text>
            <Text variant="small" muted>
              {t('health.reminder.timesOf', { times: r.times.join(', ') })}
            </Text>
            {!r.active ? <Badge tone="neutral" label={t('health.reminder.paused')} /> : null}
            <Button variant="secondary" label={t(r.active ? 'health.reminder.pause' : 'health.reminder.resume')} onPress={() => toggle.mutate({ id: r.id, active: !r.active })} />
            <Button variant="ghost" label={t('health.delete')} onPress={() => remove.mutate(r.id)} />
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
