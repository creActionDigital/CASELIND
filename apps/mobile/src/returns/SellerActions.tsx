import { Ionicons } from '@expo/vector-icons';
import type { OrderReturn } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../i18n';
import { alertConfirm } from '../lib/confirm';
import { minorToDecimalString, parseDecimalToMinor } from '../seller/money';
import { spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { orgReturnStep, returnKeys } from './api';
import { availableActions } from './logic';
import { returnError } from './ui';

/** Boutons du vendeur sur un retour (accepter, refuser, reçu, remboursé), chacun confirmé. */
export function SellerActions({ orgId, r }: { orgId: string; r: OrderReturn }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [restock, setRestock] = useState(true);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const actions = availableActions('org', r);
  const step = useMutation({
    mutationFn: (s: 'approve' | 'reject' | 'received' | 'refunded') => {
      const n = note.trim() || undefined;
      if (s === 'received') return orgReturnStep(orgId, r.id, { step: s, restock, note: n });
      if (s === 'refunded') {
        const minor = amount.trim() ? parseDecimalToMinor(amount, r.currency) : undefined;
        if (minor === null || (minor !== undefined && minor > r.refundMinor)) throw new Error('amount');
        return orgReturnStep(orgId, r.id, { step: s, amountMinor: minor, note: n });
      }
      return orgReturnStep(orgId, r.id, { step: s, note: n });
    },
    onSuccess: () => {
      setError(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: returnKeys.org(orgId) });
    },
    onError: (e) => setError(e instanceof Error && e.message === 'amount' ? t('returns.seller.amountBad') : returnError(e, t, locale)),
  });
  if (actions.length === 0) return null;

  const ask = (s: 'approve' | 'reject' | 'received' | 'refunded', danger = false) =>
    alertConfirm(t(`returns.seller.${s}Ask` as 'returns.seller.approveAsk'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t(`returns.seller.${s}` as 'returns.seller.approve'), style: danger ? 'destructive' : 'default', onPress: () => step.mutate(s) },
    ]);
  const busy = (s: string) => step.isPending && step.variables === s;

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
      <TextField label={t('returns.seller.note')} value={note} onChangeText={setNote} maxLength={300} multiline />
      {actions.includes('received') ? (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: restock }} onPress={() => setRestock((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TOUCH }}>
          <Ionicons name={restock ? 'checkbox' : 'square-outline'} size={24} color={restock ? colors.primary : colors.textMuted} />
          <Text>{t('returns.seller.restock')}</Text>
        </Pressable>
      ) : null}
      {actions.includes('refunded') ? (
        <TextField label={t('returns.seller.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={minorToDecimalString(r.refundMinor, r.currency)} />
      ) : null}
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      {actions.includes('approve') ? <Button label={t('returns.seller.approve')} loading={busy('approve')} disabled={step.isPending} onPress={() => ask('approve')} /> : null}
      {actions.includes('reject') ? <Button variant="danger" label={t('returns.seller.reject')} loading={busy('reject')} disabled={step.isPending} onPress={() => ask('reject', true)} /> : null}
      {actions.includes('received') ? <Button label={t('returns.seller.received')} loading={busy('received')} disabled={step.isPending} onPress={() => ask('received')} /> : null}
      {actions.includes('refunded') ? <Button label={t('returns.seller.refunded')} loading={busy('refunded')} disabled={step.isPending} onPress={() => ask('refunded')} /> : null}
    </View>
  );
}
