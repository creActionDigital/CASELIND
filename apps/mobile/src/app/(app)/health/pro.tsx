import type { Appointment, ProfessionalKind } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { actOnAppointment, applyAsProfessional, fetchMyProfessional, fetchProAppointments, fetchSharedPatients, prescribe, proKeys } from '../../../health/api';
import { appointmentActions, healthProErrorKey, PRO_KINDS, proKindKey } from '../../../health/logic';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { Chips } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Espace professionnel : candidature à vérifier, puis rendez-vous reçus, ordonnances, dossiers partagés par les patients. */
export default function ProSpace() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const me = useQuery({ queryKey: proKeys.mine, queryFn: fetchMyProfessional });
  const approved = me.data?.profile?.status === 'approved';
  const appts = useQuery({ queryKey: proKeys.proAppointments, queryFn: () => fetchProAppointments(), enabled: approved });
  const patients = useQuery({ queryKey: proKeys.patients, queryFn: fetchSharedPatients, enabled: approved });

  const [kind, setKind] = useState<ProfessionalKind>('doctor');
  const [specialty, setSpecialty] = useState('');
  const [license, setLicense] = useState('');
  const [city, setCity] = useState('Goma');
  const [bio, setBio] = useState('');
  const [rx, setRx] = useState<{ id: string; name: string; dose: string; instructions: string; days: string } | null>(null);

  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['health'] });
  };
  const fail = (e: unknown) => {
    const key = healthProErrorKey(e);
    if (key) return setError(t(key));
    setError(e instanceof ApiRequestError && e.status === 400 ? t('health.err.invalid') : errorMessage(e, t, locale));
  };
  const apply = useMutation({ mutationFn: () => applyAsProfessional({ kind, specialty: specialty.trim(), licenseNumber: license.trim(), city: city.trim(), bio: bio.trim() }), onSuccess: refresh, onError: fail });
  const act = useMutation({ mutationFn: (v: { id: string; action: 'confirm' | 'decline' | 'cancel' | 'complete' }) => actOnAppointment(v.id, v.action), onSuccess: refresh, onError: fail });
  const issue = useMutation({
    mutationFn: () => {
      if (!rx) throw new Error('invalid');
      const days = Number(rx.days);
      if (!rx.name.trim() || !Number.isInteger(days) || days < 1 || days > 365) throw new Error('invalid');
      return prescribe(rx.id, { items: [{ name: rx.name.trim(), dose: rx.dose.trim(), instructions: rx.instructions.trim() }], validUntil: new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) });
    },
    onSuccess: () => {
      setRx(null);
      refresh();
    },
    onError: (e) => (e instanceof Error && e.message === 'invalid' ? setError(t('health.err.invalid')) : fail(e)),
  });

  if (me.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </Screen>
    );
  }
  const profile = me.data?.profile;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('health.proSpace') }} />
      <View style={styles.body}>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {profile ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={{ alignSelf: 'flex-start' }}>
              <Badge tone="neutral" label={t(`health.pro.status.${profile.status}`)} />
            </View>
            <Text variant="bodyStrong">
              {t(proKindKey(profile.kind))} · {profile.city}
            </Text>
            {profile.reviewNote ? <Text variant="small">{profile.reviewNote}</Text> : null}
          </View>
        ) : null}

        {!profile || profile.status === 'rejected' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('health.pro.apply')}
            </Text>
            <Text variant="small" muted>
              {t('health.pro.applyHint')}
            </Text>
            <Chips options={PRO_KINDS.map((k) => ({ value: k, label: t(proKindKey(k)) }))} value={kind} onChange={setKind} />
            <TextField label={t('health.pro.specialty')} value={specialty} onChangeText={setSpecialty} maxLength={80} />
            <TextField label={t('health.pro.license')} value={license} onChangeText={setLicense} autoCapitalize="characters" maxLength={60} />
            <TextField label={t('health.pro.city')} value={city} onChangeText={setCity} maxLength={80} />
            <TextField label={t('health.pro.bio')} value={bio} onChangeText={setBio} multiline maxLength={1000} />
            <Button label={t('health.pro.send')} loading={apply.isPending} disabled={license.trim().length < 3 || city.trim().length < 2} onPress={() => apply.mutate()} />
          </>
        ) : null}

        {approved ? (
          <>
            <Button variant="secondary" label={t('health.avail.open')} onPress={() => router.push('/health/availability')} />
            <Text variant="heading" accessibilityRole="header">
              {t('health.appointments')}
            </Text>
            {appts.data?.items.length === 0 ? <Text muted>{t('health.appt.empty')}</Text> : null}
            {appts.data?.items.map((a: Appointment) => (
              <View key={a.id} style={[styles.card, { backgroundColor: colors.surface }]}>
                <Text variant="bodyStrong">{a.other.displayName}</Text>
                <Text variant="small" muted>
                  {new Date(a.startsAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                </Text>
                <View style={{ alignSelf: 'flex-start' }}>
                  <Badge tone="neutral" label={t(`health.appt.${a.status}`)} />
                </View>
                {a.reason ? <Text variant="small">{a.reason}</Text> : null}
                {appointmentActions('professional', a.status).map((action) => (
                  <Button key={action} variant={action === 'decline' || action === 'cancel' ? 'ghost' : 'primary'} label={t(`health.appt.${action}`)} loading={act.isPending && act.variables?.id === a.id && act.variables.action === action} onPress={() => act.mutate({ id: a.id, action })} />
                ))}
                {a.status === 'completed' && !a.hasPrescription ? (
                  rx?.id === a.id ? (
                    <>
                      <TextField label={t('health.rx.name')} value={rx.name} onChangeText={(v) => setRx({ ...rx, name: v })} maxLength={120} />
                      <TextField label={t('health.rx.dose')} value={rx.dose} onChangeText={(v) => setRx({ ...rx, dose: v })} maxLength={120} />
                      <TextField label={t('health.rx.instructions')} value={rx.instructions} onChangeText={(v) => setRx({ ...rx, instructions: v })} maxLength={500} />
                      <TextField label={t('health.rx.days')} value={rx.days} onChangeText={(v) => setRx({ ...rx, days: v })} keyboardType="number-pad" maxLength={3} />
                      <Button label={t('health.rx.send')} loading={issue.isPending} onPress={() => issue.mutate()} />
                    </>
                  ) : (
                    <Button variant="secondary" label={t('health.rx.issue')} onPress={() => setRx({ id: a.id, name: '', dose: '', instructions: '', days: '30' })} />
                  )
                ) : null}
                {a.hasPrescription ? <Text variant="small">{t('health.appt.hasRx')}</Text> : null}
              </View>
            ))}

            <Text variant="heading" accessibilityRole="header">
              {t('health.pro.patients')}
            </Text>
            <Text variant="small" muted>
              {t('health.pro.readNote')}
            </Text>
            {patients.data?.items.length === 0 ? <Text muted>{t('health.pro.patientsEmpty')}</Text> : null}
            {patients.data?.items.map((p) => (
              <View key={p.shareId} style={[styles.card, { backgroundColor: colors.surface }]}>
                <Text variant="bodyStrong">{p.patient.displayName}</Text>
                <Button variant="secondary" label={t('health.pro.record')} onPress={() => router.push({ pathname: '/health/patient/[id]', params: { id: p.patient.id } })} />
              </View>
            ))}
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
