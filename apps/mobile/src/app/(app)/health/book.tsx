import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { availabilityKeys, bookAppointment, fetchSlots, proKeys } from '../../../health/api';
import { healthProErrorKey, isConsentRequired, localToIso, todayLocal } from '../../../health/logic';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { Chips } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../ui';

/** Demande de rendez-vous : date, heure locale, type, motif (chiffré, lu seulement par ce professionnel). */
export default function BookAppointment() {
  const { professionalId, name } = useLocalSearchParams<{ professionalId: string; name?: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayLocal());
  const [time, setTime] = useState('09:00');
  const [mode, setMode] = useState<'in_person' | 'teleconsultation'>('in_person');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const slots = useQuery({ queryKey: availabilityKeys.slots(String(professionalId)), queryFn: () => fetchSlots(String(professionalId)) });
  const scheduled = slots.data?.slotMinutes != null; // the professional published free slots: pick one, no free typing

  const send = useMutation({
    mutationFn: () => {
      const startsAt = scheduled ? slot : localToIso(date, time);
      if (!startsAt) throw new Error('invalid');
      return bookAppointment({ professionalId: String(professionalId), startsAt, mode, reason: reason.trim() });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: proKeys.appointments });
      router.replace('/health/appointments');
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: availabilityKeys.slots(String(professionalId)) });
      if (isConsentRequired(e)) return setError(t('health.consent.title'));
      const key = healthProErrorKey(e);
      if (key) return setError(t(key));
      setError((e instanceof Error && e.message === 'invalid') || (e instanceof ApiRequestError && e.status === 400) ? t('health.err.invalid') : errorMessage(e, t, locale));
    },
  });

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('health.book') }} />
      <View style={styles.form}>
        <Text variant="heading">{name}</Text>
        {scheduled ? (
          <>
            <Text variant="bodyStrong">{t('health.slots.title')}</Text>
            {slots.data?.items.length === 0 ? <Text muted>{t('health.slots.none')}</Text> : null}
            <Chips
              options={(slots.data?.items ?? []).slice(0, 60).map((s) => ({ value: s.startsAt, label: new Date(s.startsAt).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }))}
              value={slot}
              onChange={setSlot}
              scroll={false}
            />
          </>
        ) : (
          <>
            <TextField label={t('health.book.date')} value={date} onChangeText={setDate} autoCapitalize="none" maxLength={10} />
            <TextField label={t('health.book.time')} value={time} onChangeText={setTime} autoCapitalize="none" maxLength={5} />
          </>
        )}
        <Chips
          options={[
            { value: 'in_person' as const, label: t('health.book.inPerson') },
            { value: 'teleconsultation' as const, label: t('health.book.tele') },
          ]}
          value={mode}
          onChange={setMode}
          scroll={false}
        />
        <TextField label={t('health.book.reason')} value={reason} onChangeText={setReason} multiline maxLength={1000} />
        <Text variant="small" muted>
          {t('health.limits')}
        </Text>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('health.book.send')} loading={send.isPending} disabled={scheduled && !slot} onPress={() => send.mutate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: spacing.md } });
