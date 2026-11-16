import { QUIZ_QUESTIONS_PER_SESSION, type QuizSession } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { startQuiz, submitQuiz } from '../../../games/api';
import { clock, completeAnswers, gameErrorKey, secondsLeft } from '../../../games/logic';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Screen, Text } from '../../../ui';

/** Une partie : 10 questions, 2 minutes, correction sur le serveur. Il faut répondre à toutes les questions avant la fin du temps. */
export default function Play() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [session, setSession] = useState<QuizSession | null>(null);
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => {
    const key = gameErrorKey(e);
    setError(key ? t(key) : errorMessage(e, t, locale));
  };
  const start = useMutation({
    mutationFn: startQuiz,
    onSuccess: (s) => {
      setError(null);
      setAnswers([]);
      setSession(s);
      setLeft(secondsLeft(s.expiresAt));
    },
    onError: fail,
  });
  const submit = useMutation({
    mutationFn: (v: { id: string; answers: number[] }) => submitQuiz(v.id, v.answers),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['games'] }),
    onError: fail,
  });

  useEffect(() => {
    start.mutate();
    // Une seule partie au premier affichage ; « Rejouer » en relance une.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!session || submit.data) return;
    const timer = setInterval(() => setLeft(secondsLeft(session.expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [session, submit.data]);

  const result = submit.data;
  const ready = completeAnswers(answers, QUIZ_QUESTIONS_PER_SESSION);
  const over = !!session && left === 0 && !result;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('games.quiz') }} />
      <View style={styles.body}>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {session && !result ? (
          <>
            <Text variant="heading">
              {over ? t('games.timeUp') : t('games.timeLeft', { time: clock(left) })}
            </Text>
            {session.questions.map((q, qi) => (
              <View key={q.id} style={[styles.card, { backgroundColor: colors.surface }]}>
                <Text variant="bodyStrong">
                  {qi + 1}. {q.prompt}
                </Text>
                {q.options.map((o, oi) => (
                  <Button
                    key={oi}
                    variant={answers[qi] === oi ? 'primary' : 'secondary'}
                    label={answers[qi] === oi ? `✓ ${o}` : o}
                    disabled={over}
                    onPress={() => setAnswers((cur) => Object.assign([...cur], { [qi]: oi }))}
                  />
                ))}
              </View>
            ))}
            <Button label={t('games.submit')} loading={submit.isPending} disabled={!ready || over} onPress={() => ready && submit.mutate({ id: session.id, answers: ready })} />
          </>
        ) : null}
        {result ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]} accessibilityLiveRegion="polite">
            <Text variant="heading">{t('games.result', { correct: result.correct, total: result.total, score: result.score })}</Text>
            {result.counted ? null : <Text muted>{t('games.notCounted')}</Text>}
          </View>
        ) : null}
        {result || over || (error && !session) ? <Button variant="secondary" label={t('games.again')} loading={start.isPending} onPress={() => { submit.reset(); start.mutate(); }} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});
