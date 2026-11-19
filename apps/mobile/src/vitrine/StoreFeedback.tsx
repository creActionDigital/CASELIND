import { Ionicons } from '@expo/vector-icons';
import { alertConfirm } from '../lib/confirm';
import type { OrgRating, PublicOrg, StoreReview } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { openReport } from '../report/open-report';
import { Stars } from '../seller/ui';
import { shopKeys } from '../shop/hooks';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import {
  askQuestion,
  deleteMyStoreReview,
  fetchMyQuestions,
  fetchMyStoreReview,
  fetchPublicQuestions,
  fetchPublicReviews,
  reviewsKeys,
  saveMyStoreReview,
} from './reviews-api';
import { buildReview, cleanQuestion, type FeedbackError, feedbackError, ratingLabel } from './reviews-logic';

const REVIEW_ERRORS: Partial<Record<FeedbackError, MessageKey>> = {
  notPurchased: 'vitrine.reviews.err.notPurchased',
  member: 'vitrine.reviews.err.member',
  moderated: 'vitrine.reviews.err.moderated',
  unavailable: 'vitrine.reviews.err.unavailable',
};
const QUESTION_ERRORS: Partial<Record<FeedbackError, MessageKey>> = {
  rateLimited: 'vitrine.questions.err.rateLimited',
  member: 'vitrine.questions.err.member',
  unavailable: 'vitrine.questions.err.unavailable',
};

function apiError(e: unknown, map: Partial<Record<FeedbackError, MessageKey>>, t: (k: MessageKey) => string, locale: string): string {
  const kind = e instanceof ApiRequestError ? feedbackError(e.status, e.detail<string>('reason')) : null;
  const key = kind ? map[kind] : undefined;
  return key ? t(key) : errorMessage(e, t, locale);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.block, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Note moyenne et nombre d'avis, près du nom ; rien sans avis. */
export function RatingBadge({ rating }: { rating: OrgRating | null }) {
  const { colors } = useTheme();
  const { locale } = useI18n();
  if (!rating) return null;
  return (
    <View style={styles.row} accessible accessibilityLabel={ratingLabel(rating, locale)}>
      <Ionicons name="star" size={16} color={colors.primary} />
      <Text variant="small">{ratingLabel(rating, locale)}</Text>
    </View>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} accessibilityRole="button" accessibilityLabel={t('vitrine.reviews.star', { n })} accessibilityState={{ selected: n === value }} onPress={() => onChange(n)} style={styles.star}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={28} color={colors.primary} />
        </Pressable>
      ))}
    </View>
  );
}

/** Formulaire de l'acheteur éligible : note, texte, modification et suppression de son avis. */
function MyReview({ org }: { org: Pick<PublicOrg, 'id' | 'slug'> }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: reviewsKeys.mine(org.id), queryFn: () => fetchMyStoreReview(org.id), retry: false });
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: reviewsKeys.mine(org.id) });
    void qc.invalidateQueries({ queryKey: reviewsKeys.publicReviews(org.slug) });
    void qc.invalidateQueries({ queryKey: shopKeys.store(org.slug) });
  };
  const save = useMutation({
    mutationFn: () => {
      const built = buildReview(rating ?? mine.data?.review?.rating ?? 0, text ?? mine.data?.review?.body ?? '');
      if ('error' in built) throw new Error(built.error);
      return saveMyStoreReview(org.id, built.ok);
    },
    onMutate: () => setInfo(null),
    onSuccess: () => {
      setRating(null);
      setText(null);
      refresh();
    },
    onError: (e) => {
      const m = e instanceof Error ? e.message : '';
      setInfo(m === 'rating' || m === 'body' ? t(`vitrine.reviews.err.${m}` as MessageKey) : apiError(e, REVIEW_ERRORS, t, locale));
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteMyStoreReview(org.id),
    onSuccess: () => {
      setRating(null);
      setText(null);
      refresh();
    },
    onError: (e) => setInfo(apiError(e, REVIEW_ERRORS, t, locale)),
  });
  const data = mine.data;
  if (!data?.canReview) return null;
  const review = data.review;
  const shownRating = rating ?? review?.rating ?? 0;
  return (
    <View style={styles.form}>
      <Text variant="bodyStrong">{t('vitrine.reviews.yours')}</Text>
      {data.hidden ? (
        <Text variant="small" color={colors.danger}>
          {t('vitrine.reviews.hiddenMine')}
        </Text>
      ) : (
        <>
          <StarPicker value={shownRating} onChange={setRating} />
          <TextField label={t('vitrine.reviews.fieldBody')} value={text ?? review?.body ?? ''} onChangeText={setText} multiline maxLength={500} />
          {info ? (
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
              {info}
            </Text>
          ) : null}
          <Button label={review ? t('vitrine.reviews.update') : t('vitrine.reviews.send')} loading={save.isPending} onPress={() => save.mutate()} />
          {review ? (
            <Button
              variant="ghost"
              label={t('vitrine.reviews.delete')}
              disabled={remove.isPending}
              onPress={() => alertConfirm(t('vitrine.reviews.delete'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('vitrine.reviews.delete'), style: 'destructive', onPress: () => remove.mutate() }])}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function ReviewItem({ r }: { r: StoreReview }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  return (
    <View style={[styles.item, { borderColor: colors.border }]}>
      <View style={styles.row}>
        <Stars rating={r.rating} />
        <Text variant="caption" muted style={styles.flex}>
          {r.author.displayName} · {new Date(r.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
      </View>
      {r.body ? <Text>{r.body}</Text> : null}
      {r.reply ? (
        <View style={[styles.reply, { borderLeftColor: colors.primary }]}>
          <Text variant="caption" muted>
            {t('vitrine.reviews.shopReply')}
          </Text>
          <Text variant="small">{r.reply.body}</Text>
        </View>
      ) : null}
      <Button variant="ghost" label={t('vitrine.reviews.report')} onPress={() => openReport({ targetType: 'org_review', targetId: r.id })} />
    </View>
  );
}

/** Section « Avis » de la page publique : liste paginée (voir plus) et formulaire de l'acheteur éligible. */
export function StoreReviews({ org }: { org: Pick<PublicOrg, 'id' | 'slug' | 'rating'> }) {
  const { t } = useI18n();
  const q = useInfiniteQuery({
    queryKey: reviewsKeys.publicReviews(org.slug),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPublicReviews(org.slug, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Section title={t('vitrine.reviews.title')}>
      <RatingBadge rating={org.rating} />
      <MyReview org={org} />
      {items.length === 0 && !q.isPending ? <Text muted>{t('vitrine.reviews.empty')}</Text> : null}
      {items.map((r) => (
        <ReviewItem key={r.id} r={r} />
      ))}
      {q.hasNextPage ? <Button variant="secondary" label={t('vitrine.reviews.more')} loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
    </Section>
  );
}

/** Section « Questions » : réponses publiques, questions en attente de l'auteur et champ pour en poser une. */
export function StoreQuestions({ org }: { org: Pick<PublicOrg, 'id' | 'slug'> }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [info, setInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const list = useInfiniteQuery({
    queryKey: reviewsKeys.publicQuestions(org.slug),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPublicQuestions(org.slug, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const mine = useQuery({ queryKey: reviewsKeys.myQuestions, queryFn: fetchMyQuestions, retry: false });
  const ask = useMutation({
    mutationFn: () => {
      const q = cleanQuestion(text);
      if (!q) throw new Error('empty');
      return askQuestion(org.id, q);
    },
    onMutate: () => setInfo(null),
    onSuccess: () => {
      setText('');
      setInfo({ ok: true, text: t('vitrine.questions.sent') });
      void qc.invalidateQueries({ queryKey: reviewsKeys.myQuestions });
    },
    onError: (e) => setInfo({ ok: false, text: e instanceof Error && e.message === 'empty' ? t('vitrine.questions.err.empty') : apiError(e, QUESTION_ERRORS, t, locale) }),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const pending = (mine.data?.items ?? []).filter((q) => q.org.id === org.id && !q.answer && !q.hidden);
  return (
    <Section title={t('vitrine.questions.title')}>
      {items.length === 0 && !list.isPending ? <Text muted>{t('vitrine.questions.empty')}</Text> : null}
      {items.map((q) => (
        <View key={q.id} style={[styles.item, { borderColor: colors.border }]}>
          <Text variant="bodyStrong">{q.question}</Text>
          <Text>{q.answer}</Text>
          <Button variant="ghost" label={t('vitrine.questions.report')} onPress={() => openReport({ targetType: 'org_question', targetId: q.id })} />
        </View>
      ))}
      {list.hasNextPage ? <Button variant="secondary" label={t('vitrine.reviews.more')} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} /> : null}
      {pending.length > 0 ? (
        <View style={styles.form}>
          <Text variant="caption" muted>
            {t('vitrine.questions.pending')}
          </Text>
          {pending.map((q) => (
            <Text key={q.id} variant="small">
              {q.question}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={styles.form}>
        <TextField label={t('vitrine.questions.field')} value={text} onChangeText={setText} multiline maxLength={300} />
        {info ? (
          <Text variant="small" color={info.ok ? colors.textMuted : colors.danger} accessibilityLiveRegion="polite">
            {info.text}
          </Text>
        ) : null}
        <Button label={t('vitrine.questions.ask')} loading={ask.isPending} onPress={() => ask.mutate()} />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  block: { padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  form: { gap: spacing.sm },
  star: { minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
  item: { gap: spacing.xs, alignItems: 'flex-start', paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  reply: { borderLeftWidth: 3, paddingLeft: spacing.md },
});
