import type { InventoryCountDetail } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { businessErrorMessage } from '../../../../business/hr/errors';
import { cancelCount, closeCount, fetchCount, fetchCounts, ivKeys, openCount, putCountLines } from '../../../../business/inventory/api';
import { changedLines, draftOf, varianceLabel } from '../../../../business/inventory/logic';
import { useVariantRows } from '../../../../business/inventory/variants';
import { useI18n, type MessageKey } from '../../../../i18n';
import { alertConfirm } from '../../../../lib/confirm';
import { sk, useMembership } from '../../../../seller/api';
import { canManageInventory } from '../../../../seller/permissions';
import { Card, Loading, SectionTitle } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

/** Inventaire physique (permission `inventory.manage`) : un seul inventaire ouvert, quantités comptées, écarts, clôture avec ou sans application au stock. */
export default function Inventory() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending } = useMembership(orgId);
  const allowed = canManageInventory(role);
  const counts = useQuery({ queryKey: ivKeys.counts(orgId), queryFn: () => fetchCounts(orgId), enabled: !!orgId && allowed });
  const open = counts.data?.items.find((c) => c.status === 'open');
  const detail = useQuery({ queryKey: ivKeys.count(orgId, open?.id ?? ''), queryFn: () => fetchCount(orgId, open!.id), enabled: !!open });
  const { q, rows } = useVariantRows(orgId, allowed && !!open);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => { if (detail.data) setDraft((d) => ({ ...draftOf(detail.data), ...d })); }, [detail.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inventory', orgId] });
    void qc.invalidateQueries({ queryKey: sk.products(orgId) });
  };
  const fail = (e: unknown) => setInfo((e as Error).message === 'counted' ? t('inv.err.counted') : businessErrorMessage(e, t, locale));
  const start = useMutation({ mutationFn: () => openCount(orgId, note.trim() || undefined), onSuccess: () => { setNote(''); setInfo(null); refresh(); }, onError: fail });
  const save = useMutation({
    mutationFn: () => {
      const built = changedLines(draft, detail.data?.lines ?? []);
      if ('error' in built) throw new Error('counted');
      return built.ok.length === 0 ? Promise.resolve(detail.data!) : putCountLines(orgId, open!.id, built.ok);
    },
    onSuccess: () => { setInfo(null); refresh(); },
    onError: fail,
  });
  const close = useMutation({ mutationFn: (apply: boolean) => closeCount(orgId, open!.id, apply), onSuccess: () => { setInfo(null); setDraft({}); refresh(); }, onError: fail });
  const cancel = useMutation({ mutationFn: () => cancelCount(orgId, open!.id), onSuccess: () => { setInfo(null); setDraft({}); refresh(); }, onError: fail });

  const ask = (message: string, label: string, destructive: boolean, run: () => void) =>
    alertConfirm(t('inv.count.title'), message, [
      { text: t('hr.cancel'), style: 'cancel' },
      { text: label, style: destructive ? 'destructive' : 'default', onPress: run },
    ]);

  const title = <Stack.Screen options={{ title: t('inv.count.title') }} />;
  if (isPending || (allowed && counts.isPending)) return <>{title}<Loading /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('inv.forbidden')}</Text></Screen></>;
  if (counts.isError) return <>{title}<ErrorState error={counts.error} onRetry={() => counts.refetch()} /></>;
  if (open && (detail.isPending || q.isPending)) return <>{title}<Loading /></>;
  if (detail.isError) return <>{title}<ErrorState error={detail.error} onRetry={() => detail.refetch()} /></>;

  const d: InventoryCountDetail | undefined = detail.data;
  const lineOf = (variantId: string) => d?.lines.find((l) => l.variantId === variantId);
  const history = (counts.data?.items ?? []).filter((c) => c.status !== 'open').slice(0, 5);

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          {!open ? (
            <>
              <Text muted>{t('inv.count.none')}</Text>
              <TextField label={t('inv.count.note')} value={note} onChangeText={setNote} maxLength={200} />
              <Button label={t('inv.count.open')} loading={start.isPending} onPress={() => { setInfo(null); start.mutate(); }} />
            </>
          ) : (
            <>
              {d ? <Text variant="small" muted>{t('inv.count.summary', { lines: d.lineCount, gaps: d.discrepancyCount, net: varianceLabel(d.netVariance) })}</Text> : null}
              {rows.filter((r) => r.trackStock).map((r) => {
                const line = lineOf(r.variantId);
                return (
                  <Card key={r.variantId}>
                    <Text variant="bodyStrong" numberOfLines={1}>{r.title}</Text>
                    <Text variant="small" muted>{r.sku}{r.label ? ` · ${r.label}` : ''} · {t('inv.count.system', { n: line ? line.systemQuantity : r.stock })}</Text>
                    <TextField label={t('inv.count.counted')} value={draft[r.variantId] ?? ''} onChangeText={(v) => setDraft((x) => ({ ...x, [r.variantId]: v }))} keyboardType="number-pad" />
                    {line ? <Text variant="small" color={line.variance === 0 ? colors.textMuted : colors.danger}>{t('inv.count.variance', { v: varianceLabel(line.variance) })}</Text> : null}
                  </Card>
                );
              })}
              {q.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
              {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
              <Button variant="secondary" label={t('inv.count.saveLines')} loading={save.isPending} onPress={() => { setInfo(null); save.mutate(); }} />
              <Button label={t('inv.count.closeApply')} loading={close.isPending && close.variables === true} onPress={() => ask(t('inv.count.confirmApply'), t('inv.count.closeApply'), false, () => close.mutate(true))} />
              <Button variant="secondary" label={t('inv.count.closeNoApply')} loading={close.isPending && close.variables === false} onPress={() => ask(t('inv.count.confirmNoApply'), t('inv.count.closeNoApply'), false, () => close.mutate(false))} />
              <Button variant="ghost" label={t('inv.count.cancel')} onPress={() => ask(t('inv.count.confirmCancel'), t('inv.count.cancel'), true, () => cancel.mutate())} />
            </>
          )}

          {history.length > 0 ? (
            <>
              <SectionTitle>{t('inv.count.history')}</SectionTitle>
              {history.map((c) => (
                <Card key={c.id}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <Text variant="small" style={{ flex: 1 }}>{new Date(c.createdAt).toLocaleDateString(locale)}{c.note ? ` · ${c.note}` : ''}</Text>
                    {c.applied ? <Badge tone="primary" label={t('inv.count.applied')} /> : null}
                    <Badge tone="neutral" label={t(`inv.count.status.${c.status}` as MessageKey)} />
                  </View>
                </Card>
              ))}
            </>
          ) : null}
        </View>
      </Screen>
    </>
  );
}
