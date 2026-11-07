import type { Review } from '@caselind/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { openReport } from '../../../report/open-report';
import { fetchProduct, fetchReviews } from '../../../shop/api';
import { quantityOf } from '../../../shop/cart-logic';
import { formatMoney } from '../../../shop/format';
import { shopKeys, useCart, useSetCartItem } from '../../../shop/hooks';
import { Chip, Stars, Stepper } from '../../../shop/parts';
import { defaultSelection, findVariant, isValueAvailable, optionAxes, selectValue, type Selection } from '../../../shop/variants';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Avatar, Button, EmptyState, ErrorState, Text } from '../../../ui';

const MAX = 99;

export default function ProductScreen() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const id = String(productId);

  const product = useQuery({ queryKey: shopKeys.product(id), queryFn: () => fetchProduct(id) });
  const reviews = useInfiniteQuery({
    queryKey: shopKeys.reviews(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchReviews(id, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const cart = useCart();
  const setItem = useSetCartItem();

  const variants = product.data?.variants;
  const [selection, setSelection] = useState<Selection>({});
  const [qty, setQty] = useState(1);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (variants) setSelection(defaultSelection(variants));
  }, [variants]);

  const axes = useMemo(() => (variants ? optionAxes(variants) : []), [variants]);
  const variant = variants ? findVariant(variants, selection) : null;
  const inCart = quantityOf(cart.data, variant?.id ?? '');
  const room = Math.max(0, MAX - inCart);
  const canAdd = !!variant && variant.inStock && room > 0;

  if (product.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (product.isError) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <ErrorState error={product.error} onRetry={() => product.refetch()} />
      </View>
    );
  }
  const p = product.data;
  const price = variant ?? p.variants.find((v) => v.inStock) ?? p.variants[0];
  const summary = reviews.data?.pages[0]?.summary;
  const reviewItems = reviews.data?.pages.flatMap((pg) => pg.items) ?? [];
  const longDescription = (p.description?.length ?? 0) > 180;

  function add() {
    if (!variant || !canAdd) return;
    const quantity = Math.min(qty, room);
    setNotice(null);
    setItem.mutate(
      { variantId: variant.id, quantity: inCart + quantity },
      {
        onSuccess: () => {
          setNotice({ text: t('product.added'), ok: true });
          setQty(1);
        },
        onError: (e) => setNotice({ text: errorMessage(e, t, locale), ok: false }),
      },
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('product.title') }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}>
        {p.media.length > 0 ? (
          <View>
            <FlatList
              data={p.media}
              keyExtractor={(m) => m.id}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item, index }) => (
                <AuthImage
                  contentUrl={item.contentUrl}
                  label={t('product.photo', { n: index + 1, total: p.media.length })}
                  style={{ width, height: width, borderRadius: 0 }}
                />
              )}
            />
            {p.media.length > 1 ? (
              <View style={styles.dots} accessibilityLabel={t('product.photo', { n: page + 1, total: p.media.length })}>
                {p.media.map((m, i) => (
                  <View key={m.id} style={[styles.dot, { backgroundColor: i === page ? colors.primary : colors.border }]} />
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <AuthImage contentUrl={p.coverUrl} label={p.title} style={{ width, height: width, borderRadius: 0 }} />
        )}

        <View style={styles.body}>
          <Text variant="title" accessibilityRole="header">
            {p.title}
          </Text>
          <Text variant="heading" color={colors.primary}>
            {price ? formatMoney(price.priceMinor, price.currency, locale) : ''}
          </Text>

          {axes.map((axis) => (
            <View key={axis.name} style={styles.group}>
              <Text variant="bodyStrong">
                {axis.name}
                {selection[axis.name] ? ` : ${selection[axis.name]}` : ''}
              </Text>
              <View style={styles.wrap}>
                {axis.values.map((val) => (
                  <Chip
                    key={val}
                    label={val}
                    selected={selection[axis.name] === val}
                    disabled={!isValueAvailable(p.variants, selection, axis.name, val) && selection[axis.name] !== val}
                    onPress={() => setSelection(selectValue(p.variants, selection, axis.name, val))}
                  />
                ))}
              </View>
            </View>
          ))}
          {variant && !variant.inStock ? (
            <Text color={colors.danger} accessibilityLiveRegion="polite">
              {t('product.outOfStock')}
            </Text>
          ) : !variant ? (
            <Text muted>{t('product.unavailable')}</Text>
          ) : null}

          <View style={styles.qtyRow}>
            <Text variant="bodyStrong">{t('product.quantity')}</Text>
            <Stepper value={Math.min(qty, Math.max(room, 1))} max={Math.max(room, 1)} onChange={setQty} />
          </View>
          {room === 0 ? <Text variant="small" muted>{t('product.cartMax')}</Text> : null}

          {p.description ? (
            <View style={styles.group}>
              <Text variant="heading" accessibilityRole="header">
                {t('product.description')}
              </Text>
              <Text numberOfLines={expanded ? undefined : 4}>{p.description}</Text>
              {longDescription ? (
                <Pressable accessibilityRole="button" onPress={() => setExpanded((v) => !v)} style={styles.link}>
                  <Text color={colors.primary}>{expanded ? t('product.less') : t('product.more')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('product.visitStore', { name: p.org.name })}
            onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: p.org.slug } })}
            style={[styles.seller, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Avatar name={p.org.name} size={44} />
            <View style={styles.flex}>
              <Text variant="small" muted>
                {t('product.seller')}
              </Text>
              <Text variant="bodyStrong" numberOfLines={1}>
                {p.org.name}
              </Text>
            </View>
          </Pressable>

          <View style={styles.group}>
            <Text variant="heading" accessibilityRole="header">
              {t('product.reviews')}
            </Text>
            {reviews.isPending ? (
              <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
            ) : reviews.isError ? (
              <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />
            ) : summary && summary.ratingCount > 0 ? (
              <>
                <View style={styles.avgRow}>
                  <Stars value={summary.averageRating ?? 0} size={20} />
                  <Text>{t('product.average', { avg: (summary.averageRating ?? 0).toFixed(1), n: summary.ratingCount })}</Text>
                </View>
                {(['5', '4', '3', '2', '1'] as const).map((k) => (
                  <View key={k} style={styles.distRow} accessible accessibilityLabel={t('product.distribution', { n: k, count: summary.distribution[k] })}>
                    <Text variant="small" muted style={styles.distLabel}>
                      {k}
                    </Text>
                    <View style={[styles.bar, { backgroundColor: colors.surfaceAlt }]}>
                      <View style={[styles.barFill, { backgroundColor: colors.primary, width: `${(summary.distribution[k] / summary.ratingCount) * 100}%` }]} />
                    </View>
                    <Text variant="small" muted style={styles.distCount}>
                      {summary.distribution[k]}
                    </Text>
                  </View>
                ))}
                {reviewItems.map((r) => (
                  <ReviewRow key={r.id} review={r} />
                ))}
                {reviews.hasNextPage ? (
                  <Button variant="secondary" label={t('product.moreReviews')} loading={reviews.isFetchingNextPage} onPress={() => reviews.fetchNextPage()} />
                ) : null}
              </>
            ) : (
              <EmptyState icon="chatbubble-ellipses-outline" title={t('product.noReviews')} body={t('product.noReviewsBody')} />
            )}
          </View>
        </View>
      </ScrollView>

      {/* Opaque: the translucent tab-bar colour lets the description show through without a blur behind it. */}
      <View style={[styles.bottom, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + spacing.md }]}>
        {notice ? (
          <View style={styles.noticeRow} accessibilityLiveRegion="polite">
            <Text variant="small" color={notice.ok ? colors.success : colors.danger} style={styles.flex}>
              {notice.text}
            </Text>
            {notice.ok ? (
              <Pressable accessibilityRole="button" onPress={() => router.push('/cart')} style={styles.link}>
                <Text variant="small" color={colors.primary} style={{ fontWeight: '600' }}>
                  {t('product.viewCart')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Button label={t('product.add')} onPress={add} disabled={!canAdd} loading={setItem.isPending} />
      </View>
    </View>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.review, { borderTopColor: colors.border }]}>
      <View style={styles.reviewHead}>
        <Avatar name={review.author.displayName} size={32} />
        <View style={styles.flex}>
          <Text variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>
            {review.author.displayName}
          </Text>
          <Text variant="caption" muted>
            {t('product.verifiedPurchase')}
          </Text>
        </View>
        <Stars value={review.rating} />
      </View>
      {review.body ? <Text>{review.body}</Text> : null}
      {review.reply ? (
        <View style={[styles.reply, { backgroundColor: colors.surfaceAlt }]}>
          <Text variant="caption" muted>
            {t('product.sellerReply')}
          </Text>
          <Text variant="small">{review.reply.body}</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('product.report')}
        onPress={() => openReport({ targetType: 'review', targetId: review.id })}
        style={styles.link}
      >
        <Text variant="small" color={colors.textMuted}>
          {t('product.report')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.lg, gap: spacing.md },
  group: { gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { minHeight: TOUCH, justifyContent: 'center' },
  seller: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, minHeight: TOUCH + 20 },
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  distLabel: { width: 14, textAlign: 'right' },
  distCount: { width: 28 },
  bar: { flex: 1, height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  barFill: { height: 6 },
  review: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, gap: spacing.sm },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reply: { padding: spacing.md, borderRadius: radius.md, gap: 2 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
