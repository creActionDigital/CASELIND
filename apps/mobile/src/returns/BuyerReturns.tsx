import { Ionicons } from '@expo/vector-icons';
import type { OrderDetail, ReturnReason } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { alertConfirm } from '../lib/confirm';
import { Chips } from '../seller/ui';
import { spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { cancelReturn, disputeReturn, fetchOrderReturns, requestReturn, returnKeys } from './api';
import { availableActions, buildReturnRequest, clampQty, RETURN_REASONS, windowInfo } from './logic';
import { returnError, ReturnCard } from './ui';

/** Section « retour » du détail d'une commande livrée : demande, suivi, annulation, escalade en litige. */
export function BuyerReturns({ order }: { order: OrderDetail }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const delivered = order.status === 'delivered';
  const q = useQuery({ queryKey: returnKeys.order(order.id), queryFn: () => fetchOrderReturns(order.id), enabled: delivered });
  const [form, setForm] = useState(false);
  const [reason, setReason] = useState<ReturnReason>('defective');
  const [details, setDetails] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [disputing, setDisputing] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: returnKeys.order(order.id) });
  };
  const fail = (e: unknown) => setError(returnError(e, t, locale));
  const create = useMutation({
    mutationFn: () => {
      const built = buildReturnRequest(reason, details, qty, order.items);
      if ('error' in built) throw new Error(built.error);
      return requestReturn(order.id, built.ok);
    },
    onSuccess: () => {
      setForm(false);
      setQty({});
      setDetails('');
      done();
    },
    onError: (e) => (e instanceof Error && (e.message === 'none' || e.message === 'quantity') ? setError(t(e.message === 'none' ? 'returns.pickOne' : 'returns.qtyTooMany')) : fail(e)),
  });
  const cancel = useMutation({ mutationFn: (id: string) => cancelReturn(id), onSuccess: done, onError: fail });
  const dispute = useMutation({
    mutationFn: (id: string) => disputeReturn(id, why.trim()),
    onSuccess: () => {
      setDisputing(null);
      setWhy('');
      done();
    },
    onError: fail,
  });

  if (!delivered || q.isPending || q.isError) return null;
  const data = q.data;
  const win = windowInfo(data.windowEndsAt);

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="heading" accessibilityRole="header">
        {t('returns.section')}
      </Text>
      {data.items.map((r) => {
        const actions = availableActions('buyer', r);
        return (
          <ReturnCard key={r.id} r={r}>
            {actions.includes('cancel') ? (
              <Button
                variant="secondary"
                label={t('returns.cancel')}
                loading={cancel.isPending && cancel.variables === r.id}
                onPress={() => alertConfirm(t('returns.cancelAsk'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('returns.cancel'), style: 'destructive', onPress: () => cancel.mutate(r.id) }])}
              />
            ) : null}
            {actions.includes('dispute') && disputing !== r.id ? <Button variant="secondary" label={t('returns.dispute')} onPress={() => { setError(null); setDisputing(r.id); }} /> : null}
            {disputing === r.id ? (
              <View style={{ gap: spacing.sm }}>
                <Text variant="bodyStrong">{t('returns.disputeTitle')}</Text>
                <TextField label={t('returns.disputeField')} value={why} onChangeText={setWhy} maxLength={500} multiline />
                <Button
                  label={t('returns.disputeSend')}
                  disabled={why.trim().length === 0}
                  loading={dispute.isPending}
                  onPress={() => alertConfirm(t('returns.disputeAsk'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('returns.disputeSend'), onPress: () => dispute.mutate(r.id) }])}
                />
                <Button variant="ghost" label={t('common.cancel')} onPress={() => setDisputing(null)} />
              </View>
            ) : null}
          </ReturnCard>
        );
      })}

      {error ? <Text color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}

      {data.canRequest ? (
        form ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="bodyStrong">{t('returns.formTitle')}</Text>
            <Text variant="small">{t('returns.fieldReason')}</Text>
            <Chips scroll={false} options={RETURN_REASONS.map((r) => ({ value: r, label: t(`returns.reason.${r}` as MessageKey) }))} value={reason} onChange={setReason} />
            <Text variant="small">{t('returns.fieldQty')}</Text>
            {order.items.map((i) => {
              const n = qty[i.id] ?? 0;
              const set = (v: number) => setQty((cur) => ({ ...cur, [i.id]: clampQty(v, i.quantity) }));
              return (
                <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="small" numberOfLines={2}>{i.title}</Text>
                    <Text variant="caption" muted>{t('returns.qtyOf', { max: i.quantity })}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`− ${i.title}`} onPress={() => set(n - 1)} style={{ minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="remove-circle-outline" size={28} color={colors.primary} />
                  </Pressable>
                  <Text variant="bodyStrong" accessibilityLiveRegion="polite">{n}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={`+ ${i.title}`} onPress={() => set(n + 1)} style={{ minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
                  </Pressable>
                </View>
              );
            })}
            <TextField label={t('returns.fieldDetails')} value={details} onChangeText={setDetails} maxLength={500} multiline />
            <Text variant="caption" muted>{t('returns.estimate')}</Text>
            <Button label={t('returns.submit')} loading={create.isPending} onPress={() => { setError(null); create.mutate(); }} />
            <Button variant="ghost" label={t('common.cancel')} onPress={() => setForm(false)} />
          </View>
        ) : (
          <>
            <Text variant="small" muted>{win.state === 'open' ? (win.daysLeft <= 1 ? t('returns.windowOne') : t('returns.window', { n: win.daysLeft })) : ''}</Text>
            <Button variant="secondary" label={t('returns.ask')} onPress={() => { setError(null); setForm(true); }} />
          </>
        )
      ) : data.items.length === 0 && win.state === 'closed' ? (
        <Text muted>{t('returns.windowClosed')}</Text>
      ) : null}
    </View>
  );
}
