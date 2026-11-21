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
import { fetchCategories, fetchProduct, fetchProducts, fetchReviews, fetchStore } from '../../../shop/api';
import { ContactSeller } from '../../../shop/ContactSeller';
import { GalleryViewer } from '../../../shop/GalleryViewer';
import { similarProducts } from '../../../shop/market-logic';
import { ProductCard } from '../../../shop/ProductGrid';
import { toggleCompareProductId, useCompareProductIds } from '../../../shop/compare-store';
import { quantityOf } from '../../../shop/cart-logic';
import { formatMoney } from '../../../shop/format';
import { shopKeys, useCart, useSetCartItem } from '../../../shop/hooks';
import { Stars } from '../../../shop/parts';
import { defaultSelection, findVariant, isValueAvailable, optionAxes, selectValue, type Selection } from '../../../shop/variants';
import { AxisPicker } from '../../../shop/VariantPickers';
import { brandAccent, fonts, onMedia, radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Avatar, EmptyState, ErrorState, Text, Button } from '../../../ui';
import { PressableScale } from '../../../ui/premium';
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
  const similar = useQuery({
    queryKey: ['similar-products', product.data?.categoryId, id],
    queryFn: () => fetchProducts({ categoryId: product.data!.categoryId!, sort: 'recent' }),
    enabled: !!product.data?.categoryId,
    staleTime: 60_000,
  });
  const store = useQuery({ queryKey: ['store-contact', product.data?.org.slug], queryFn: () => fetchStore(product.data!.org.slug), enabled: !!product.data, staleTime: 5 * 60_000 });
  const [gallery, setGallery] = useState(false);
  const cart = useCart();
  const setItem = useSetCartItem();
  const wish = useToggleWish(id);
  const listRef = useRef<FlatList>(null);

  const variants = product.data?.variants;
  const [selection, setSelection] = useState<Selection>({});
  const [qty, setQty] = useState(1);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<'description' | 'specs' | 'reviews'>('description');
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
  const heroH = Math.round(width * 0.95);
  const category = categories.data?.items.find((c) => c.id === p.categoryId)?.name;

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
      <ScrollView contentContainerStyle={{ paddingBottom: 170 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={{ width, height: heroH, backgroundColor: colors.surfaceAlt }}>
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
                <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('mc.gallery.open')} onPress={() => { setPage(index); setGallery(true); }}>
                  <AuthImage
                    contentUrl={item.contentUrl}
                    label={t('product.photo', { n: index + 1, total: p.media.length })}
                    style={{ width, height: heroH, borderRadius: 0, backgroundColor: 'transparent' }}
                  />
                </Pressable>
              )}
            />
          ) : (
            <AuthImage contentUrl={p.coverUrl} label={p.title} style={{ width, height: heroH, borderRadius: 0, backgroundColor: 'transparent' }} />
          )}
          <View style={[styles.topBar, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
            <RoundButton icon="chevron-back" label={t('product.back')} onPress={() => safeBack(router, '/shop')} />
            <View style={styles.topRight}>
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
            </View>
          </View>
          {p.media.length > 1 ? (
            <View style={styles.dots} importantForAccessibility="no-hide-descendants">
              {p.media.map((m, i) => (
                <View key={m.id} style={[styles.dot, i === page ? { width: 18, backgroundColor: colors.text } : { borderWidth: 1, borderColor: colors.textMuted }]} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <Text variant="title" accessibilityRole="header">
                {p.title}
              </Text>
              {price ? <PromoPrice priceMinor={price.priceMinor} compareAtMinor={price.compareAtPriceMinor} currency={price.currency} variant="title" /> : null}
              {price ? <PromoBadge priceMinor={price.priceMinor} compareAtMinor={price.compareAtPriceMinor} /> : null}
              {summary && summary.ratingCount > 0 ? (
                <View style={styles.avgRow} accessible accessibilityLabel={t('product.ratingA11y', { avg: (summary.averageRating ?? 0).toFixed(1), n: summary.ratingCount })}>
                  <View style={styles.ratePill}>
                    <Ionicons name="star" size={12} color="#1D1D1F" />
                    <Text variant="caption" color="#1D1D1F" style={{ fontWeight: '700' }}>
                      {(summary.averageRating ?? 0).toFixed(1)}
                    </Text>
                  </View>
                  <Text variant="caption" muted>
                    {t('mc.mk.reviewsN', { n: summary.ratingCount })}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text variant="small" style={styles.sellerTxt} numberOfLines={2}>
              {t('mc.mk.seller', { name: p.org.name })}
            </Text>
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
              <Text variant="heading">
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
          {room === 0 ? <Text variant="small" muted>{t('product.cartMax')}</Text> : null}

          <View style={styles.tabs} accessibilityRole="tablist">
            {(['description', 'specs', 'reviews'] as const).map((k) => (
              <Pressable
                key={k}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === k }}
                onPress={() => setTab(k)}
                style={[styles.tab, { backgroundColor: tab === k ? brandAccent : 'transparent' }]}
              >
                <Text variant="small" color={tab === k ? '#1D1D1F' : colors.text} numberOfLines={1} style={{ fontWeight: tab === k ? '700' : '500' }}>
                  {k === 'description' ? t('product.description') : k === 'specs' ? t('mc.mk.specs') : t('product.reviews')}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'description' ? (
            p.description ? (
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
            ) : (
              <Text muted>{t('mc.mk.noSpecs')}</Text>
            )
          ) : null}
          {tab === 'specs' ? (
            <View style={styles.group}>
              {[...(category ? [[t('mc.home.categories'), category]] : []), [t('product.shop'), p.org.name], ...axes.map((x) => [x.name, x.values.join(', ')])].map(([k, v]) => (
                <View key={k} style={[styles.spec, { borderBottomColor: colors.border }]}>
                  <Text variant="small" muted style={styles.flex}>
                    {k}
                  </Text>
                  <Text variant="small" style={[styles.flex, { fontWeight: '600' }]}>
                    {v}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {tab === 'reviews' ? (
          <View style={styles.group}>
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
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('product.buy')}
            accessibilityState={{ disabled: !canAdd || setItem.isPending }}
            disabled={!canAdd || setItem.isPending}
            onPress={() => add(true)}
            style={[styles.buyNow, { borderColor: colors.text, opacity: canAdd ? 1 : 0.45 }]}
          >
            <Ionicons name="bag-handle-outline" size={20} color={colors.text} />
            <Text variant="bodyStrong">{t('product.buy')}</Text>
          </Pressable>

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

          <View style={[styles.group, { backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: radius.xl }]}>
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('mc.bulk.title')}
            </Text>
            <Text variant="small" muted>
              {t('mc.bulk.body')}
            </Text>
            <ContactSeller contactUserId={store.data?.contactUserId} labelKey="mc.bulk.ask" />
          </View>

          {similarProducts(similar.data?.items ?? [], p.id).length > 0 ? (
            <View style={styles.group}>
              <Text variant="heading" accessibilityRole="header">
                {t('mc.similar.title')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
                {similarProducts(similar.data?.items ?? [], p.id).map((sp) => (
                  <ProductCard key={sp.id} product={sp} width={156} />
                ))}
              </ScrollView>
            </View>
          ) : null}

        </View>
      </ScrollView>

      <GalleryViewer media={p.media} startIndex={page} visible={gallery} onClose={() => setGallery(false)} />
      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
        {notice ? (
          <View style={[styles.noticeRow, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLiveRegion="polite">
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
        <View style={[styles.actionBar, { borderColor: colors.border }]}>
          <View style={styles.counter}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('product.dec')} accessibilityState={{ disabled: qty <= 1 }} disabled={qty <= 1} onPress={() => setQty(qty - 1)} style={[styles.counterBtn, { opacity: qty <= 1 ? 0.4 : 1 }]}>
              <Ionicons name="remove" size={20} color={onMedia} />
            </Pressable>
            <Text variant="bodyStrong" color={onMedia} style={styles.qtyTxt}>
              {Math.min(qty, Math.max(room, 1))}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('product.inc')} accessibilityState={{ disabled: qty >= Math.max(room, 1) }} disabled={qty >= Math.max(room, 1)} onPress={() => setQty(qty + 1)} style={[styles.counterBtn, { opacity: qty >= Math.max(room, 1) ? 0.4 : 1 }]}>
              <Ionicons name="add" size={20} color={onMedia} />
            </Pressable>
          </View>
          <PressableScale
            accessibilityLabel={t('product.add')}
            accessibilityState={{ disabled: !canAdd || setItem.isPending }}
            disabled={!canAdd || setItem.isPending}
            onPress={() => add()}
            style={[styles.addCart, { opacity: canAdd ? 1 : 0.45 }]}
          >
            <Text color={onMedia} numberOfLines={1} adjustsFontSizeToFit style={styles.addLabel}>
              {t('product.add')}
            </Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

/** Bouton rond translucide posé sur la photo (voile noir uni, icône blanche : contraste AA). */
function RoundButton({ icon, label, onPress, disabled, pressed: on }: { icon: 'chevron-back' | 'chevron-forward' | 'share-outline' | 'heart' | 'heart-outline' | 'git-compare-outline'; label: string; onPress: () => void; disabled?: boolean; pressed?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, ...(on === undefined ? {} : { selected: on }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.round, { backgroundColor: colors.surface, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={icon === 'heart' ? colors.danger : on ? brandAccent : colors.text} />
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
  round: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: spacing.xl + spacing.sm, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ratePill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: brandAccent },
  sellerTxt: { maxWidth: 120, textAlign: 'right', fontWeight: '600', marginTop: spacing.sm },
  tabs: { flexDirection: 'row', gap: spacing.xs },
  tab: { flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  spec: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  buyNow: { minHeight: 52, borderRadius: radius.pill, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  actionBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.pill, backgroundColor: '#0A0A0A', borderWidth: StyleSheet.hairlineWidth },
  counter: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: onMedia },
  counterBtn: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center' },
  qtyTxt: { minWidth: 20, textAlign: 'center' },
  addCart: { flex: 1, minHeight: 56, borderRadius: radius.pill, backgroundColor: brandAccent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  addLabel: { fontSize: 18, lineHeight: 24, fontWeight: '700', fontFamily: fonts.bold },
  sheet: { marginTop: -radius.xxl, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.lg, gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  topRight: { flexDirection: 'row', gap: spacing.sm },
  promoLine: { gap: 2 },
  priceCol: { alignItems: 'flex-end', gap: 2 },
  link: { minHeight: TOUCH, justifyContent: 'center' },
  seller: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.xl, minHeight: TOUCH + 20 },
  visit: { minHeight: TOUCH, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  distLabel: { width: 14, textAlign: 'right' },
  distCount: { width: 28 },
  bar: { flex: 1, height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  barFill: { height: 6 },
  review: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, gap: spacing.sm },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reply: { padding: spacing.md, borderRadius: radius.md, gap: 2 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, gap: spacing.sm },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
