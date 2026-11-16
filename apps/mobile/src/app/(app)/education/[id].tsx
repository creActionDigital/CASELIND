import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { completeLesson, eduKeys, enrollInCourse, fetchCourse, fetchStudents, setPublished } from '../../../education/api';
import { educationErrorKey, levelKey } from '../../../education/logic';
import { CourseReviews } from '../../../education/Reviews';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { openReport } from '../../../report/open-report';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text } from '../../../ui';

/** Fiche de cours : inscription, leçons avec progression, quiz, certificat ; pour l'auteur, état de publication et apprenants. */
export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = String(id);
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: eduKeys.course(courseId), queryFn: () => fetchCourse(courseId) });
  const c = q.data;
  const students = useQuery({ queryKey: eduKeys.students(courseId), queryFn: () => fetchStudents(courseId), enabled: !!c?.mine });

  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: eduKeys.all });
  };
  const fail = (e: unknown) => {
    const key = educationErrorKey(e);
    setError(key ? t(key) : errorMessage(e, t, locale));
  };
  const enroll = useMutation({ mutationFn: () => enrollInCourse(courseId), onSuccess: refresh, onError: fail });
  const done = useMutation({ mutationFn: (lessonId: string) => completeLesson(courseId, lessonId), onSuccess: refresh, onError: fail });
  const publish = useMutation({ mutationFn: (p: boolean) => setPublished(courseId, p), onSuccess: refresh, onError: fail });

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (q.isError || !c) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Screen>
    );
  }
  const canRead = c.mine || c.enrolled;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('education.title') }} />
      <View style={styles.body}>
        <Text variant="title" accessibilityRole="header">
          {c.title}
        </Text>
        <View style={styles.badges}>
          <Badge tone="neutral" label={t(levelKey(c.level))} />
          <Badge tone="neutral" label={c.language.toUpperCase()} />
          {c.mine ? <Badge tone="neutral" label={t(c.status === 'published' ? 'education.published' : 'education.draft')} /> : null}
        </View>
        <Text muted>{t('education.by', { name: c.author.displayName })}</Text>
        {c.description ? <Text>{c.description}</Text> : null}
        {c.questionCount > 0 ? <Text variant="small">{t('education.quizQuestions', { n: c.questionCount, pass: c.passPercent })}</Text> : null}
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {!c.mine && !c.enrolled ? <Button label={t('education.enroll')} loading={enroll.isPending} onPress={() => enroll.mutate()} /> : null}
        {c.progressPercent !== null ? <Text variant="bodyStrong">{t('education.progress', { n: c.progressPercent })}</Text> : null}
        {c.certificateCode ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="bodyStrong">{t('education.certificate', { code: c.certificateCode })}</Text>
            <Text variant="small" muted>
              {t('education.certificateHint')}
            </Text>
          </View>
        ) : null}

        {c.lessons.map((l) => (
          <View key={l.id} style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="bodyStrong" onPress={canRead ? () => setOpen(open === l.id ? null : l.id) : undefined} accessibilityRole={canRead ? 'button' : undefined}>
              {l.position + 1}. {l.title}
              {l.done ? '  ✓' : ''}
            </Text>
            {canRead && open === l.id ? <Text>{l.content}</Text> : null}
            {c.enrolled && !c.mine && !l.done ? <Button variant="secondary" label={t('education.markDone')} loading={done.isPending && done.variables === l.id} onPress={() => done.mutate(l.id)} /> : null}
          </View>
        ))}

        {c.questionCount > 0 && canRead ? (
          <>
            {c.bestScorePercent !== null ? <Text variant="small">{t('education.bestScore', { n: c.bestScorePercent })}</Text> : null}
            <Button label={t('education.takeQuiz')} onPress={() => router.push({ pathname: '/education/quiz/[id]', params: { id: c.id } })} />
          </>
        ) : null}

        {c.status === 'published' ? <CourseReviews course={c} /> : null}

        {c.mine ? (
          <>
            {students.data ? <Text variant="small">{t('education.students', { enrolled: students.data.enrolledCount, done: students.data.completedCount })}</Text> : null}
            <Button variant="secondary" label={t('education.edit')} onPress={() => router.push({ pathname: '/education/edit/[id]', params: { id: c.id } })} />
            <Button variant="secondary" label={t(c.status === 'published' ? 'education.unpublish' : 'education.publish')} loading={publish.isPending} onPress={() => publish.mutate(c.status !== 'published')} />
          </>
        ) : (
          <Button variant="ghost" label={t('education.report')} onPress={() => openReport({ targetType: 'course', targetId: c.id })} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  badges: { flexDirection: 'row', gap: spacing.xs },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
