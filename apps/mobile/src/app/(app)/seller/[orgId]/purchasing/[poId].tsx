import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { bk, cancelPurchaseOrder, fetchPurchaseOrder, receivePurchaseOrder, sendPurchaseOrder } from '../../../../../business/api';
import { businessErrorMessage } from '../../../../../business/errors';
import { buildReceipt, canCancelPo, canReceivePo, canSendPo, PO_TONE, receiptDefaults, remainingQty } from '../../../../../business/logic';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { alertConfirm } from '../../../../../lib/confirm';
import { useMembership } from '../../../../../seller/api';
import { formatMinor } from '../../../../../seller/money';
import { can } from '../../../../../seller/permissions';
import { Card, Loading, SectionTitle } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

/** Détail d'un bon de commande : envoi, annulation et réception (totale ou partielle) qui fait entrer le stock. */
export default function PurchaseOrderDetail() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId, poId } = useLocalSearchParams<{ orgId: string; poId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const allowed = can(role, 'inventory.manage');
  const [qty, setQty] = useState<Record<string, string> | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const q = useQuery({ queryKey: bk.order(orgId, poId), queryFn: () => fetchPurchaseOrder(orgId, poId), enabled: allowed });
  const refresh = () => {
    setQty(null);
    void qc.invalidateQueries({ queryKey: ['business', orgId] });
    // La réception change le stock : les listes du catalogue vendeur sont périmées.
    void qc.invalidateQueries({ queryKey: ['seller', orgId, 'products'] });
  };
  const fail = (e: unknown) => setInfo(businessErrorMessage(e, t, locale));
  const send = useMutation({ mutationFn: () => sendPurchaseOrder(orgId, poId), onSuccess: () => { setInfo(null); refresh(); }, onError: fail });
  const cancel = useMutation({ mutationFn: () => cancelPurchaseOrder(orgId, poId), onSuccess: () => { setInfo(null); refresh(); }, onError: fail });
  const receive = useMutation({
    mutationFn: () => {
      const built = buildReceipt(q.data!, qty ?? receiptDefaults(q.data!));
      if ('error' in built) throw new Error(built.error);
      return receivePurchaseOrder(orgId, poId, built.ok);
    },
    onSuccess: () => { setInfo(null); refresh(); },
    onError: (e) => {
      const m = e instanceof Error ? e.message : '';
      if (m === 'empty') setInfo(t('biz.po.err.receiveEmpty'));
      else if (m === 'quantity') setInfo(t('biz.po.err.receiveQty'));
      else if (m === 'exceeds') setInfo(t('biz.po.err.receiveExceeds'));
      else fail(e);
    },
  });

  const title = <Stack.Screen options={{ title: q.data?.number ?? t('biz.po.title') }} />;
  if (isPending || (allowed && q.isPending)) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('biz.purchasing.forbidden')}</Text></Screen></>;
  if (q.isError) return <>{title}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;

  if (!q.data) return <>{title}<Loading /></>;
  const po = q.data;
  const values = qty ?? receiptDefaults(po);
  const confirmSend = () =>
    alertConfirm(t('biz.po.sendTitle'), t('biz.po.sendBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('biz.po.send'), onPress: () => send.mutate() },
    ]);
  const confirmCancel = () =>
    alertConfirm(t('biz.po.cancelTitle'), t('biz.po.cancelBody'), [
      { text: t('biz.po.back'), style: 'cancel' },
      { text: t('biz.po.cancel'), style: 'destructive', onPress: () => cancel.mutate() },
    ]);

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Badge label={t(`biz.po.status.${po.status}` as MessageKey)} tone={PO_TONE[po.status]} />
            <Text variant="heading">{po.number}</Text>
          </View>
          <Text variant="bodyStrong">{po.supplierName}</Text>
          {po.expectedOn ? <Text muted>{t('biz.po.expectedOn', { date: po.expectedOn })}</Text> : null}
          {po.note ? <Text muted>{po.note}</Text> : null}
          <Text variant="bodyStrong">{t('biz.po.total', { amount: formatMinor(po.totalMinor, po.currency, locale) })}</Text>

          <SectionTitle>{t('biz.po.lines')}</SectionTitle>
          {po.lines.map((l) => (
            <Card key={l.id}>
              <Text variant="bodyStrong" numberOfLines={2}>{l.description}</Text>
              <Text variant="small" muted>{t('biz.po.line', { qty: l.quantityOrdered, cost: formatMinor(l.unitCostMinor, po.currency, locale) })}</Text>
              {l.variantId ? null : <Text variant="small" muted>{t('biz.po.freeLine')}</Text>}
              {po.status !== 'draft' ? <Text variant="small" muted>{t('biz.po.received', { r: l.quantityReceived, o: l.quantityOrdered })}</Text> : null}
              {canReceivePo(po.status) && remainingQty(l) > 0 ? (
                <TextField
                  label={t('biz.po.receiveHint', { n: remainingQty(l) })}
                  value={values[l.id] ?? ''}
                  onChangeText={(v) => setQty({ ...values, [l.id]: v })}
                  keyboardType="number-pad"
                />
              ) : null}
            </Card>
          ))}

          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
          {canReceivePo(po.status) ? (
            <>
              <Text variant="small" muted>{t('biz.po.receiveNote')}</Text>
              <Button label={t('biz.po.receive')} loading={receive.isPending} onPress={() => { setInfo(null); receive.mutate(); }} />
            </>
          ) : null}
          {canSendPo(po.status) ? <Button label={t('biz.po.send')} loading={send.isPending} onPress={confirmSend} /> : null}
          {canCancelPo(po.status) ? <Button variant="secondary" label={t('biz.po.cancel')} loading={cancel.isPending} onPress={confirmCancel} /> : null}
        </View>
      </Screen>
    </>
  );
}
