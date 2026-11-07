import type { Product, Review } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { fetchProductReviews, fetchProducts, replyToReview, sk, useMembership } from '../../../../seller/api';
import { can } from '../../../../seller/permissions';
import { Card, Chips, Loading, PagedList, sellerErrorMessage, Stars } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text, TextField } from '../../../../ui';

/** Avis sur les produits de la boutique, un produit à la fois, avec réponse du vendeur. */
export default function SellerReviews() {
  const { t } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const products = useQuery({
    queryKey: [...sk.products(orgId), 'for-reviews'],
    queryFn: () => fetchProducts(orgId),
  });
  const [picked, setPicked] = useState<string | null>(null);

  const title = <Stack.Screen options={{ title: t('seller.reviews') }} />;
  if (products.isPending) return <>{title}<Loading /></>;
  if (products.isError) return <>{title}<ErrorState error={products.error} onRetry={() => products.refetch()} /></>;
  const list = products.data.items.filter((p) => p.status !== 'draft');
  if (list.length === 0) return <>{title}<EmptyState icon="star-outline" title={t('seller.reviews.noProductTitle')} body={t('seller.reviews.noProductBody')} /></>;
  const current = list.find((p) => p.id === picked) ?? list[0];
  return (
    <>
      {title}
      <ProductReviews orgId={orgId} products={list} current={current} onPick={setPicked} />
    </>
  );
}

function ProductReviews({ orgId, products, current, onPick }: { orgId: string; products: Product[]; current: Product; onPick: (id: string) => void }) {
  const { t } = useI18n();
  const { role } = useMembership(orgId);
  const canReply = can(role, 'orders.manage');
  const q = useInfiniteQuery({
    queryKey: sk.reviews(orgId, current.id),
    queryFn: ({ pageParam }) => fetchProductReviews(current.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const summary = q.data?.pages[0]?.summary;
  return (
    <PagedList<Review>
      query={q}
      keyExtractor={(r) => r.id}
      header={
        <View>
          <Chips options={products.map((p) => ({ value: p.id, label: p.title }))} value={current.id} onChange={onPick} />
          {summary && summary.ratingCount > 0 ? (
            <Text variant="small" muted style={{ paddingHorizontal: spacing.lg }}>
              {t('seller.reviews.summary', { avg: summary.averageRating?.toFixed(1) ?? '–', n: summary.ratingCount })}
            </Text>
          ) : null}
        </View>
      }
      empty={{ icon: 'star-outline', title: t('seller.reviews.emptyTitle'), body: t('seller.reviews.emptyBody') }}
      renderItem={({ item: r }) => <ReviewCard orgId={orgId} productId={current.id} review={r} canReply={canReply} />}
    />
  );
}

function ReviewCard({ orgId, productId, review: r, canReply }: { orgId: string; productId: string; review: Review; canReply: boolean }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.reply?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const reply = useMutation({
    mutationFn: () => replyToReview(orgId, r.id, text.trim()),
    onMutate: () => setError(null),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: sk.reviews(orgId, productId) });
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Stars rating={r.rating} />
        <Text variant="caption" muted style={{ flex: 1 }}>
          {r.author.displayName} · {new Date(r.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
      </View>
      {r.body ? <Text>{r.body}</Text> : null}
      {r.reply && !editing ? (
        <View style={{ borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md, marginTop: spacing.sm }}>
          <Text variant="caption" muted>
            {t('seller.reviews.yourReply')}
          </Text>
          <Text variant="small">{r.reply.body}</Text>
        </View>
      ) : null}
      {canReply && !editing ? (
        <Button variant="ghost" label={r.reply ? t('seller.reviews.editReply') : t('seller.reviews.reply')} onPress={() => setEditing(true)} />
      ) : null}
      {editing ? (
        <View style={{ marginTop: spacing.sm }}>
          <TextField label={t('seller.reviews.yourReply')} value={text} onChangeText={setText} multiline maxLength={2000} />
          {error ? (
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.sm }}>
              {error}
            </Text>
          ) : null}
          <Button label={t('seller.reviews.send')} loading={reply.isPending} disabled={!text.trim()} onPress={() => reply.mutate()} />
          <Button variant="ghost" label={t('common.cancel')} disabled={reply.isPending} onPress={() => setEditing(false)} />
        </View>
      ) : null}
    </Card>
  );
}
