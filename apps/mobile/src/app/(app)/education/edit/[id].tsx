import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { eduKeys, fetchCourse, fetchQuiz, saveLessons, saveQuiz } from '../../../../education/api';
import { correctIndex, educationErrorKey, parseOptions } from '../../../../education/logic';
import { useI18n } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

interface LessonDraft {
  title: string;
  content: string;
}
interface QuestionDraft {
  prompt: string;
  options: string;
  correct: string;
}

/** Atelier de l'auteur : leçons et quiz (le corrigé reste sur le serveur ; il se ressaisit à chaque modification). */
export default function EditCourse() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = String(id);
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const course = useQuery({ queryKey: eduKeys.course(courseId), queryFn: () => fetchCourse(courseId) });
  const quiz = useQuery({ queryKey: eduKeys.quiz(courseId), queryFn: () => fetchQuiz(courseId), retry: false });
  const [lessons, setLessons] = useState<LessonDraft[] | null>(null);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [pass, setPass] = useState('70');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'lessons' | 'quiz' | null>(null);

  useEffect(() => {
    if (course.data && lessons === null) setLessons(course.data.lessons.map((l) => ({ title: l.title, content: l.content ?? '' })));
  }, [course.data, lessons]);
  useEffect(() => {
    if (course.data) setPass(String(course.data.passPercent));
    // Le corrigé n'est jamais renvoyé : on ne recharge que les énoncés et les réponses possibles.
    if (quiz.data) setQuestions(quiz.data.questions.map((q) => ({ prompt: q.prompt, options: q.options.join('\n'), correct: '' })));
  }, [quiz.data, course.data]);

  const fail = (e: unknown) => {
    setSaved(null);
    const key = educationErrorKey(e);
    if (key) return setError(t(key));
    setError(e instanceof ApiRequestError && e.status === 400 ? t('education.err.invalid') : errorMessage(e, t, locale));
  };
  const done = (which: 'lessons' | 'quiz') => {
    setError(null);
    setSaved(which);
    void qc.invalidateQueries({ queryKey: eduKeys.all });
  };
  const saveL = useMutation({
    mutationFn: () => saveLessons(courseId, { lessons: (lessons ?? []).map((l) => ({ title: l.title.trim(), content: l.content.trim() })) }),
    onSuccess: () => done('lessons'),
    onError: fail,
  });
  const saveQ = useMutation({
    mutationFn: () => {
      const passPercent = Number(pass);
      const qs = questions.map((q) => {
        const options = parseOptions(q.options);
        const idx = correctIndex(q.correct, options.length);
        if (idx === null || !q.prompt.trim()) throw new Error('invalid');
        return { prompt: q.prompt.trim(), options, correctIndex: idx };
      });
      if (!Number.isInteger(passPercent)) throw new Error('invalid');
      return saveQuiz(courseId, { passPercent, questions: qs });
    },
    onSuccess: () => done('quiz'),
    onError: (e) => (e instanceof Error && e.message === 'invalid' ? setError(t('education.err.invalid')) : fail(e)),
  });

  if (course.isPending || lessons === null) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (course.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={course.error} onRetry={() => course.refetch()} />
      </Screen>
    );
  }
  const setLesson = (i: number, patch: Partial<LessonDraft>) => setLessons((cur) => (cur ?? []).map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const setQuestion = (i: number, patch: Partial<QuestionDraft>) => setQuestions((cur) => cur.map((q, k) => (k === i ? { ...q, ...patch } : q)));

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: course.data.title }} />
      <View style={styles.body}>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {lessons.map((l, i) => (
          <View key={i} style={[styles.card, { backgroundColor: colors.surface }]}>
            <TextField label={`${i + 1}. ${t('education.lessonTitle')}`} value={l.title} onChangeText={(v) => setLesson(i, { title: v })} maxLength={120} />
            <TextField label={t('education.lessonContent')} value={l.content} onChangeText={(v) => setLesson(i, { content: v })} multiline maxLength={8000} />
            <Button variant="ghost" label={t('education.removeLesson')} onPress={() => setLessons((cur) => (cur ?? []).filter((_, k) => k !== i))} />
          </View>
        ))}
        <Button variant="secondary" label={t('education.addLesson')} onPress={() => setLessons((cur) => [...(cur ?? []), { title: '', content: '' }])} />
        <Button label={t('education.saveLessons')} loading={saveL.isPending} disabled={lessons.some((l) => !l.title.trim())} onPress={() => saveL.mutate()} />
        {saved === 'lessons' ? <Text variant="small">{t('education.saved')}</Text> : null}

        <Text variant="heading" accessibilityRole="header">
          {t('education.quizEdit')}
        </Text>
        <TextField label={t('education.passPercent')} value={pass} onChangeText={setPass} keyboardType="number-pad" maxLength={3} />
        {questions.map((q, i) => (
          <View key={i} style={[styles.card, { backgroundColor: colors.surface }]}>
            <TextField label={`${i + 1}. ${t('education.question')}`} value={q.prompt} onChangeText={(v) => setQuestion(i, { prompt: v })} maxLength={500} />
            <TextField label={t('education.questionOptions')} value={q.options} onChangeText={(v) => setQuestion(i, { options: v })} multiline />
            <TextField label={t('education.questionCorrect')} value={q.correct} onChangeText={(v) => setQuestion(i, { correct: v })} keyboardType="number-pad" maxLength={1} />
            <Button variant="ghost" label={t('education.removeQuestion')} onPress={() => setQuestions((cur) => cur.filter((_, k) => k !== i))} />
          </View>
        ))}
        <Button variant="secondary" label={t('education.addQuestion')} onPress={() => setQuestions((cur) => [...cur, { prompt: '', options: '', correct: '' }])} />
        <Button label={t('education.saveQuiz')} loading={saveQ.isPending} onPress={() => saveQ.mutate()} />
        {saved === 'quiz' ? <Text variant="small">{t('education.saved')}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});
