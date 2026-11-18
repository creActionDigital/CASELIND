import type { OrgReview, StoreReview } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { fetchOrgReviews, replyToReview, sk, useMembership } from '../../../../seller/api';
import { can } from '../../../../seller/permissions';
import { Card, Chips, PagedList, sellerErrorMessage, Stars } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, Text, TextField } from '../../../../ui';
import { fetchStoreReviews, replyStoreReview, reviewsKeys } from '../../../../vitrine/reviews-api';
import { cleanReviewReply } from '../../../../vitrine/reviews-logic';

type Filter = 'all' | 'unanswered';

type Scope = 'products' | 'store';

/** Deux onglets : avis sur les produits, avis sur la boutique elle-même. */
export default function SellerReviews() {
  const { t } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [scope, setScope] = useState<Scope>('products');
  const tabs = (
    <Chips
      options={(['products', 'store'] as Scope[]).map((s) => ({ value: s, label: t(s === 'products' ? 'vitrine.storeReviews.tabProducts' : 'vitrine.storeReviews.tabStore') }))}
      value={scope}
      onChange={setScope}
    />
  );
  return scope === 'store' ? <StoreReviewsTab orgId={orgId} tabs={tabs} /> : <ProductReviews tabs={tabs} />;
}

/** Avis sur la boutique (note de l'organisation, pas d'un produit) avec réponse (même permission que les avis produits). */
function StoreReviewsTab({ orgId, tabs }: { orgId: string; tabs: ReactNode }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { role } = useMembership(orgId);
  const canReply = can(role, 'orders.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: [...reviewsKeys.staffReviews(orgId), filter],
    queryFn: ({ pageParam }) => fetchStoreReviews(orgId, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const reply = useMutation({
    mutationFn: (id: string) => {
      const body = cleanReviewReply(text);
      if (!body) throw new Error('reply');
      return replyStoreReview(orgId, id, body);
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: reviewsKeys.staffReviews(orgId) });
    },
    onError: (e) => setError(e instanceof Error && e.message === 'reply' ? t('vitrine.storeReviews.err.reply') : sellerErrorMessage(e, t, locale)),
  });
  return (
    <>
      <Stack.Screen options={{ title: t('seller.reviews') }} />
      <PagedList<StoreReview>
        query={q}
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: spacing.sm }}>
            {tabs}
            <Chips
              options={(['all', 'unanswered'] as Filter[]).map((f) => ({ value: f, label: t(`seller.reviews.filter.${f}` as const) }))}
              value={filter}
              onChange={setFilter}
            />
          </View>
        }
        empty={{ icon: 'star-outline', title: t('vitrine.storeReviews.emptyTitle'), body: t('vitrine.storeReviews.emptyBody') }}
        renderItem={({ item: r }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Stars rating={r.rating} />
              <Text variant="caption" muted style={{ flex: 1 }}>
                {r.author.displayName} · {new Date(r.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
            </View>
            {r.body ? <Text>{r.body}</Text> : null}
            {r.reply && editing !== r.id ? (
              <View style={{ borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md, marginTop: spacing.sm }}>
                <Text variant="caption" muted>
                  {t('seller.reviews.yourReply')}
                </Text>
                <Text variant="small">{r.reply.body}</Text>
              </View>
            ) : null}
            {canReply && editing !== r.id ? (
              <Button
                variant="ghost"
                label={r.reply ? t('vitrine.storeReviews.editReply') : t('vitrine.storeReviews.reply')}
                onPress={() => {
                  setText(r.reply?.body ?? '');
                  setError(null);
                  setEditing(r.id);
                }}
              />
            ) : null}
            {editing === r.id ? (
              <View style={{ marginTop: spacing.sm }}>
                <TextField label={t('vitrine.storeReviews.fieldReply')} value={text} onChangeText={setText} multiline maxLength={500} />
                {error ? (
                  <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.sm }}>
                    {error}
                  </Text>
                ) : null}
                <Button label={t('vitrine.storeReviews.send')} loading={reply.isPending} disabled={!text.trim()} onPress={() => reply.mutate(r.id)} />
                <Button variant="ghost" label={t('common.cancel')} disabled={reply.isPending} onPress={() => setEditing(null)} />
              </View>
            ) : null}
          </Card>
        )}
      />
    </>
  );
}

/** Avis sur tous les produits de la boutique (un seul fil, filtre « sans réponse »), avec réponse du vendeur. */
function ProductReviews({ tabs }: { tabs: ReactNode }) {
  const { t } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role } = useMembership(orgId);
  const canReply = can(role, 'orders.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const q = useInfiniteQuery({
    queryKey: [...sk.reviews(orgId), filter],
    queryFn: ({ pageParam }) => fetchOrgReviews(orgId, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <>
      <Stack.Screen options={{ title: t('seller.reviews') }} />
      <PagedList<OrgReview>
        query={q}
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: spacing.sm }}>
            {tabs}
            <Chips
              options={(['all', 'unanswered'] as Filter[]).map((f) => ({ value: f, label: t(`seller.reviews.filter.${f}` as const) }))}
              value={filter}
              onChange={setFilter}
            />
          </View>
        }
        empty={{ icon: 'star-outline', title: t('seller.reviews.emptyTitle'), body: t('seller.reviews.emptyBody') }}
        renderItem={({ item: r }) => <ReviewCard orgId={orgId} review={r} canReply={canReply} />}
      />
    </>
  );
}

function ReviewCard({ orgId, review: r, canReply }: { orgId: string; review: OrgReview; canReply: boolean }) {
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
      void qc.invalidateQueries({ queryKey: sk.reviews(orgId) });
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });
  return (
    <Card>
      <Text variant="caption" muted numberOfLines={1}>
        {t('seller.reviews.on', { title: r.product.title })}
      </Text>
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
