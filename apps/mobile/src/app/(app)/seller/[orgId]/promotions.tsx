import type { Product, Promotion } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { alertConfirm } from '../../../../lib/confirm';
import { createPromotion, deletePromotion, fetchOrgPromotions, patchPromotion, promoKeys } from '../../../../promotions/api';
import { buildPromotion, emptyPromotionForm, type PromotionForm } from '../../../../promotions/logic';
import { fetchProducts, sk, useMembership } from '../../../../seller/api';
import { formatMinor } from '../../../../seller/money';
import { can } from '../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle, sellerErrorMessage } from '../../../../seller/ui';
import { formatWhen } from '../../../../vitrine/updates-logic';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

const variantLabel = (v: Product['variants'][number]) => Object.values(v.options).join(' / ') || v.sku;

/** « Promotions » (permission `catalog.manage`) : promotions et ventes flash sur les produits de la boutique. */
export default function SellerPromotions() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const [form, setForm] = useState<PromotionForm>(emptyPromotionForm());
  const [info, setInfo] = useState<string | null>(null);

  const products = useInfiniteQuery({
    queryKey: [...sk.products(orgId), 'published'],
    queryFn: ({ pageParam }) => fetchProducts(orgId, 'published', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const list = useInfiniteQuery({
    queryKey: promoKeys.org(orgId),
    queryFn: ({ pageParam }) => fetchOrgPromotions(orgId, undefined, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: promoKeys.org(orgId) });
    void qc.invalidateQueries({ queryKey: ['shop-products'] });
  };
  const fail = (e: unknown) => {
    if (e instanceof ApiRequestError && e.status === 409 && e.detail<string>('reason') === 'promotion_overlap') setInfo(t('seller.promo.err.overlap'));
    else if (e instanceof ApiRequestError && e.status === 409 && e.detail<string>('reason') === 'promotion_stopped') setInfo(t('seller.promo.err.stopped'));
    else setInfo(sellerErrorMessage(e, t, locale));
  };
  const create = useMutation({
    mutationFn: () => {
      const built = buildPromotion(form);
      if ('error' in built) throw new Error(built.error);
      return createPromotion(orgId, built.ok);
    },
    onSuccess: () => {
      setForm(emptyPromotionForm());
      setInfo(null);
      refresh();
    },
    onError: (e) => {
      const m = e instanceof Error ? e.message : '';
      if (/^(product|value|valueFixed|label|startsAt|endsAt|endBeforeStart|tooLong|past|cap)$/.test(m)) setInfo(t(`seller.promo.err.${m}` as MessageKey));
      else fail(e);
    },
  });
  const stop = useMutation({ mutationFn: (id: string) => patchPromotion(orgId, id, { active: false }), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => deletePromotion(orgId, id), onSuccess: refresh, onError: fail });

  const title = <Stack.Screen options={{ title: t('seller.promo.title') }} />;
  if (isPending || list.isPending || products.isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (list.isError) return <>{title}<ErrorState error={list.error} onRetry={() => list.refetch()} /></>;
  if (!can(role, 'catalog.manage')) return <>{title}<Screen><Text muted>{t('seller.promo.forbidden')}</Text></Screen></>;

  const productItems = products.data?.pages.flatMap((p) => p.items) ?? [];
  const promotions = list.data.pages.flatMap((p) => p.items);
  const picked = productItems.find((p) => p.id === form.productId);
  const set = (patch: Partial<PromotionForm>) => setForm((f) => ({ ...f, ...patch }));
  const pickProduct = (p: Product) => {
    const open = p.variants.filter((v) => v.active);
    set({ productId: p.id, variantId: '', currency: open[0]?.currency ?? 'USD', basePriceMinor: Math.min(...open.map((v) => v.priceMinor)) });
  };
  const pickVariant = (variantId: string) => {
    const open = (picked?.variants ?? []).filter((v) => v.active && (!variantId || v.id === variantId));
    set({ variantId, basePriceMinor: open.length ? Math.min(...open.map((v) => v.priceMinor)) : 0 });
  };
  const confirmDelete = (p: Promotion) =>
    alertConfirm(p.productTitle, p.label, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('seller.promo.delete'), style: 'destructive', onPress: () => remove.mutate(p.id) },
    ]);
  const valueLabel = (p: Promotion) => (p.kind === 'percent' ? `-${p.value} %` : formatMinor(p.value, p.currency, locale));

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <SectionTitle>{t('seller.promo.new')}</SectionTitle>
          <Text variant="bodyStrong">{t('seller.promo.pickProduct')}</Text>
          {productItems.length === 0 ? <Text muted>{t('seller.promo.noProducts')}</Text> : null}
          <Chips options={productItems.map((p) => ({ value: p.id, label: p.title }))} value={form.productId || null} onChange={(id) => pickProduct(productItems.find((p) => p.id === id)!)} />
          {products.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={products.isFetchingNextPage} onPress={() => products.fetchNextPage()} /> : null}
          {picked && picked.variants.filter((v) => v.active).length > 1 ? (
            <>
              <Text variant="bodyStrong">{t('seller.promo.variant')}</Text>
              <Chips
                options={[{ value: '', label: t('seller.promo.wholeProduct') }, ...picked.variants.filter((v) => v.active).map((v) => ({ value: v.id, label: variantLabel(v) }))]}
                value={form.variantId}
                onChange={pickVariant}
              />
            </>
          ) : null}
          <Chips
            options={(['percent', 'fixed_price'] as const).map((k) => ({ value: k, label: t(`seller.promo.kind.${k}` as MessageKey) }))}
            value={form.kind}
            onChange={(kind) => set({ kind, value: '' })}
            scroll={false}
          />
          <TextField
            label={form.kind === 'percent' ? t('seller.promo.valuePercent') : t('seller.promo.valueFixed', { currency: form.currency })}
            value={form.value}
            onChangeText={(v) => set({ value: v })}
            keyboardType="decimal-pad"
          />
          <TextField label={t('seller.promo.label')} value={form.label} onChangeText={(v) => set({ label: v })} maxLength={40} />
          <TextField label={t('seller.promo.starts')} value={form.startsAt} onChangeText={(v) => set({ startsAt: v })} maxLength={16} autoCapitalize="none" />
          <TextField label={t('seller.promo.ends')} value={form.endsAt} onChangeText={(v) => set({ endsAt: v })} maxLength={16} autoCapitalize="none" />
          <TextField label={t('seller.promo.cap')} value={form.stockCap} onChangeText={(v) => set({ stockCap: v })} keyboardType="number-pad" />
          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
          <Button label={t('seller.promo.create')} loading={create.isPending} onPress={() => { setInfo(null); create.mutate(); }} />

          <SectionTitle>{t('seller.promo.title')}</SectionTitle>
          {promotions.length === 0 ? <Text muted>{t('seller.promo.empty')}</Text> : null}
          {promotions.map((p) => (
            <Card key={p.id}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Badge label={t(`seller.promo.status.${p.status}` as MessageKey)} tone={p.status === 'active' ? 'accent' : 'neutral'} />
                <Text variant="bodyStrong">{p.label}</Text>
              </View>
              <Text numberOfLines={2}>{p.productTitle}</Text>
              <Text variant="small" muted>{`${valueLabel(p)} · ${formatWhen(p.startsAt)} → ${formatWhen(p.endsAt)}`}</Text>
              <Text variant="small" muted>{p.stockCap ? t('seller.promo.soldCap', { sold: p.soldCount, cap: p.stockCap }) : t('seller.promo.sold', { sold: p.soldCount })}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {p.status === 'active' || p.status === 'scheduled' ? (
                  <Button variant="secondary" label={t('seller.promo.stop')} loading={stop.isPending && stop.variables === p.id} onPress={() => stop.mutate(p.id)} />
                ) : null}
                <Button variant="secondary" label={t('seller.promo.delete')} loading={remove.isPending && remove.variables === p.id} onPress={() => confirmDelete(p)} />
              </View>
            </Card>
          ))}
          {list.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} /> : null}
        </View>
      </Screen>
    </>
  );
}
