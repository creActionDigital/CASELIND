import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { deleteJobProfile, fetchMyJobProfile, jobKeys, saveJobProfile } from '../../../jobs/api';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Mon CV : jamais public, copié seulement dans les candidatures envoyées. */
export default function JobCv() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: jobKeys.profile, queryFn: fetchMyJobProfile });
  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [skills, setSkills] = useState('');
  const [city, setCity] = useState('');
  const [experience, setExperience] = useState('');
  const [education, setEducation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const p = q.data?.profile;
    if (!p) return;
    setHeadline(p.headline);
    setSummary(p.summary);
    setSkills(p.skills.join(', '));
    setCity(p.city);
    setExperience(p.experience);
    setEducation(p.education);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      saveJobProfile({
        headline: headline.trim(),
        summary: summary.trim(),
        skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
        city: city.trim(),
        experience: experience.trim(),
        education: education.trim(),
      }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: jobKeys.profile });
    },
    onError: (e) => setError(e instanceof ApiRequestError && e.status === 400 ? t('jobs.err.invalid') : errorMessage(e, t, locale)),
  });
  const remove = useMutation({
    mutationFn: deleteJobProfile,
    onSuccess: () => {
      for (const set of [setHeadline, setSummary, setSkills, setCity, setExperience, setEducation]) set('');
      void qc.invalidateQueries({ queryKey: jobKeys.profile });
    },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (q.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Screen>
    );
  }

  const touch = (set: (v: string) => void) => (v: string) => {
    setSaved(false);
    set(v);
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('jobs.cv') }} />
      <View style={styles.form}>
        <View style={[styles.note, { backgroundColor: colors.surface }]}>
          <Text variant="small" muted>
            {t('jobs.cvPrivacy')}
          </Text>
        </View>
        <TextField label={t('jobs.cv.headline')} value={headline} onChangeText={touch(setHeadline)} maxLength={120} />
        <TextField label={t('jobs.cv.summary')} value={summary} onChangeText={touch(setSummary)} multiline maxLength={2000} />
        <TextField label={t('jobs.cv.skills')} value={skills} onChangeText={touch(setSkills)} autoCapitalize="none" />
        <TextField label={t('jobs.cv.city')} value={city} onChangeText={touch(setCity)} maxLength={80} />
        <TextField label={t('jobs.cv.experience')} value={experience} onChangeText={touch(setExperience)} multiline maxLength={4000} />
        <TextField label={t('jobs.cv.education')} value={education} onChangeText={touch(setEducation)} multiline maxLength={2000} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {saved ? <Text variant="small">{t('common.saved')}</Text> : null}
        <Button label={t('jobs.cv.save')} loading={save.isPending} disabled={headline.trim().length < 2} onPress={() => save.mutate()} />
        {q.data.profile ? <Button variant="danger" label={t('jobs.cv.delete')} loading={remove.isPending} onPress={() => remove.mutate()} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  note: { borderRadius: radius.md, padding: spacing.md },
});
