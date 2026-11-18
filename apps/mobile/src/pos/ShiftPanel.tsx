import type { PosShiftReport } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../i18n';
import { SELLER_CURRENCIES, formatMinor, type SellerCurrency } from '../seller/money';
import { Chips, sellerErrorMessage } from '../seller/ui';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { closePosShift, fetchCurrentShift, openPosShift } from './api';
import { parseCashMinor } from './logic';

/** Session de caisse : fond à l'ouverture, espèces comptées à la clôture (attendu, compté, écart). Facultative. */
export function ShiftPanel({ orgId }: { orgId: string }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ['seller', orgId, 'pos-shift'], queryFn: () => fetchCurrentShift(orgId) });
  const [currency, setCurrency] = useState<SellerCurrency>('USD');
  const [amount, setAmount] = useState('');
  const [report, setReport] = useState<PosShiftReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shift = current.data?.shift ?? null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['seller', orgId, 'pos-shift'] });
  const onError = (e: unknown) => setError(sellerErrorMessage(e, t, locale));

  const open = useMutation({
    mutationFn: (minor: number) => openPosShift(orgId, { currency, openingFloatMinor: minor }),
    onSuccess: () => {
      setAmount('');
      setReport(null);
      setError(null);
      refresh();
    },
    onError,
  });
  const close = useMutation({
    mutationFn: (minor: number) => closePosShift(orgId, shift!.id, { countedCashMinor: minor }),
    onSuccess: (r) => {
      setAmount('');
      setError(null);
      setReport(r);
      refresh();
    },
    onError,
  });

  const submit = () => {
    const minor = parseCashMinor(amount, shift?.currency ?? currency);
    if (minor === null) return setError(t('pos.shift.invalid'));
    setError(null);
    if (shift) close.mutate(minor);
    else open.mutate(minor);
  };
  const money = (n: number, c: string) => formatMinor(n, c, locale);

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="bodyStrong">{t('pos.shift.title')}</Text>
      {shift ? (
        <Text variant="small" accessibilityLiveRegion="polite">{t('pos.shift.opened', { float: money(shift.openingFloatMinor, shift.currency) })}</Text>
      ) : (
        <>
          <Text variant="caption" muted>{t('pos.shift.none')}</Text>
          <Chips options={SELLER_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />
        </>
      )}
      {report ? (
        <Text variant="small" accessibilityLiveRegion="polite">
          {t('pos.shift.report', { expected: money(report.expectedCashMinor, report.shift.currency), counted: money(report.countedCashMinor, report.shift.currency), diff: money(report.differenceMinor, report.shift.currency) })}
        </Text>
      ) : null}
      <TextField label={shift ? t('pos.shift.counted') : t('pos.shift.float')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button variant="secondary" label={shift ? t('pos.shift.close') : t('pos.shift.open')} loading={open.isPending || close.isPending} disabled={amount.trim() === ''} onPress={submit} />
    </View>
  );
}
