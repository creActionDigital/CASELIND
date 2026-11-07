import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useI18n } from '../../../../../i18n';
import { createCoupon, sk } from '../../../../../seller/api';
import { toCouponRequest, validateCoupon, type CouponDraft, type CouponField } from '../../../../../seller/coupon-form';
import { SELLER_CURRENCIES } from '../../../../../seller/money';
import { Chips, sellerErrorMessage } from '../../../../../seller/ui';
import { useTheme } from '../../../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../../../ui';

/** Nouveau coupon : pourcentage (1-90) ou montant fixe, minimum, dates AAAA-MM-JJ, limites d'usage. */
export default function NewCoupon() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [d, setD] = useState<CouponDraft>({ code: '', kind: 'percent', value: '', currency: 'USD', min: '', startsAt: '', endsAt: '', maxUses: '', maxUsesPerUser: '' });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateCoupon(d);
  const set = (patch: Partial<CouponDraft>) => setD((cur) => ({ ...cur, ...patch }));
  const err = (f: CouponField): string | null => {
    const e = errors[f];
    if (!submitted || !e) return null;
    if (f === 'code') return t('seller.coupon.err.code');
    if (e === 'range') return t(f === 'value' ? 'seller.coupon.err.valueRange' : 'seller.coupon.err.endsRange');
    return t('seller.coupon.err.invalid');
  };

  const create = useMutation({
    mutationFn: () => createCoupon(orgId, toCouponRequest(d)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sk.coupons(orgId) });
      router.back();
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });

  function submit() {
    setSubmitted(true);
    setError(null);
    if (Object.keys(errors).length === 0) create.mutate();
  }

  const percent = d.kind === 'percent';
  return (
    <Screen>
      <Stack.Screen options={{ title: t('seller.coupon.new') }} />
      <TextField label={t('seller.coupon.code')} value={d.code} onChangeText={(code) => set({ code })} autoCapitalize="characters" autoCorrect={false} maxLength={32} error={err('code')} />
      <Chips
        scroll={false}
        options={[
          { value: 'percent' as const, label: t('seller.coupon.percent') },
          { value: 'fixed' as const, label: t('seller.coupon.fixed') },
        ]}
        value={d.kind}
        onChange={(kind) => set({ kind })}
      />
      <Chips scroll={false} options={SELLER_CURRENCIES.map((c) => ({ value: c, label: c }))} value={d.currency as (typeof SELLER_CURRENCIES)[number]} onChange={(currency) => set({ currency })} />
      <Text variant="caption" muted style={{ marginBottom: 8 }}>
        {t('seller.coupon.currencyHint')}
      </Text>
      <TextField
        label={percent ? t('seller.coupon.valuePercent') : t('seller.coupon.valueAmount', { currency: d.currency })}
        value={d.value}
        onChangeText={(value) => set({ value })}
        keyboardType={percent ? 'number-pad' : 'decimal-pad'}
        error={err('value')}
      />
      <TextField label={t('seller.coupon.min', { currency: d.currency })} value={d.min} onChangeText={(min) => set({ min })} keyboardType="decimal-pad" error={err('min')} />
      <TextField label={t('seller.coupon.startsAt')} hint={t('seller.coupon.dateHint')} value={d.startsAt} onChangeText={(startsAt) => set({ startsAt })} autoCorrect={false} error={err('startsAt')} />
      <TextField label={t('seller.coupon.endsAt')} hint={t('seller.coupon.dateHint')} value={d.endsAt} onChangeText={(endsAt) => set({ endsAt })} autoCorrect={false} error={err('endsAt')} />
      <TextField label={t('seller.coupon.maxUses')} value={d.maxUses} onChangeText={(maxUses) => set({ maxUses })} keyboardType="number-pad" error={err('maxUses')} />
      <TextField label={t('seller.coupon.maxUsesPerUser')} value={d.maxUsesPerUser} onChangeText={(maxUsesPerUser) => set({ maxUsesPerUser })} keyboardType="number-pad" error={err('maxUsesPerUser')} />
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: 12 }}>
          {error}
        </Text>
      ) : null}
      <Button label={t('seller.coupon.create')} loading={create.isPending} onPress={submit} />
    </Screen>
  );
}
