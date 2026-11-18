import type { PosSale, Product } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { uuidv4 } from '../../../../lib/uuid';
import { createPosSale, fetchPosSales, fetchPosSummary } from '../../../../pos/api';
import { ShiftPanel } from '../../../../pos/ShiftPanel';
import { TicketCard } from '../../../../pos/TicketCard';
import { fetchProducts, sk } from '../../../../seller/api';
import { formatMinor } from '../../../../seller/money';
import { Card, Chips, PagedList, sellerErrorMessage } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, Text } from '../../../../ui';

type Method = PosSale['paymentMethod'];
const METHODS: Method[] = ['cash', 'mobile_money', 'card'];

/** Caisse : le vendeur compose la vente au comptoir ; le stock baisse, aucun argent ne transite par CASELIND. */
export default function Pos() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [cart, setCart] = useState<Record<string, { qty: number; title: string; price: number; currency: string }>>({});
  const [method, setMethod] = useState<Method>('cash');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  // Une même clé tant que le panier ne change pas : un nouvel appui après un échec réseau ne double pas la vente.
  const clientId = useRef(uuidv4());

  const products = useInfiniteQuery({
    queryKey: [...sk.products(orgId), 'pos'],
    queryFn: ({ pageParam }) => fetchProducts(orgId, 'published', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const summary = useQuery({ queryKey: ['seller', orgId, 'pos-summary'], queryFn: () => fetchPosSummary(orgId) });
  const history = useQuery({ queryKey: ['seller', orgId, 'pos-sales'], queryFn: () => fetchPosSales(orgId, 5) });

  const lines = Object.entries(cart).filter(([, l]) => l.qty > 0);
  const currencies = new Set(lines.map(([, l]) => l.currency));
  const mixed = currencies.size > 1;
  const currency = [...currencies][0] ?? 'USD';
  const total = lines.reduce((s, [, l]) => s + l.price * l.qty, 0);
  const count = lines.reduce((s, [, l]) => s + l.qty, 0);

  const change = (id: string, v: { title: string; price: number; currency: string }, delta: number) => {
    setDone(null);
    clientId.current = uuidv4();
    setCart((c) => ({ ...c, [id]: { ...v, qty: Math.max(0, (c[id]?.qty ?? 0) + delta) } }));
  };

  const sell = useMutation({
    mutationFn: () => createPosSale(orgId, { clientId: clientId.current, paymentMethod: method, lines: lines.map(([variantId, l]) => ({ variantId, quantity: l.qty })) }),
    onSuccess: (s) => {
      setCart({});
      setError(null);
      clientId.current = uuidv4();
      setDone(t('pos.done', { total: formatMinor(s.totalMinor, s.currency, locale) }));
      setTicketId(s.id);
      void qc.invalidateQueries({ queryKey: ['seller', orgId, 'pos-shift'] });
      void qc.invalidateQueries({ queryKey: sk.products(orgId) });
      void qc.invalidateQueries({ queryKey: ['seller', orgId, 'pos-summary'] });
      void qc.invalidateQueries({ queryKey: ['seller', orgId, 'pos-sales'] });
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });

  return (
    <>
      <Stack.Screen options={{ title: t('pos.title') }} />
      <PagedList<Product>
        query={products}
        keyExtractor={(p) => p.id}
        header={
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm }}>
            <Text variant="bodyStrong">{t('pos.today')}</Text>
            {summary.data && summary.data.items.length > 0 ? (
              summary.data.items.map((r) => (
                <Text key={r.currency} variant="small" accessibilityLiveRegion="polite">
                  {formatMinor(r.totalMinor, r.currency, locale)} · {t('pos.sales', { n: r.salesCount })} · {METHODS.map((m) => `${t(`pos.method.${m}` as const)} ${formatMinor(r.byMethod[m], r.currency, locale)}`).join(' · ')}
                </Text>
              ))
            ) : (
              <Text variant="small" muted>{t('pos.todayNone')}</Text>
            )}
            <ShiftPanel orgId={orgId} />
            <Chips options={METHODS.map((m) => ({ value: m, label: t(`pos.method.${m}` as const) }))} value={method} onChange={setMethod} />
            <Text variant="caption" muted>{t('pos.methodHint')}</Text>
            <Text variant="bodyStrong" accessibilityLiveRegion="polite">{t('pos.cart', { n: count, total: formatMinor(total, currency, locale) })}</Text>
            {mixed ? <Text variant="small" color={colors.danger}>{t('pos.mixed')}</Text> : null}
            {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
            {done ? <Text variant="small" accessibilityLiveRegion="polite">{done}</Text> : null}
            <Button label={t('pos.sell')} loading={sell.isPending} disabled={count === 0 || mixed} onPress={() => { setError(null); sell.mutate(); }} />
            {ticketId ? <TicketCard key={ticketId} orgId={orgId} saleId={ticketId} onClose={() => setTicketId(null)} /> : null}
          </View>
        }
        empty={{ icon: 'cash-outline', title: t('pos.empty') }}
        renderItem={({ item: p }) => (
          <Card>
            <Text variant="bodyStrong" numberOfLines={2}>{p.title}</Text>
            {p.variants.filter((v) => v.active).map((v) => {
              const opts = Object.values(v.options).join(' / ');
              const title = opts ? `${p.title} (${opts})` : p.title;
              const qty = cart[v.id]?.qty ?? 0;
              const soldOut = v.trackStock && v.stock <= qty;
              const info = { title, price: v.priceMinor, currency: v.currency };
              return (
                <View key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm }}>
                  <Text style={{ flex: 1 }}>{opts || v.sku} · {formatMinor(v.priceMinor, v.currency, locale)}{v.trackStock && v.stock <= 0 ? ` · ${t('pos.outOfStock')}` : ''}</Text>
                  <Button variant="secondary" label="−" accessibilityLabel={t('pos.remove', { title })} disabled={qty === 0} onPress={() => change(v.id, info, -1)} />
                  <Text accessibilityLabel={String(qty)}>{qty}</Text>
                  <Button variant="secondary" label="+" accessibilityLabel={t('pos.add', { title })} disabled={soldOut} onPress={() => change(v.id, info, 1)} />
                </View>
              );
            })}
          </Card>
        )}
      />
      {history.data && history.data.items.length > 0 ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
          <Text variant="caption" muted>{t('pos.history')}</Text>
          {history.data.items.map((s) => (
            <Pressable key={s.id} accessibilityRole="button" onPress={() => setTicketId(s.id)} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text variant="small">{new Date(s.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} · {formatMinor(s.totalMinor, s.currency, locale)} · {t(`pos.method.${s.paymentMethod}` as const)}{s.voidedAt ? ` · ${t('pos.voidedTag')}` : ''}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );
}
