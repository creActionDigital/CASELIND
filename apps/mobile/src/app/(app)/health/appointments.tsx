import type { Appointment } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { actOnAppointment, fetchMyAppointments, fetchPrescriptions, proKeys } from '../../../health/api';
import { appointmentActions, healthProErrorKey } from '../../../health/logic';
import { useConsentRedirect } from '../../../health/use-consent-redirect';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { Card, PagedList } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text } from '../../../ui';

/** Mes rendez-vous (patient) et mes ordonnances. Le motif écrit reste chiffré. */
export default function MyAppointments() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: proKeys.appointments,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchMyAppointments(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  useConsentRedirect(query.error);
  const rx = useQuery({ queryKey: proKeys.prescriptions, queryFn: fetchPrescriptions });
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'cancel' }) => actOnAppointment(v.id, v.action),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['health'] });
    },
    onError: (e) => setError(healthProErrorKey(e) ? t(healthProErrorKey(e)!) : errorMessage(e, t, locale)),
  });

  const header = (
    <View style={styles.header}>
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Text variant="heading" accessibilityRole="header">
        {t('health.prescriptions')}
      </Text>
      {rx.data?.items.length === 0 ? <Text muted>{t('health.rx.empty')}</Text> : null}
      {rx.data?.items.map((p) => (
        <View key={p.id} style={[styles.rx, { backgroundColor: colors.surface }]}>
          <Text variant="bodyStrong">{t('health.rx.code', { code: p.code })}</Text>
          <Text variant="small" muted>
            {t('health.rx.until', { date: p.validUntil })} · {p.professional.displayName}
          </Text>
          {p.items.map((i, k) => (
            <Text key={k}>
              {i.name} {i.dose} {i.instructions ? `— ${i.instructions}` : ''}
            </Text>
          ))}
        </View>
      ))}
      <Text variant="heading" accessibilityRole="header">
        {t('health.appointments')}
      </Text>
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('health.appointments') }} />
      <PagedList
        query={query}
        keyExtractor={(a: Appointment) => a.id}
        header={header}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text variant="bodyStrong">{t('health.appt.with', { name: item.other.displayName })}</Text>
            <Text variant="small" muted>
              {new Date(item.startsAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
            </Text>
            <View style={styles.badgeBox}>
              <Badge tone="neutral" label={t(`health.appt.${item.status}`)} />
            </View>
            {item.reason ? <Text variant="small">{item.reason}</Text> : null}
            {item.hasPrescription ? <Text variant="small">{t('health.appt.hasRx')}</Text> : null}
            {item.status === 'requested' || item.status === 'confirmed' ? (
              <Button variant="secondary" label={t('health.appt.share')} onPress={() => router.push({ pathname: '/health/sharing', params: { professionalId: item.other.id, name: item.other.displayName } })} />
            ) : null}
            {appointmentActions('patient', item.status).map((a) => (
              <Button key={a} variant="ghost" label={t('health.appt.cancel')} loading={act.isPending} onPress={() => act.mutate({ id: item.id, action: a as 'cancel' })} />
            ))}
          </Card>
        )}
        empty={{ icon: 'calendar-outline', title: t('health.appt.empty') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: spacing.lg, gap: spacing.sm },
  card: { gap: spacing.xs },
  badgeBox: { alignSelf: 'flex-start' },
  rx: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
