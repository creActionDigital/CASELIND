import type { DocumentStatus } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { convertDocument, dk, fetchDocument, setDocumentStatus, useMembership } from '../../../../../seller/api';
import { nextStatuses } from '../../../../../seller/documents';
import { formatMinor } from '../../../../../seller/money';
import { can } from '../../../../../seller/permissions';
import { Card, Loading, sellerErrorMessage } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, ErrorState, Text } from '../../../../../ui';

/** Détail d'un devis ou d'une facture : lignes, total, changement d'état, création de la facture depuis un devis accepté. */
export default function DocumentDetail() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId, id } = useLocalSearchParams<{ orgId: string; id: string }>();
  const { role } = useMembership(orgId);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: dk.one(orgId, id), queryFn: () => fetchDocument(orgId, id) });
  const done = () => {
    void qc.invalidateQueries({ queryKey: dk.all(orgId) });
    void qc.invalidateQueries({ queryKey: dk.one(orgId, id) });
  };
  const status = useMutation({
    mutationFn: (s: DocumentStatus) => setDocumentStatus(orgId, id, s),
    onMutate: () => setError(null),
    onSuccess: done,
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });
  const convert = useMutation({
    mutationFn: () => convertDocument(orgId, id),
    onMutate: () => setError(null),
    onSuccess: (inv) => {
      done();
      router.replace(`/seller/${orgId}/documents/${inv.id}` as never);
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });

  const d = q.data;
  const busy = status.isPending || convert.isPending;
  const canManage = can(role, 'orders.manage');
  return (
    <>
      <Stack.Screen options={{ title: d?.number ?? t('docs.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {d ? (
          <>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="heading">{t(`docs.type.${d.kind}` as const)}</Text>
                <Badge tone="neutral" label={t(`docs.status.${d.status}` as const)} />
              </View>
              <Text variant="bodyStrong">{d.customerName}</Text>
              {d.customerContact ? <Text muted>{d.customerContact}</Text> : null}
            </Card>
            <Card>
              {d.lines.map((l, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <Text style={{ flex: 1 }}>
                    {l.quantity} × {l.description}
                  </Text>
                  <Text>{formatMinor(l.quantity * l.unitPriceMinor, d.currency, locale)}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="bodyStrong">{t('docs.total')}</Text>
                <Text variant="bodyStrong">{formatMinor(d.totalMinor, d.currency, locale)}</Text>
              </View>
            </Card>
            {error ? (
              <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            {canManage && d.kind === 'quote' && d.status === 'accepted' ? <Button label={t('docs.convert')} loading={convert.isPending} disabled={busy} onPress={() => convert.mutate()} /> : null}
            {canManage
              ? nextStatuses(d.kind, d.status).map((s) => (
                  <Button key={s} variant={s === 'cancelled' ? 'danger' : 'primary'} label={t(`docs.action.${s}` as const)} loading={status.isPending} disabled={busy} onPress={() => status.mutate(s)} />
                ))
              : null}
            <Text variant="small" muted>
              {t('docs.note')}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
