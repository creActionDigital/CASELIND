import { Ionicons } from '@expo/vector-icons';
import type { Product, Variant } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { adjustStock, fetchProducts, sk, useMembership } from '../../../../seller/api';
import { canAdjustStock } from '../../../../seller/permissions';
import { Card, Chips, PagedList, sellerErrorMessage } from '../../../../seller/ui';
import { radius, spacing, TOUCH } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Text, TextField } from '../../../../ui';

type Reason = 'restock' | 'adjustment' | 'damage';
type Page = { items: Product[]; nextCursor: string | null };

/** Ajustement rapide du stock par variante : motif et quantité en tête, puis − / + sur chaque ligne. */
export default function SellerStock() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role } = useMembership(orgId);
  const [reason, setReason] = useState<Reason>('restock');
  const [qty, setQty] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const editable = canAdjustStock(role);
  const amount = /^\d{1,6}$/.test(qty.trim()) && Number(qty) > 0 ? Number(qty) : null;

  const key = [...sk.products(orgId), 'stock'];
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchProducts(orgId, undefined, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const adjust = useMutation({
    mutationFn: ({ variantId, delta }: { variantId: string; delta: number }) => adjustStock(orgId, variantId, delta, reason),
    onMutate: () => setError(null),
    onSuccess: (v: Variant) => {
      qc.setQueryData<InfiniteData<Page>>(key, (d) =>
        d && {
          ...d,
          pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((p) => ({ ...p, variants: p.variants.map((x) => (x.id === v.id ? v : x)) })) })),
        },
      );
      void qc.invalidateQueries({ queryKey: sk.count(orgId, 'published-products') });
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });

  return (
    <>
      <Stack.Screen options={{ title: t('seller.stock') }} />
      <PagedList<Product>
        query={q}
        keyExtractor={(p) => p.id}
        transform={(items) => items.filter((p) => p.status !== 'archived')}
        header={
          <View style={{ paddingTop: spacing.sm }}>
            {editable ? (
              <>
                <Chips
                  options={(['restock', 'adjustment', 'damage'] as Reason[]).map((r) => ({ value: r, label: t(`seller.stock.reason.${r}` as MessageKey) }))}
                  value={reason}
                  onChange={setReason}
                />
                <View style={{ paddingHorizontal: spacing.lg }}>
                  <TextField
                    label={t('seller.stock.quantity')}
                    value={qty}
                    onChangeText={setQty}
                    keyboardType="number-pad"
                    error={amount === null ? t('seller.stock.quantityInvalid') : null}
                  />
                </View>
              </>
            ) : (
              <Text variant="small" muted style={{ paddingHorizontal: spacing.lg }}>
                {t('seller.stock.readOnly')}
              </Text>
            )}
            {error ? (
              <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ paddingHorizontal: spacing.lg }}>
                {error}
              </Text>
            ) : null}
          </View>
        }
        empty={{ icon: 'layers-outline', title: t('seller.stock.emptyTitle'), body: t('seller.products.emptyBody') }}
        renderItem={({ item: p }) => (
          <Card>
            <Text variant="bodyStrong" numberOfLines={2}>
              {p.title}
            </Text>
            {p.variants.map((v) => {
              const opts = Object.values(v.options).join(' / ');
              const busy = adjust.isPending && adjust.variables?.variantId === v.id;
              return (
                <View key={v.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text variant="small" numberOfLines={1}>
                      {v.sku}
                      {opts ? ` · ${opts}` : ''}
                    </Text>
                    {v.trackStock ? (
                      <Text variant="caption" color={v.stock <= 0 ? colors.danger : colors.textMuted}>
                        {v.stock <= 0 ? t('seller.product.outOfStock') : t('seller.stock.units', { n: v.stock })}
                      </Text>
                    ) : (
                      <Badge tone="neutral" label={t('seller.stock.untracked')} />
                    )}
                  </View>
                  {v.trackStock && editable ? (
                    <View style={styles.stepper}>
                      <Step label={t('seller.stock.decrease')} sign="remove" disabled={busy || amount === null || v.stock - (amount ?? 0) < 0} onPress={() => adjust.mutate({ variantId: v.id, delta: -amount! })} />
                      <Text variant="bodyStrong" style={{ minWidth: 36, textAlign: 'center' }}>
                        {v.stock}
                      </Text>
                      <Step label={t('seller.stock.increase')} sign="add" disabled={busy || amount === null} onPress={() => adjust.mutate({ variantId: v.id, delta: amount! })} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Card>
        )}
      />
    </>
  );
}

function Step({ label, sign, disabled, onPress }: { label: string; sign: 'add' | 'remove'; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.step, { backgroundColor: colors.primarySoft, opacity: disabled ? 0.4 : 1 }]}
    >
      <Ionicons name={sign} size={22} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH + 8, paddingTop: spacing.xs },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  step: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
