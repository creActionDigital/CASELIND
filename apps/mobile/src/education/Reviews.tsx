import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CourseDetail } from '@caselind/contracts';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { openReport } from '../report/open-report';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { deleteReview, eduKeys, fetchReviews, saveReview } from './api';

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={n <= Math.round(value) ? 'star' : 'star-outline'} size={size} color={colors.primary} />
      ))}
    </View>
  );
}

/** Note moyenne d'un cours (liste et fiche). */
export function RatingLine({ avg, count }: { avg: number | null; count: number }) {
  const { t, locale } = useI18n();
  if (avg === null || count === 0) {
    return (
      <Text variant="small" muted>
        {t('education.noRating')}
      </Text>
    );
  }
  return (
    <View style={styles.row}>
      <Stars value={avg} size={14} />
      <Text variant="small" muted>
        {t('education.rating', { avg: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(avg), n: count })}
      </Text>
    </View>
  );
}

/** Avis d'un cours : saisie (inscrit, hors auteur) et liste, avec signalement. */
export function CourseReviews({ course }: { course: CourseDetail }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: eduKeys.reviews(course.id), queryFn: () => fetchReviews(course.id) });
  const mine = q.data?.items.find((r) => r.mine);
  const [rating, setRating] = useState<number | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownRating = rating ?? mine?.rating ?? 0;
  const done = () => {
    setError(null);
    setRating(null);
    setBody(null);
    void qc.invalidateQueries({ queryKey: eduKeys.all });
  };
  const fail = (e: unknown) => setError(errorMessage(e, t, locale));
  const save = useMutation({ mutationFn: () => saveReview(course.id, { rating: shownRating, body: body ?? mine?.body ?? '' }), onSuccess: done, onError: fail });
  const remove = useMutation({ mutationFn: () => deleteReview(course.id), onSuccess: done, onError: fail });

  return (
    <View style={styles.box}>
      <Text variant="bodyStrong">{t('education.reviews')}</Text>
      <RatingLine avg={course.ratingAvg} count={course.ratingCount} />
      {course.enrolled && !course.mine ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text variant="bodyStrong">{t('education.reviewMine')}</Text>
          <View style={styles.row}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} accessibilityRole="button" accessibilityLabel={t('education.reviewStars', { n })} accessibilityState={{ selected: shownRating === n }} onPress={() => setRating(n)} style={styles.star}>
                <Ionicons name={n <= shownRating ? 'star' : 'star-outline'} size={30} color={colors.primary} />
              </Pressable>
            ))}
          </View>
          <TextField label={t('education.reviewBody')} value={body ?? mine?.body ?? ''} onChangeText={setBody} multiline maxLength={500} />
          {error ? (
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label={t('education.reviewSend')} loading={save.isPending} disabled={shownRating === 0 || save.isPending} onPress={() => save.mutate()} />
          {mine ? <Button variant="ghost" label={t('education.reviewDelete')} loading={remove.isPending} onPress={() => remove.mutate()} /> : null}
        </View>
      ) : null}
      {q.data && q.data.items.length === 0 ? (
        <Text variant="small" muted>
          {t('education.reviewsEmpty')}
        </Text>
      ) : null}
      {q.data?.items
        .filter((r) => !r.mine)
        .map((r) => (
          <View key={r.id} style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.between}>
              <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {r.author.displayName}
              </Text>
              <Stars value={r.rating} />
            </View>
            {r.body ? <Text>{r.body}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t('education.reviewReport')} onPress={() => openReport({ targetType: 'course_review', targetId: r.id })} style={styles.link}>
              <Text variant="small" color={colors.textMuted}>
                {t('education.reviewReport')}
              </Text>
            </Pressable>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  star: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  link: { minHeight: 44, justifyContent: 'center' },
});
