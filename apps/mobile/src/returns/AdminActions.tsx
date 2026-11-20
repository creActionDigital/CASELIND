import type { OrderReturn, ResolveReturnDisputeRequest } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../i18n';
import { alertConfirm } from '../lib/confirm';
import { parseDecimalToMinor } from '../seller/money';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { resolveDispute, returnKeys } from './api';
import { availableActions } from './logic';
import { returnError } from './ui';

/** Décision de la plateforme sur un litige : remboursement intégral, partiel (montant) ou refus. */
export function AdminActions({ r }: { r: OrderReturn }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: (kind: ResolveReturnDisputeRequest['resolution']) => {
      const n = note.trim() || undefined;
      if (kind !== 'refund_partial') return resolveDispute(r.id, { resolution: kind, note: n });
      const minor = parseDecimalToMinor(partial, r.currency);
      if (minor === null || minor > r.refundMinor) throw new Error('amount');
      return resolveDispute(r.id, { resolution: kind, refundMinor: minor, note: n });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: returnKeys.disputes }),
    onError: (e) => setError(e instanceof Error && e.message === 'amount' ? t('returns.seller.amountBad') : returnError(e, t, locale)),
  });
  if (availableActions('admin', r).length === 0) return null;

  const ask = (kind: ResolveReturnDisputeRequest['resolution']) => {
    setError(null);
    alertConfirm(t('returns.admin.ask'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('returns.admin.confirm'), style: 'destructive', onPress: () => resolve.mutate(kind) },
    ]);
  };
  const busy = (k: string) => resolve.isPending && resolve.variables === k;

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
      <TextField label={t('returns.admin.note')} value={note} onChangeText={setNote} maxLength={300} multiline />
      <TextField label={t('returns.admin.partialField')} value={partial} onChangeText={setPartial} keyboardType="decimal-pad" />
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button label={t('returns.admin.refundBuyer')} loading={busy('refund_buyer')} disabled={resolve.isPending} onPress={() => ask('refund_buyer')} />
      <Button variant="secondary" label={t('returns.admin.refundPartial')} loading={busy('refund_partial')} disabled={resolve.isPending || !partial.trim()} onPress={() => ask('refund_partial')} />
      <Button variant="danger" label={t('returns.admin.reject')} loading={busy('reject')} disabled={resolve.isPending} onPress={() => ask('reject')} />
    </View>
  );
}
