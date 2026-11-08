import type { ServiceReview } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { PagedList, Card } from '../../../../seller/ui';
import { fetchServiceReviews, replyToReview, svcKeys } from '../../../../services/api';
import { svcErrorMessage } from '../../../../services/ui';
import { Stars } from '../../../../shop/parts';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, Text, TextField } from '../../../../ui';

/** Avis reçus par une offre, avec réponse du prestataire. */
export default function ProviderReviews() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { offerId } = useLocalSearchParams<{ scope: string; offerId: string }>();
  const query = useInfiniteQuery({
    queryKey: svcKeys.reviews(offerId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchServiceReviews(offerId, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('services.pro.reviews') }} />
      <PagedList
        query={query}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <ReviewCard review={item} offerId={offerId} />}
        empty={{ icon: 'star-outline', title: t('services.pro.reviews.empty') }}
      />
    </View>
  );
}

function ReviewCard({ review, offerId }: { review: ServiceReview; offerId: string }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reply = useMutation({
    mutationFn: () => replyToReview(review.id, text.trim()),
    onMutate: () => setError(null),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: svcKeys.reviews(offerId) });
    },
    onError: (e) => setError(svcErrorMessage(e, t, locale)),
  });
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {review.author.displayName}
        </Text>
        <Stars value={review.rating} />
      </View>
      {review.body ? <Text>{review.body}</Text> : null}
      {review.reply ? (
        <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: 10 }}>
          <Text variant="caption" muted>
            {t('services.offer.reviewReply')}
          </Text>
          <Text variant="small">{review.reply.body}</Text>
        </View>
      ) : open ? (
        <>
          <TextField label={t('services.pro.reviews.replyPlaceholder')} value={text} onChangeText={setText} multiline maxLength={2000} />
          {error ? (
            <Text variant="small" color={colors.danger}>
              {error}
            </Text>
          ) : null}
          <Button label={t('services.pro.reviews.send')} loading={reply.isPending} disabled={!text.trim() || reply.isPending} onPress={() => reply.mutate()} />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setOpen(false)} />
        </>
      ) : (
        <Button variant="secondary" label={t('services.pro.reviews.reply')} onPress={() => setOpen(true)} />
      )}
    </Card>
  );
}
