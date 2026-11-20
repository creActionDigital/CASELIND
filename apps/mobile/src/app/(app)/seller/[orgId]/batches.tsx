import type { Batch } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { businessErrorMessage } from '../../../../business/hr/errors';
import { consumeBatch, createBatch, fetchBatches, fetchExpiring, fetchFefo, ivKeys } from '../../../../business/inventory/api';
import { batchTone, buildBatch, parsePositive, type BatchForm } from '../../../../business/inventory/logic';
import { useVariantRows, type VariantRow } from '../../../../business/inventory/variants';
import { useI18n, type MessageKey } from '../../../../i18n';
import { sk, useMembership } from '../../../../seller/api';
import { canManageInventory } from '../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

const EMPTY: BatchForm = { batchCode: '', expiresOn: '', quantity: '', enterStock: false, note: '' };

function ToneBadge({ b }: { b: Batch }) {
  const { t } = useI18n();
  const tone = batchTone(b);
  if (tone === 'none') return <Badge tone="neutral" label={t('inv.batches.noDate')} />;
  return <Badge tone={tone === 'expired' ? 'accent' : tone === 'soon' ? 'accent' : 'neutral'} label={t(`inv.tone.${tone}` as MessageKey)} />;
}

/** Lots et péremption (permission `inventory.manage`) : péremption proche en tête, puis les lots de la variante choisie. */
export default function Batches() {
  const { t } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending } = useMembership(orgId);
  const allowed = canManageInventory(role);
  const expiring = useQuery({ queryKey: ivKeys.expiring(orgId), queryFn: () => fetchExpiring(orgId, 30), enabled: !!orgId && allowed });
  const { q, rows } = useVariantRows(orgId, allowed);
  const [selected, setSelected] = useState<VariantRow | null>(null);

  const title = <Stack.Screen options={{ title: t('inv.batches.title') }} />;
  if (isPending || expiring.isPending || q.isPending) return <>{title}<Loading /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('inv.forbidden')}</Text></Screen></>;
  if (expiring.isError) return <>{title}<ErrorState error={expiring.error} onRetry={() => expiring.refetch()} /></>;
  if (q.isError) return <>{title}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Text variant="small" muted>{t('inv.batches.info')}</Text>
          <SectionTitle>{t('inv.batches.expiring')}</SectionTitle>
          {expiring.data.items.length === 0 ? <Text muted>{t('inv.batches.noneExpiring')}</Text> : null}
          {expiring.data.items.map((b) => (
            <Card key={b.id}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{b.productTitle} · {b.sku}</Text>
                <ToneBadge b={b} />
              </View>
              <Text variant="small">{b.batchCode} · {t('inv.batches.expiresOn', { date: b.expiresOn ?? '' })} · {t('inv.batches.remaining', { n: b.quantityRemaining, total: b.quantityReceived })}</Text>
            </Card>
          ))}

          <SectionTitle>{t('inv.batches.variants')}</SectionTitle>
          <Chips
            scroll={false}
            options={rows.map((r) => ({ value: r.variantId, label: `${r.title} · ${r.sku}` }))}
            value={selected?.variantId ?? null}
            onChange={(id) => setSelected(rows.find((r) => r.variantId === id) ?? null)}
          />
          {q.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
          {selected ? <VariantBatches key={selected.variantId} orgId={orgId} variant={selected} /> : null}
        </View>
      </Screen>
    </>
  );
}

function VariantBatches({ orgId, variant }: { orgId: string; variant: VariantRow }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ivKeys.batches(orgId, variant.variantId), queryFn: () => fetchBatches(orgId, variant.variantId) });
  const fefo = useQuery({ queryKey: [...ivKeys.batches(orgId, variant.variantId), 'fefo'], queryFn: () => fetchFefo(orgId, variant.variantId) });
  const [form, setForm] = useState<BatchForm>(EMPTY);
  const [take, setTake] = useState('1');
  const [info, setInfo] = useState<string | null>(null);
  const set = (p: Partial<BatchForm>) => setForm((f) => ({ ...f, ...p }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ivKeys.batches(orgId, variant.variantId) });
    void qc.invalidateQueries({ queryKey: ivKeys.expiring(orgId) });
    void qc.invalidateQueries({ queryKey: sk.products(orgId) });
  };
  const add = useMutation({
    mutationFn: () => {
      const built = buildBatch(form);
      if ('error' in built) throw new Error(built.error);
      return createBatch(orgId, variant.variantId, built.ok);
    },
    onSuccess: () => { setInfo(null); setForm(EMPTY); refresh(); },
    onError: (e) => setInfo(/^(code|expiresOn|quantity)$/.test((e as Error).message) ? t(`inv.err.${(e as Error).message}` as MessageKey) : businessErrorMessage(e, t, locale)),
  });
  const consume = useMutation({
    mutationFn: (id: string) => {
      const n = parsePositive(take);
      if (n === null) throw new Error('quantity');
      return consumeBatch(orgId, variant.variantId, id, n);
    },
    onSuccess: () => { setInfo(null); refresh(); },
    onError: (e) => setInfo((e as Error).message === 'quantity' ? t('inv.err.quantity') : businessErrorMessage(e, t, locale)),
  });

  if (list.isPending || fefo.isPending) return <Loading />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <View style={{ gap: spacing.md }}>
      <SectionTitle>{t('inv.batches.of', { sku: variant.sku })}</SectionTitle>
      {list.data.items.length === 0 ? <Text muted>{t('inv.batches.none')}</Text> : null}
      {list.data.items.map((b) => (
        <Card key={b.id}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>{b.batchCode}</Text>
            <ToneBadge b={b} />
          </View>
          <Text variant="small">{b.expiresOn ? t('inv.batches.expiresOn', { date: b.expiresOn }) : t('inv.batches.noDate')} · {t('inv.batches.remaining', { n: b.quantityRemaining, total: b.quantityReceived })}</Text>
          {b.note ? <Text variant="small" muted>{b.note}</Text> : null}
          {b.quantityRemaining > 0 ? <Button variant="secondary" label={t('inv.batches.consume')} loading={consume.isPending && consume.variables === b.id} onPress={() => consume.mutate(b.id)} /> : null}
        </Card>
      ))}
      {list.data.items.length > 0 ? (
        <>
          <TextField label={t('inv.f.consumeQty')} value={take} onChangeText={setTake} keyboardType="number-pad" hint={t('inv.batches.consumeInfo')} />
          {fefo.data && fefo.data.items.length > 0 ? (
            <Text variant="small" muted>{t('inv.batches.fefo')} : {fefo.data.items.map((b) => b.batchCode).join(' > ')}</Text>
          ) : null}
        </>
      ) : null}

      <SectionTitle>{t('inv.batches.add')}</SectionTitle>
      <TextField label={t('inv.f.code')} value={form.batchCode} onChangeText={(v) => set({ batchCode: v })} maxLength={40} autoCapitalize="characters" />
      <TextField label={t('inv.f.expires')} value={form.expiresOn} onChangeText={(v) => set({ expiresOn: v })} autoCapitalize="none" />
      <TextField label={t('inv.f.qty')} value={form.quantity} onChangeText={(v) => set({ quantity: v })} keyboardType="number-pad" />
      <TextField label={t('inv.f.note')} value={form.note} onChangeText={(v) => set({ note: v })} maxLength={100} />
      {variant.trackStock ? (
        <Chips
          scroll={false}
          options={[{ value: 'no', label: t('inv.f.infoOnly') }, { value: 'yes', label: t('inv.f.enterStock') }]}
          value={form.enterStock ? 'yes' : 'no'}
          onChange={(v) => set({ enterStock: v === 'yes' })}
        />
      ) : null}
      {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
      <Button label={t('inv.batches.add')} loading={add.isPending} onPress={() => { setInfo(null); add.mutate(); }} />
    </View>
  );
}
