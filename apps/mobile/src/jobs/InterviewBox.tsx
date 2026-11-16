import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Badge, Button, Text, TextField } from '../ui';
import { cancelOrgInterview, fetchOrgInterviews, jobKeys, proposeInterview } from './api';
import { interviewStatusKey, parseLocalDateTime } from './logic';

/** Côté recruteur : entretien d'une candidature (proposer, annuler). Aucun lien visio. */
export function InterviewBox({ orgId, applicationId, canPropose }: { orgId: string; applicationId: string; canPropose: boolean }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const key = jobKeys.orgInterviews(orgId, applicationId);
  const query = useQuery({ queryKey: key, queryFn: () => fetchOrgInterviews(orgId, applicationId) });
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [minutes, setMinutes] = useState('45');
  const [place, setPlace] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => {
    const r = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
    setError(r === 'interview_exists' ? t('jobs.err.interviewExists') : r === 'invalid_state' || r === 'interview_past' ? t('jobs.err.interviewState') : errorMessage(e, t, locale));
    void qc.invalidateQueries({ queryKey: key });
  };
  const send = useMutation({
    mutationFn: () => {
      const startsAt = parseLocalDateTime(when);
      const durationMin = Number(minutes);
      if (!startsAt || !Number.isInteger(durationMin) || durationMin < 15 || durationMin > 180) throw new Error('invalid');
      return proposeInterview(orgId, applicationId, { startsAt, durationMin, location: place.trim() });
    },
    onSuccess: () => {
      setError(null);
      setOpen(false);
      setWhen('');
      setPlace('');
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => (e instanceof Error && e.message === 'invalid' ? setError(t('jobs.interview.invalid')) : onError(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelOrgInterview(orgId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError,
  });
  const items = query.data?.items ?? [];
  const live = items.find((i) => i.status === 'proposed' || i.status === 'confirmed');
  const last = live ?? items[0];

  return (
    <View style={styles.box}>
      {last ? (
        <View style={styles.row}>
          <Text variant="small" style={styles.flex}>
            {new Date(last.startsAt).toLocaleString(locale)} · {t('jobs.interview.duration', { min: last.durationMin })}
          </Text>
          <Badge tone="neutral" label={t(interviewStatusKey(last.status))} />
        </View>
      ) : null}
      {last?.status === 'declined' && last.reason ? (
        <Text variant="small" muted>
          {last.reason}
        </Text>
      ) : null}
      {live ? <Button variant="ghost" label={t('jobs.interview.cancel')} loading={cancel.isPending} onPress={() => cancel.mutate(live.id)} /> : null}
      {!live && canPropose && !open ? <Button variant="secondary" label={t('jobs.interview.propose')} onPress={() => setOpen(true)} /> : null}
      {open && !live ? (
        <>
          <TextField label={t('jobs.interview.when')} value={when} onChangeText={setWhen} placeholder="2026-12-01 14:30" autoCapitalize="none" />
          <TextField label={t('jobs.interview.minutes')} value={minutes} onChangeText={setMinutes} keyboardType="number-pad" />
          <TextField label={t('jobs.interview.place')} value={place} onChangeText={setPlace} maxLength={200} hint={t('jobs.interview.noVideo')} />
          <Button label={t('jobs.interview.send')} loading={send.isPending} onPress={() => send.mutate()} />
        </>
      ) : null}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs, marginTop: spacing.sm },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
});
