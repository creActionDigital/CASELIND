import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { safeBack } from '../../../lib/back-target';
import { errorMessage } from '../../../lib/errors';
import { createReview, fetchProduct, updateReview } from '../../../shop/api';
import { shopKeys } from '../../../shop/hooks';
import { spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

export default function NewReview() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { productId, reviewId, r, b } = useLocalSearchParams<{ productId: string; reviewId?: string; r?: string; b?: string }>();
  const id = String(productId);
  const [rating, setRating] = useState(Number(r) || 0);
  const [body, setBody] = useState(b ?? '');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'sent' | 'already' | null>(null);

  const product = useQuery({ queryKey: shopKeys.product(id), queryFn: () => fetchProduct(id) });
  const send = useMutation({
    mutationFn: () => reviewId ? updateReview(reviewId, { rating, body: body.trim() || null }) : createReview(id, { rating, ...(body.trim() ? { body: body.trim() } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shopKeys.reviews(id) });
      qc.setQueryData(shopKeys.reviewed(id), true);
      setDone('sent');
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409) {
        qc.setQueryData(shopKeys.reviewed(id), true);
        return setDone('already');
      }
      setError(errorMessage(e, t, locale));
    },
  });

  if (product.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (product.isError) return <ErrorState error={product.error} onRetry={() => product.refetch()} />;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('review.title') }} />
      <Text variant="heading" accessibilityRole="header" style={{ marginBottom: spacing.md }}>
        {product.data.title}
      </Text>
      {done ? (
        <View style={{ gap: spacing.md }}>
          <Text accessibilityLiveRegion="polite" color={done === 'sent' ? colors.success : undefined} variant="bodyStrong">
            {t(done === 'sent' ? 'review.done' : 'review.alreadyDone')}
          </Text>
          <Button label={t('common.close')} onPress={() => safeBack(router, `/product/${id}`)} />
        </View>
      ) : (
        <>
      <Text variant="bodyStrong">{t('review.rating')}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={t('review.star', { n })}
            accessibilityState={{ selected: rating === n }}
            onPress={() => setRating(n)}
            style={styles.star}
          >
            <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={32} color={colors.primary} />
          </Pressable>
        ))}
      </View>
      <TextField label={t('review.body')} value={body} onChangeText={setBody} multiline maxLength={2000} />
      {error ? (
        <Text color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>
          {error}
        </Text>
      ) : null}
      <Button
        label={t('review.submit')}
        loading={send.isPending}
        onPress={() => {
          if (rating < 1) return setError(t('review.ratingRequired'));
          setError(null);
          send.mutate();
        }}
      />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stars: { flexDirection: 'row', gap: spacing.xs, marginVertical: spacing.md },
  star: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
