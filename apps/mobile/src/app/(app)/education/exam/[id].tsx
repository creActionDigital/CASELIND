import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExamResult, ExamSession } from '@caselind/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { eduKeys, fetchExamHistory, startExam, submitExam } from '../../../../education/api';
import { completeAnswers, educationErrorKey, formatCountdown } from '../../../../education/logic';
import { useI18n } from '../../../../i18n';
import { errorMessage } from '../../../../lib/errors';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text } from '../../../../ui';

/** Examen blanc : compte à rebours sur l'échéance du serveur, une seule correction, aucun certificat. */
export default function ExamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = String(id);
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [session, setSession] = useState<ExamSession | null>(null);
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const history = useQuery({ queryKey: eduKeys.exam(courseId), queryFn: () => fetchExamHistory(courseId) });
  const fail = (e: unknown) => {
    const key = educationErrorKey(e);
    setError(key ? t(key) : errorMessage(e, t, locale));
    void qc.invalidateQueries({ queryKey: eduKeys.exam(courseId) });
  };
  const start = useMutation({
    mutationFn: () => startExam(courseId),
    onSuccess: (s) => {
      setError(null);
      setResult(null);
      setAnswers([]);
      setSession(s);
    },
    onError: fail,
  });
  const submit = useMutation({
    mutationFn: (a: number[]) => submitExam(courseId, session!.id, a),
    onSuccess: (r) => {
      setError(null);
      setResult(r);
      setSession(null);
      void qc.invalidateQueries({ queryKey: eduKeys.exam(courseId) });
    },
    onError: (e) => {
      setSession(null);
      fail(e);
    },
  });

  // Le décompte suit l'échéance du serveur ; à zéro la copie n'est plus acceptée (5 s de tolérance côté serveur).
  useEffect(() => {
    if (!session) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session]);

  if (history.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (history.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={history.error} onRetry={() => history.refetch()} />
      </Screen>
    );
  }
  const ready = session ? completeAnswers(answers, session.questions.length) : null;
  const fmtTime = (s: number) => formatCountdown(s);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('education.examTitle') }} />
      <View style={styles.body}>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {session ? (
          <>
            <Text variant="heading" accessibilityLiveRegion={left <= 60 ? 'polite' : 'none'}>
              {t('education.examLeft', { time: fmtTime(left) })}
            </Text>
            {session.questions.map((q, qi) => (
              <View key={q.id} style={[styles.card, { backgroundColor: colors.surface }]}>
                <Text variant="bodyStrong">
                  {qi + 1}. {q.prompt}
                </Text>
                {q.options.map((o, oi) => (
                  <Button key={oi} variant={answers[qi] === oi ? 'primary' : 'secondary'} label={answers[qi] === oi ? `✓ ${o}` : o} onPress={() => setAnswers((cur) => Object.assign([...cur], { [qi]: oi }))} />
                ))}
              </View>
            ))}
            <Button label={t('education.examSubmit')} loading={submit.isPending} disabled={!ready} onPress={() => ready && submit.mutate(ready)} />
          </>
        ) : (
          <>
            {result ? (
              <View style={[styles.card, { backgroundColor: colors.surface }]} accessibilityLiveRegion="polite">
                <Text variant="bodyStrong">{t('education.examResult', { correct: result.correct, total: result.total, n: result.scorePercent, time: fmtTime(result.usedSeconds) })}</Text>
                <Text variant="small">{t('education.examNoCert')}</Text>
              </View>
            ) : null}
            <Text variant="small">{t('education.examLeftToday', { n: history.data.attemptsLeftToday })}</Text>
            <Button label={t('education.examTitle')} loading={start.isPending} disabled={history.data.attemptsLeftToday === 0 && !start.isPending} onPress={() => start.mutate()} />
            <Text variant="heading" accessibilityRole="header">
              {t('education.examHistory')}
            </Text>
            {history.data.items.map((h) => (
              <Text key={h.id}>{t('education.examHistoryRow', { date: new Date(h.startedAt).toLocaleString(locale), n: h.scorePercent, time: fmtTime(h.usedSeconds) })}</Text>
            ))}
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});
