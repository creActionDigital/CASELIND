import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { alertConfirm } from '../lib/confirm';
import { Share, View } from 'react-native';
import { useI18n } from '../i18n';
import { sk } from '../seller/api';
import { formatMinor } from '../seller/money';
import { Card, sellerErrorMessage } from '../seller/ui';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { fetchPosTicket, voidPosSale } from './api';
import { ticketText } from './logic';

/** Ticket d'une vente (après encaissement ou depuis l'historique) : lignes, total, mode, date ; partage en texte brut, annulation. */
export function TicketCard({ orgId, saleId, onClose }: { orgId: string; saleId: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const key = ['seller', orgId, 'pos-ticket', saleId];
  const ticket = useQuery({ queryKey: key, queryFn: () => fetchPosTicket(orgId, saleId) });
  const voided = useMutation({
    mutationFn: () => voidPosSale(orgId, saleId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: sk.products(orgId) });
      void qc.invalidateQueries({ queryKey: ['seller', orgId, 'pos-summary'] });
      void qc.invalidateQueries({ queryKey: ['seller', orgId, 'pos-sales'] });
      void qc.invalidateQueries({ queryKey: ['seller', orgId, 'pos-shift'] });
    },
  });
  const data = ticket.data;
  if (!data) return ticket.isError ? <Text variant="small" color={colors.danger}>{sellerErrorMessage(ticket.error, t, locale)}</Text> : null;
  const { sale, shop } = data;
  const money = (n: number) => formatMinor(n, sale.currency, locale);
  const modeName = t(`pos.method.${sale.paymentMethod}` as const);

  const share = () => {
    const message = ticketText(data, { total: t('pos.ticket.total'), mode: t('pos.ticket.mode'), modeName, voided: t('pos.ticket.voided') }, locale);
    void Share.share({ message });
  };
  const confirmVoid = () =>
    alertConfirm(t('pos.void'), t('pos.void.confirm'), [
      { text: t('pos.void.keep'), style: 'cancel' },
      { text: t('pos.void'), style: 'destructive', onPress: () => voided.mutate() },
    ]);

  return (
    <Card>
      <Text variant="bodyStrong">{t('pos.ticket')} · {shop.name}</Text>
      {shop.address ? <Text variant="small" muted>{shop.address}</Text> : null}
      {shop.phone ? <Text variant="small" muted>{shop.phone}</Text> : null}
      <Text variant="small" muted>{new Date(sale.createdAt).toLocaleString(locale)}</Text>
      <View style={{ paddingVertical: spacing.sm, gap: spacing.xs }}>
        {sale.lines.map((l, i) => (
          <Text key={i} variant="small">{l.quantity} × {l.title}{l.variantLabel ? ` (${l.variantLabel})` : ''} · {money(l.quantity * l.unitPriceMinor)}</Text>
        ))}
      </View>
      <Text variant="bodyStrong">{t('pos.ticket.total')} : {money(sale.totalMinor)}</Text>
      <Text variant="small">{t('pos.ticket.mode')} : {modeName}</Text>
      {sale.voidedAt ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{t('pos.ticket.voided')}</Text> : null}
      {voided.isError ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{sellerErrorMessage(voided.error, t, locale)}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.sm }}>
        <Button variant="secondary" label={t('pos.share')} onPress={share} />
        {sale.voidedAt ? null : <Button variant="danger" label={t('pos.void')} loading={voided.isPending} onPress={confirmVoid} />}
        <Button variant="ghost" label={t('pos.ticket.close')} onPress={onClose} />
      </View>
    </Card>
  );
}
