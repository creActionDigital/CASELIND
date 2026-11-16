import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { availabilityKeys, fetchAgenda, fetchAvailability, saveAvailability } from '../../../health/api';
import { deviceUtcOffsetMinutes, parseDayWindows } from '../../../health/logic';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { Chips } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const SLOTS = [15, 20, 30, 45, 60] as const;
type SlotMinutes = (typeof SLOTS)[number];

/** Espace professionnel vérifié : disponibilités hebdomadaires (plages par jour, durée de créneau) et agenda à venir. */
export default function Availability() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const av = useQuery({ queryKey: availabilityKeys.mine, queryFn: fetchAvailability });
  const agenda = useQuery({ queryKey: availabilityKeys.agenda, queryFn: fetchAgenda });
  const [lines, setLines] = useState<Record<number, string>>({});
  const [slot, setSlot] = useState<SlotMinutes>(30);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const a = av.data?.availability;
    if (!a) return;
    setSlot(a.slotMinutes);
    setLines(Object.fromEntries(DAYS.map((d) => [d, a.windows.filter((w) => w.day === d).map((w) => `${w.start}-${w.end}`).join(', ')])));
  }, [av.data]);

  const save = useMutation({
    mutationFn: () => {
      const windows = DAYS.flatMap((d) => {
        const w = parseDayWindows(d, lines[d] ?? '');
        if (!w) throw new Error('windows');
        return w;
      });
      return saveAvailability({ slotMinutes: slot, utcOffsetMinutes: deviceUtcOffsetMinutes(), windows });
    },
    onSuccess: () => {
      setMsg({ text: t('health.avail.saved'), ok: true });
      void qc.invalidateQueries({ queryKey: availabilityKeys.mine });
    },
    onError: (e) => setMsg({ text: e instanceof Error && e.message === 'windows' ? t('health.err.windows') : e instanceof ApiRequestError && e.status === 400 ? t('health.err.windows') : errorMessage(e, t, locale), ok: false }),
  });

  if (av.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={av.error} onRetry={() => av.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('health.avail.title') }} />
      <View style={styles.body}>
        <Text variant="heading" accessibilityRole="header">
          {t('health.agenda.title')}
        </Text>
        {agenda.data?.items.length === 0 ? <Text muted>{t('health.agenda.empty')}</Text> : null}
        {agenda.data?.items.map((a) => (
          <View key={a.id} style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="bodyStrong">{new Date(a.startsAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</Text>
            <Text variant="small">
              {a.other.displayName} · {t(`health.appt.${a.status}`)}
            </Text>
          </View>
        ))}

        <Text variant="heading" accessibilityRole="header">
          {t('health.avail.title')}
        </Text>
        <Text variant="small" muted>
          {t('health.avail.hint')}
        </Text>
        <Text variant="bodyStrong">{t('health.avail.slot')}</Text>
        <Chips options={SLOTS.map((m) => ({ value: String(m), label: t('health.avail.min', { n: m }) }))} value={String(slot)} onChange={(v) => setSlot(Number(v) as SlotMinutes)} scroll={false} />
        {DAYS.map((d) => (
          <TextField key={d} label={t(`health.avail.day.${d}`)} value={lines[d] ?? ''} onChangeText={(v) => setLines({ ...lines, [d]: v })} autoCapitalize="none" placeholder="08:00-12:00, 14:00-17:00" maxLength={80} />
        ))}
        {msg ? (
          <Text variant="small" color={msg.ok ? colors.text : colors.danger} accessibilityLiveRegion="polite">
            {msg.text}
          </Text>
        ) : null}
        <Button label={t('health.avail.save')} loading={save.isPending} onPress={() => save.mutate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
