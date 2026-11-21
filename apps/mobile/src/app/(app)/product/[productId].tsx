import type { Review } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { shareMessage } from '../../../lib/share';
import { useToggleWish } from '../../../promotions/hooks';
import { PromoBadge, PromoCountdown, PromoPrice } from '../../../promotions/parts';
import { openReport } from '../../../report/open-report';
import { fetchCategories, fetchProduct, fetchReviews } from '../../../shop/api';
import { toggleCompareProductId, useCompareProductIds } from '../../../shop/compare-store';
import { quantityOf } from '../../../shop/cart-logic';
import { formatMoney } from '../../../shop/format';
import { shopKeys, useCart, useSetCartItem } from '../../../shop/hooks';
import { Stars, Stepper } from '../../../shop/parts';
import { defaultSelection, findVariant, isValueAvailable, optionAxes, selectValue, type Selection } from '../../../shop/variants';
import { AxisPicker } from '../../../shop/VariantPickers';
import { brandColor, onMedia, radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Avatar, EmptyState, ErrorState, Text, Button } from '../../../ui';
import { safeBack } from '../../../lib/back-target';

const MAX = 99;

export default function ProductScreen() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const id = String(productId);

  const compareIds = useCompareProductIds();
  const product = useQuery({ queryKey: shopKeys.product(id), queryFn: () => fetchProduct(id) });
  const reviews = useInfiniteQuery({
    queryKey: shopKeys.reviews(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchReviews(id, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const categories = useQuery({ queryKey: shopKeys.categories, queryFn: fetchCategories, staleTime: 10 * 60_000 });
  const cart = useCart();
  const setItem = useSetCartItem();
  const wish = useToggleWish(id);
  const listRef = useRef<FlatList>(null);

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
        <Stack.Screen options={{ headerShown: true, title: t('product.title') }} />
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (product.isError) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: true, title: t('product.title') }} />
        <ErrorState error={product.error} onRetry={() => product.refetch()} />
      </View>
    );
  }
  const p = product.data;
  const price = variant ?? p.variants.find((v) => v.inStock) ?? p.variants[0];
  const summary = reviews.data?.pages[0]?.summary;
  const reviewItems = reviews.data?.pages.flatMap((pg) => pg.items) ?? [];
  const longDescription = (p.description?.length ?? 0) > 180;
  const heroH = Math.round(width * 1.05);
  const category = categories.data?.items.find((c) => c.id === p.categoryId)?.name;

  function go(i: number) {
    const n = Math.max(0, Math.min(p.media.length - 1, i));
    listRef.current?.scrollToIndex({ index: n, animated: true });
    setPage(n);
  }

  function add(thenCheckout = false) {
    if (!variant || !canAdd) return;
    const quantity = Math.min(qty, room);
    setNotice(null);
    setItem.mutate(
      { variantId: variant.id, quantity: inCart + quantity },
      {
        onSuccess: () => {
          setQty(1);
          if (thenCheckout) {
            router.push('/checkout');
            return;
          }
          setNotice({ text: t('product.added'), ok: true });
        },
        onError: (e) => setNotice({ text: errorMessage(e, t, locale), ok: false }),
      },
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 150 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={{ width, height: heroH }}>
          {p.media.length > 0 ? (
            <FlatList
              ref={listRef}
              data={p.media}
              keyExtractor={(m) => m.id}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item, index }) => (
                <AuthImage
                  contentUrl={item.contentUrl}
                  label={t('product.photo', { n: index + 1, total: p.media.length })}
                  style={{ width, height: heroH, borderRadius: 0 }}
                />
              )}
            />
          ) : (
            <AuthImage contentUrl={p.coverUrl} label={p.title} style={{ width, height: heroH, borderRadius: 0 }} />
          )}
          <View style={[styles.topBar, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
            <RoundButton icon="chevron-back" label={t('product.back')} onPress={() => safeBack(router, '/shop')} />
            <View style={styles.topRight}>
              <RoundButton
                icon={p.wished ? 'heart' : 'heart-outline'}
                label={t(p.wished ? 'wish.remove' : 'wish.add')}
                pressed={!!p.wished}
                onPress={() =>
                  wish.mutate(!p.wished, {
                    onError: (e) => setNotice({ text: e instanceof ApiRequestError && e.detail<string>('reason') === 'wishlist_full' ? t('wish.full') : errorMessage(e, t, locale), ok: false }),
                  })
                }
              />
              <RoundButton
                icon="git-compare-outline"
                label={t('cmp.button')}
                pressed={compareIds.includes(p.id)}
                onPress={() => {
                  const next = toggleCompareProductId(p.id);
                  if (next.length >= 2 && next.includes(p.id)) router.push('/product/compare');
                  else if (next.includes(p.id)) setNotice({ text: t('cmp.added'), ok: true });
                }}
              />
              <RoundButton icon="share-outline" label={t('product.share')} onPress={() => void shareMessage({ message: p.title }, t('share.copied'))} />
            </View>
          </View>
          {p.media.length > 1 ? (
            <View style={styles.arrows} pointerEvents="box-none">
              <RoundButton icon="chevron-back" label={t('product.prevPhoto')} onPress={() => go(page - 1)} disabled={page === 0} />
              <RoundButton icon="chevron-forward" label={t('product.nextPhoto')} onPress={() => go(page + 1)} disabled={page === p.media.length - 1} />
            </View>
          ) : null}
        </View>

        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          {p.media.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
              {p.media.map((m, i) => (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  accessibilityLabel={t('product.photo', { n: i + 1, total: p.media.length })}
                  accessibilityState={{ selected: i === page }}
                  onPress={() => go(i)}
                  style={styles.thumbHit}
                >
                  <AuthImage
                    contentUrl={m.contentUrl}
                    label=""
                    style={[styles.thumb, { borderColor: i === page ? brandColor : colors.border, borderWidth: i === page ? 3 : 1 }]}
                  />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.wrap}>
            {category ? (
              <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
                <Text variant="caption" color={colors.textMuted}>
                  {category}
                </Text>
              </View>
            ) : null}
            <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
              <Text variant="caption" color={colors.textMuted}>
                {p.org.name}
              </Text>
            </View>
          </View>

          <View style={styles.titleRow}>
            <Text variant="heading" accessibilityRole="header" style={styles.flex}>
              {p.title}
            </Text>
            <View style={styles.priceCol}>
              {price ? <PromoPrice priceMinor={price.priceMinor} compareAtMinor={price.compareAtPriceMinor} currency={price.currency} variant="title" /> : null}
              {price ? <PromoBadge priceMinor={price.priceMinor} compareAtMinor={price.compareAtPriceMinor} /> : null}
              {summary && summary.ratingCount > 0 ? (
                <View
                  style={styles.avgRow}
                  accessible
                  accessibilityLabel={t('product.ratingA11y', { avg: (summary.averageRating ?? 0).toFixed(1), n: summary.ratingCount })}
                >
                  <Stars value={summary.averageRating ?? 0} size={14} />
                  <Text variant="caption" muted>
                    ({summary.ratingCount})
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {price?.promotion ? (
            <View style={styles.promoLine} accessibilityLiveRegion="none">
              <Text variant="bodyStrong" color={colors.danger}>
                {price.promotion.label}
              </Text>
              <PromoCountdown endsAt={price.promotion.endsAt} />
            </View>
          ) : null}

          {axes.map((axis) => (
            <View key={axis.name} style={styles.group}>
              <Text variant="bodyStrong">
                {axis.name}
                {selection[axis.name] ? ` : ${selection[axis.name]}` : ''}
              </Text>
              <AxisPicker
                axis={axis}
                selected={selection[axis.name]}
                isDisabled={(val) => !isValueAvailable(p.variants, selection, axis.name, val)}
                onSelect={(val) => setSelection(selectValue(p.variants, selection, axis.name, val))}
              />
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
              <Text numberOfLines={expanded ? undefined : 4} muted>
                {p.description}
              </Text>
              {longDescription ? (
                <Pressable accessibilityRole="button" onPress={() => setExpanded((v) => !v)} style={styles.link}>
                  <Text style={{ fontWeight: '600' }}>{expanded ? t('product.less') : t('product.more')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.seller, { backgroundColor: colors.surfaceAlt }]}>
            <Avatar name={p.org.name} size={44} />
            <View style={styles.flex}>
              <Text variant="small" muted>
                {t('product.shop')}
              </Text>
              <Text variant="bodyStrong" numberOfLines={1}>
                {p.org.name}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('product.visitStore', { name: p.org.name })}
              onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: p.org.slug } })}
              style={[styles.visit, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text variant="small" style={{ fontWeight: '600' }}>
                {t('product.viewShop')}
              </Text>
            </Pressable>
          </View>

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
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('product.add')}
            accessibilityState={{ disabled: !canAdd || setItem.isPending }}
            disabled={!canAdd || setItem.isPending}
            onPress={() => add()}
            style={[styles.action, styles.addBtn, { opacity: canAdd ? 1 : 0.45, borderColor: colors.border }]}
          >
            <Ionicons name="add" size={20} color={onMedia} />
            <Text variant="bodyStrong" color={onMedia} numberOfLines={1} style={styles.actionLabel}>
              {t('product.add')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('product.buy')}
            accessibilityState={{ disabled: !canAdd || setItem.isPending }}
            disabled={!canAdd || setItem.isPending}
            onPress={() => add(true)}
            style={[styles.action, { backgroundColor: brandColor, opacity: canAdd ? 1 : 0.45 }]}
          >
            <Ionicons name="bag-handle-outline" size={20} color={onMedia} />
            <Text variant="bodyStrong" color={onMedia} numberOfLines={1} style={styles.actionLabel}>
              {t('product.buy')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Bouton rond translucide posé sur la photo (voile noir uni, icône blanche : contraste AA). */
function RoundButton({ icon, label, onPress, disabled, pressed: on }: { icon: 'chevron-back' | 'chevron-forward' | 'share-outline' | 'heart' | 'heart-outline' | 'git-compare-outline'; label: string; onPress: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, ...(on === undefined ? {} : { selected: on }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.round, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={icon === 'heart' ? '#FF6961' : onMedia} />
    </Pressable>
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
  group: { gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  topBar: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', justifyContent: 'space-between' },
  round: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  arrows: { position: 'absolute', bottom: 48, alignSelf: 'center', flexDirection: 'row', gap: spacing.sm },
  sheet: { marginTop: -radius.xxl, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.lg, gap: spacing.md },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2 },
  thumbs: { gap: spacing.sm, paddingVertical: spacing.xs },
  thumbHit: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 56, height: 56, borderRadius: radius.pill },
  tag: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  topRight: { flexDirection: 'row', gap: spacing.sm },
  promoLine: { gap: 2 },
  priceCol: { alignItems: 'flex-end', gap: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { minHeight: TOUCH, justifyContent: 'center' },
  seller: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.xl, minHeight: TOUCH + 20 },
  visit: { minHeight: TOUCH, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1, minHeight: 56, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
  addBtn: { backgroundColor: '#0A0A0A', borderWidth: StyleSheet.hairlineWidth },
  actionLabel: { flexShrink: 1 },
});
