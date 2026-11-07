import type { Coupon } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { deactivateCoupon, fetchCoupons, sk, useMembership } from '../../../../../seller/api';
import { formatMinor } from '../../../../../seller/money';
import { can } from '../../../../../seller/permissions';
import { Card, PagedList, sellerErrorMessage } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, IconButton, Text } from '../../../../../ui';

/** Coupons de l'organisation : liste, création, désactivation (avec confirmation). */
export default function SellerCoupons() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role } = useMembership(orgId);
  const canManage = can(role, 'orders.manage');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useInfiniteQuery({
    queryKey: sk.coupons(orgId),
    queryFn: ({ pageParam }) => fetchCoupons(orgId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: canManage,
  });
  const off = useMutation({
    mutationFn: (id: string) => deactivateCoupon(orgId, id),
    onMutate: () => setError(null),
    onSuccess: () => {
      setConfirmId(null);
      void qc.invalidateQueries({ queryKey: sk.coupons(orgId) });
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });
  const create = () => router.push({ pathname: '/seller/[orgId]/coupons/new', params: { orgId } });
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <>
      <Stack.Screen
        options={{
          title: t('seller.coupons'),
          headerRight: () => (canManage ? <IconButton icon="add" label={t('seller.coupon.new')} onPress={create} /> : null),
        }}
      />
      <PagedList<Coupon>
        query={q}
        keyExtractor={(c) => c.id}
        header={
          error ? (
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ padding: spacing.lg }}>
              {error}
            </Text>
          ) : undefined
        }
        empty={{ icon: 'ticket-outline', title: t('seller.coupons.emptyTitle'), body: t('seller.coupons.emptyBody'), actionLabel: t('seller.coupon.new'), onAction: create }}
        renderItem={({ item: c }) => {
          const value = c.kind === 'percent' ? `${c.value} %` : formatMinor(c.value, c.currency ?? 'USD', locale);
          return (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {c.code} · {value}
                </Text>
                <Badge tone={c.active ? 'primary' : 'neutral'} label={c.active ? t('seller.coupon.active') : t('seller.coupon.inactive')} />
              </View>
              <Text variant="small" muted>
                {t('seller.coupon.uses', { n: c.usesCount, max: c.maxUses ?? '∞' })}
                {c.minOrderMinor > 0 ? ` · ${t('seller.coupon.minShort', { amount: formatMinor(c.minOrderMinor, c.currency ?? 'USD', locale) })}` : ''}
              </Text>
              {c.startsAt || c.endsAt ? (
                <Text variant="small" muted>
                  {c.startsAt ? day(c.startsAt) : '…'} → {c.endsAt ? day(c.endsAt) : '…'}
                </Text>
              ) : null}
              {c.active && canManage ? (
                confirmId === c.id ? (
                  <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                    <Text variant="small">{t('seller.coupon.deactivateBody')}</Text>
                    <Button variant="danger" label={t('seller.coupon.deactivate')} loading={off.isPending} onPress={() => off.mutate(c.id)} />
                    <Button variant="secondary" label={t('common.cancel')} onPress={() => setConfirmId(null)} />
                  </View>
                ) : (
                  <Button variant="ghost" label={t('seller.coupon.deactivate')} onPress={() => setConfirmId(c.id)} />
                )
              ) : null}
            </Card>
          );
        }}
      />
    </>
  );
}
