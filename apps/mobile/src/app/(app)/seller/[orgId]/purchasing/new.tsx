import type { Product, PurchaseOrderLineInput } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { bk, createPurchaseOrder, fetchSuppliers } from '../../../../../business/api';
import { businessErrorMessage } from '../../../../../business/errors';
import { buildPoLine, emptyLineForm, isValidDate, poTotal, type LineForm } from '../../../../../business/logic';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { fetchProducts, sk, useMembership } from '../../../../../seller/api';
import { formatMinor, SELLER_CURRENCIES, type SellerCurrency } from '../../../../../seller/money';
import { can } from '../../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

interface DraftLine {
  input: PurchaseOrderLineInput;
  label: string;
}

const variantText = (p: Product, v: Product['variants'][number]) => {
  const opts = Object.values(v.options).join(' / ');
  return opts ? `${p.title} (${opts})` : p.title;
};

/** Nouveau bon de commande d'achat (brouillon) : fournisseur, devise, lignes (article du catalogue ou description libre). */
export default function NewPurchaseOrder() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const allowed = can(role, 'inventory.manage');
  const [supplierId, setSupplierId] = useState('');
  const [currency, setCurrency] = useState<SellerCurrency>('USD');
  const [expectedOn, setExpectedOn] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [line, setLine] = useState<LineForm>(emptyLineForm());
  const [productId, setProductId] = useState('');
  const [info, setInfo] = useState<string | null>(null);

  const suppliers = useQuery({ queryKey: [...bk.suppliers(orgId), 'active'], queryFn: () => fetchSuppliers(orgId, undefined, true, 100), enabled: allowed });
  const products = useInfiniteQuery({
    queryKey: [...sk.products(orgId), 'published'],
    queryFn: ({ pageParam }) => fetchProducts(orgId, 'published', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: allowed,
  });

  const create = useMutation({
    mutationFn: () => {
      if (lines.length === 0) throw new Error('noLines');
      if (expectedOn.trim() && !isValidDate(expectedOn.trim())) throw new Error('expected');
      return createPurchaseOrder(orgId, {
        supplierId,
        currency,
        ...(expectedOn.trim() ? { expectedOn: expectedOn.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        lines: lines.map((l) => l.input),
      });
    },
    onSuccess: (po) => {
      void qc.invalidateQueries({ queryKey: bk.orders(orgId) });
      router.replace(`/seller/${orgId}/purchasing/${po.id}` as never);
    },
    onError: (e) => {
      const m = e instanceof Error ? e.message : '';
      if (m === 'noLines') setInfo(t('biz.po.noLines'));
      else if (m === 'expected') setInfo(t('biz.po.err.expected'));
      else setInfo(businessErrorMessage(e, t, locale));
    },
  });

  const title = <Stack.Screen options={{ title: t('biz.po.new') }} />;
  if (isPending || suppliers.isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('biz.purchasing.forbidden')}</Text></Screen></>;
  if (suppliers.isError) return <>{title}<ErrorState error={suppliers.error} onRetry={() => suppliers.refetch()} /></>;

  const activeSuppliers = suppliers.data.items.filter((s) => s.active);
  const productItems = (products.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => p.variants.some((v) => v.active && v.currency === currency));
  const picked = productItems.find((p) => p.id === productId);
  const set = (patch: Partial<LineForm>) => setLine((f) => ({ ...f, ...patch }));
  const changeCurrency = (c: SellerCurrency) => {
    // Les articles sont filtrés par devise : un changement vide la sélection en cours.
    setCurrency(c);
    setProductId('');
    setLine(emptyLineForm());
    setLines([]);
  };
  const addLine = () => {
    const built = buildPoLine(line, currency);
    if ('error' in built) {
      setInfo(t(`biz.po.err.${built.error}` as MessageKey));
      return;
    }
    setInfo(null);
    setLines((ls) => [...ls, { input: built.ok, label: line.description.trim() || built.ok.description || '' }]);
    setLine(emptyLineForm());
    setProductId('');
  };

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Text variant="bodyStrong">{t('biz.po.supplier')}</Text>
          {activeSuppliers.length === 0 ? <Text muted>{t('biz.po.noSupplier')}</Text> : null}
          <Chips options={activeSuppliers.map((s) => ({ value: s.id, label: s.name }))} value={supplierId || null} onChange={setSupplierId} />
          <Text variant="bodyStrong">{t('biz.po.currency')}</Text>
          <Chips options={SELLER_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={changeCurrency} scroll={false} />
          <TextField label={t('biz.po.expected')} value={expectedOn} onChangeText={setExpectedOn} autoCapitalize="none" maxLength={10} />
          <TextField label={t('biz.po.note')} value={note} onChangeText={setNote} maxLength={500} />

          <SectionTitle>{t('biz.po.lines')}</SectionTitle>
          {lines.map((l, i) => (
            <Card key={`${i}-${l.label}`}>
              <Text variant="bodyStrong" numberOfLines={2}>{l.label}</Text>
              <Text variant="small" muted>{t('biz.po.line', { qty: l.input.quantity, cost: formatMinor(l.input.unitCostMinor, currency, locale) })}</Text>
              <Button variant="secondary" label={t('biz.po.removeLine')} onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
            </Card>
          ))}
          {lines.length > 0 ? <Text variant="bodyStrong">{t('biz.po.total', { amount: formatMinor(poTotal(lines.map((l) => l.input)), currency, locale) })}</Text> : null}

          <Text variant="bodyStrong">{t('biz.po.pickProduct')}</Text>
          {products.isPending ? <Loading /> : null}
          {products.isError ? <ErrorState error={products.error} onRetry={() => products.refetch()} /> : null}
          {products.isSuccess && productItems.length === 0 ? <Text muted>{t('biz.po.noCatalogue')}</Text> : null}
          <Chips options={productItems.map((p) => ({ value: p.id, label: p.title }))} value={productId || null} onChange={(id) => { setProductId(id); set({ variantId: '', description: '' }); }} />
          {products.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={products.isFetchingNextPage} onPress={() => products.fetchNextPage()} /> : null}
          {picked ? (
            <>
              <Text variant="bodyStrong">{t('biz.po.pickVariant')}</Text>
              <Chips
                options={picked.variants.filter((v) => v.active && v.currency === currency).map((v) => ({ value: v.id, label: Object.values(v.options).join(' / ') || v.sku }))}
                value={line.variantId || null}
                onChange={(id) => {
                  const v = picked.variants.find((x) => x.id === id)!;
                  set({ variantId: id, description: variantText(picked, v) });
                }}
              />
            </>
          ) : null}
          <TextField label={t('biz.po.description')} value={line.description} onChangeText={(v) => set({ description: v })} maxLength={120} />
          <TextField label={t('biz.po.quantity')} value={line.quantity} onChangeText={(v) => set({ quantity: v })} keyboardType="number-pad" />
          <TextField label={t('biz.po.unitCost', { currency })} value={line.unitCost} onChangeText={(v) => set({ unitCost: v })} keyboardType="decimal-pad" />
          <Button variant="secondary" label={t('biz.po.addLine')} onPress={addLine} />

          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
          <Button label={t('biz.po.create')} loading={create.isPending} disabled={!supplierId} onPress={() => { setInfo(null); create.mutate(); }} />
        </View>
      </Screen>
    </>
  );
}
