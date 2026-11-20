import type { PurchaseOrder, Supplier } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { bk, createSupplier, deleteSupplier, fetchPurchaseOrders, fetchSuppliers, patchSupplier } from '../../../../../business/api';
import { businessErrorMessage } from '../../../../../business/errors';
import { buildSupplier, emptySupplierForm, PO_TONE, type SupplierForm } from '../../../../../business/logic';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { alertConfirm } from '../../../../../lib/confirm';
import { useMembership } from '../../../../../seller/api';
import { formatMinor } from '../../../../../seller/money';
import { can } from '../../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

type Tab = 'orders' | 'suppliers';

/** « Achats » (permission `inventory.manage`) : bons de commande d'achat et fournisseurs. Enregistrements de gestion, aucun paiement. */
export default function SellerPurchasing() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const allowed = can(role, 'inventory.manage');
  const [tab, setTab] = useState<Tab>('orders');
  const [form, setForm] = useState<SupplierForm>(emptySupplierForm());
  const [info, setInfo] = useState<string | null>(null);

  const orders = useInfiniteQuery({
    queryKey: bk.orders(orgId),
    queryFn: ({ pageParam }) => fetchPurchaseOrders(orgId, undefined, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: allowed,
  });
  const suppliers = useInfiniteQuery({
    queryKey: bk.suppliers(orgId),
    queryFn: ({ pageParam }) => fetchSuppliers(orgId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: allowed,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['business', orgId] });
  const fail = (e: unknown) => setInfo(businessErrorMessage(e, t, locale));

  const add = useMutation({
    mutationFn: () => {
      const built = buildSupplier(form);
      if ('error' in built) throw new Error(built.error);
      return createSupplier(orgId, built.ok);
    },
    onSuccess: () => {
      setForm(emptySupplierForm());
      setInfo(null);
      refresh();
    },
    onError: (e) => {
      const m = e instanceof Error ? e.message : '';
      if (m === 'name' || m === 'phone' || m === 'email') setInfo(t(`biz.supplier.err.${m}` as MessageKey));
      else fail(e);
    },
  });
  const toggle = useMutation({ mutationFn: (s: Supplier) => patchSupplier(orgId, s.id, { active: !s.active }), onSuccess: refresh, onError: fail });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSupplier(orgId, id),
    onSuccess: (r) => {
      setInfo(r.outcome === 'deactivated' ? t('biz.supplier.wasDeactivated') : null);
      refresh();
    },
    onError: fail,
  });

  const title = <Stack.Screen options={{ title: t('biz.purchasing.title') }} />;
  if (isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('biz.purchasing.forbidden')}</Text></Screen></>;

  const set = (patch: Partial<SupplierForm>) => setForm((f) => ({ ...f, ...patch }));
  const confirmDelete = (s: Supplier) =>
    alertConfirm(t('biz.supplier.deleteTitle'), `${s.name}\n${t('biz.supplier.deleteBody')}`, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('biz.supplier.delete'), style: 'destructive', onPress: () => remove.mutate(s.id) },
    ]);

  const poItems: PurchaseOrder[] = orders.data?.pages.flatMap((p) => p.items) ?? [];
  const supplierItems: Supplier[] = suppliers.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Chips
            options={[
              { value: 'orders' as Tab, label: t('biz.tab.orders') },
              { value: 'suppliers' as Tab, label: t('biz.tab.suppliers') },
            ]}
            value={tab}
            onChange={setTab}
            scroll={false}
          />
          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}

          {tab === 'orders' ? (
            <>
              <Button label={t('biz.po.new')} onPress={() => router.push(`/seller/${orgId}/purchasing/new` as never)} />
              {orders.isPending ? <Loading /> : null}
              {orders.isError ? <ErrorState error={orders.error} onRetry={() => orders.refetch()} /> : null}
              {orders.isSuccess && poItems.length === 0 ? <Text muted>{t('biz.po.empty')}</Text> : null}
              {poItems.map((po) => (
                <Card key={po.id} onPress={() => router.push(`/seller/${orgId}/purchasing/${po.id}` as never)} label={`${po.number} ${po.supplierName}`}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <Badge label={t(`biz.po.status.${po.status}` as MessageKey)} tone={PO_TONE[po.status]} />
                    <Text variant="bodyStrong">{po.number}</Text>
                  </View>
                  <Text numberOfLines={1}>{po.supplierName}</Text>
                  <Text variant="small" muted>{formatMinor(po.totalMinor, po.currency, locale)}</Text>
                </Card>
              ))}
              {orders.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={orders.isFetchingNextPage} onPress={() => orders.fetchNextPage()} /> : null}
            </>
          ) : (
            <>
              <SectionTitle>{t('biz.supplier.new')}</SectionTitle>
              <TextField label={t('biz.supplier.name')} value={form.name} onChangeText={(v) => set({ name: v })} maxLength={120} />
              <TextField label={t('biz.supplier.contact')} value={form.contactName} onChangeText={(v) => set({ contactName: v })} maxLength={120} />
              <TextField label={t('biz.supplier.phone')} value={form.phone} onChangeText={(v) => set({ phone: v })} keyboardType="phone-pad" autoCapitalize="none" />
              <TextField label={t('biz.supplier.email')} value={form.email} onChangeText={(v) => set({ email: v })} keyboardType="email-address" autoCapitalize="none" />
              <TextField label={t('biz.supplier.address')} value={form.address} onChangeText={(v) => set({ address: v })} maxLength={300} />
              <TextField label={t('biz.supplier.notes')} value={form.notes} onChangeText={(v) => set({ notes: v })} maxLength={500} />
              <Button label={t('biz.supplier.add')} loading={add.isPending} onPress={() => { setInfo(null); add.mutate(); }} />
              <SectionTitle>{t('biz.tab.suppliers')}</SectionTitle>
              {suppliers.isPending ? <Loading /> : null}
              {suppliers.isError ? <ErrorState error={suppliers.error} onRetry={() => suppliers.refetch()} /> : null}
              {suppliers.isSuccess && supplierItems.length === 0 ? <Text muted>{t('biz.supplier.empty')}</Text> : null}
              {supplierItems.map((s) => (
                <Card key={s.id}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{s.name}</Text>
                    {s.active ? null : <Badge label={t('biz.supplier.inactive')} tone="neutral" />}
                  </View>
                  {s.contactName ? <Text variant="small" muted>{s.contactName}</Text> : null}
                  {s.phone ? <Text variant="small" muted>{s.phone}</Text> : null}
                  {s.email ? <Text variant="small" muted>{s.email}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                    <Button variant="secondary" label={s.active ? t('biz.supplier.deactivate') : t('biz.supplier.activate')} loading={toggle.isPending && toggle.variables?.id === s.id} onPress={() => toggle.mutate(s)} />
                    <Button variant="secondary" label={t('biz.supplier.delete')} loading={remove.isPending && remove.variables === s.id} onPress={() => confirmDelete(s)} />
                  </View>
                </Card>
              ))}
              {suppliers.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={suppliers.isFetchingNextPage} onPress={() => suppliers.fetchNextPage()} /> : null}
            </>
          )}
        </View>
      </Screen>
    </>
  );
}
