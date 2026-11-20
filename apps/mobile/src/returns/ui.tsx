import type { OrderReturn, ReturnStatus } from '@caselind/contracts';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatMinor } from '../seller/money';
import { Card } from '../seller/ui';
import { spacing } from '../theme/tokens';
import { Badge, Text } from '../ui';
import { formatWhen } from '../vitrine/updates-logic';
import { returnReasonKey } from './logic';

type T = (k: MessageKey, p?: Record<string, string | number>) => string;

const TONE: Record<ReturnStatus, 'primary' | 'neutral' | 'accent'> = {
  requested: 'accent',
  approved: 'primary',
  rejected: 'neutral',
  received: 'primary',
  refunded: 'primary',
  disputed: 'accent',
  resolved: 'neutral',
  cancelled: 'neutral',
};

/** Message d'une action sur un retour : les 409 propres aux retours, puis le message générique. */
export function returnError(e: unknown, t: T, locale: string): string {
  const key = e instanceof ApiRequestError && e.status === 409 ? returnReasonKey(e.detail<string>('reason')) : null;
  return key ? t(`returns.err.${key}` as MessageKey) : errorMessage(e, t, locale);
}

/** Un retour : statut, lignes, montant dû, notes et historique. Les boutons d'action viennent en `children`. */
export function ReturnCard({ r, showOrder, children }: { r: OrderReturn; showOrder?: boolean; children?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const money = (n: number) => formatMinor(n, r.currency, locale);
  return (
    <Card style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {showOrder ? t('returns.seller.order', { number: r.orderNumber }) : t(`returns.reason.${r.reason}` as MessageKey)}
        </Text>
        <Badge tone={TONE[r.status]} label={t(`returns.status.${r.status}` as MessageKey)} />
      </View>
      {showOrder ? <Text variant="small" muted>{t(`returns.reason.${r.reason}` as MessageKey)} · {r.orgName}</Text> : null}
      {r.items.map((i) => (
        <Text key={i.orderItemId} variant="small">
          {i.quantity} × {i.title}
        </Text>
      ))}
      {r.details ? <Text variant="small" muted>{r.details}</Text> : null}
      <Text variant="small">{t('returns.refundDue', { amount: money(r.refundMinor) })}</Text>
      {r.refundedMinor !== null ? <Text variant="small">{t('returns.refundedAmount', { amount: money(r.refundedMinor) })}</Text> : null}
      {r.resolution && (r.status === 'resolved' || r.status === 'refunded') ? <Text variant="small">{t(`returns.resolution.${r.resolution}` as MessageKey)}</Text> : null}
      {r.sellerNote ? <Text variant="small" muted>{t('returns.sellerNote', { note: r.sellerNote })}</Text> : null}
      {r.disputeReason ? <Text variant="small" muted>{t('returns.disputeReason', { note: r.disputeReason })}</Text> : null}
      {r.adminNote ? <Text variant="small" muted>{t('returns.adminNote', { note: r.adminNote })}</Text> : null}
      <Text variant="caption" muted>{t('returns.offPlatform')}</Text>
      {r.events.map((e) => (
        <Text key={e.id} variant="caption" muted>
          {formatWhen(e.createdAt)} · {t(`returns.status.${e.status}` as MessageKey)} · {t(`returns.actor.${e.actorKind}` as MessageKey)}
        </Text>
      ))}
      {children}
    </Card>
  );
}
