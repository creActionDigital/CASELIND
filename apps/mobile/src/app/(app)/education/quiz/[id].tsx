import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { eduKeys, fetchQuiz, submitQuiz } from '../../../../education/api';
import { completeAnswers } from '../../../../education/logic';
import { useI18n } from '../../../../i18n';
import { errorMessage } from '../../../../lib/errors';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text } from '../../../../ui';

/** Quiz : une réponse par question, correction côté serveur, nouvelles tentatives possibles. */
export default function QuizScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = String(id);
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const quiz = useQuery({ queryKey: eduKeys.quiz(courseId), queryFn: () => fetchQuiz(courseId) });
  const submit = useMutation({
    mutationFn: (a: number[]) => submitQuiz(courseId, a),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: eduKeys.all });
    },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });

  if (quiz.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (quiz.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={quiz.error} onRetry={() => quiz.refetch()} />
      </Screen>
    );
  }
  const total = quiz.data.questions.length;
  const ready = completeAnswers(answers, total);
  const r = submit.data;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('education.quizEdit') }} />
      <View style={styles.body}>
        {quiz.data.questions.map((q, qi) => (
          <View key={q.id} style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="bodyStrong">
              {qi + 1}. {q.prompt}
            </Text>
            {q.options.map((o, oi) => (
              <Button
                key={oi}
                variant={answers[qi] === oi ? 'primary' : 'secondary'}
                label={answers[qi] === oi ? `✓ ${o}` : o}
                onPress={() => setAnswers((cur) => Object.assign([...cur], { [qi]: oi }))}
              />
            ))}
          </View>
        ))}
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {r ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]} accessibilityLiveRegion="polite">
            <Text variant="bodyStrong">{t(r.passed ? 'education.quizPassed' : 'education.quizFailed', { correct: r.correct, total: r.total, n: r.scorePercent })}</Text>
            {r.certificateCode ? <Text>{t('education.certificate', { code: r.certificateCode })}</Text> : r.passed ? <Text variant="small">{t('education.quizNeedLessons')}</Text> : null}
          </View>
        ) : null}
        <Button label={t('education.quizSubmit')} loading={submit.isPending} disabled={!ready} onPress={() => ready && submit.mutate(ready)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});
