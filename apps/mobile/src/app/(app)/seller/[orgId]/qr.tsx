import type { CreatedPaymentQr, CreatePaymentQrRequest, PaymentQr } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { shareMessage } from '../../../../lib/share';
import { errorMessage } from '../../../../lib/errors';
import { createPaymentQr, fetchPaymentQrPayload, fetchPaymentQrs, revokePaymentQr } from '../../../../scan/api';
import { QR_EXPIRIES, buildCreateQr, type QrMode } from '../../../../scan/qr-forms';
import { QrCode } from '../../../../scan/QrCode';
import { useMembership } from '../../../../seller/api';
import { can } from '../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { formatMoney } from '../../../../shop/format';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, ErrorState, Text, TextField } from '../../../../ui';
import { canViewFinance } from '../../../../wallet/org-access';
import { WALLET_CURRENCIES } from '../../../../wallet/amount';
import { SandboxBanner } from '../../../../wallet/ui';

const qk = (orgId: string) => ['payment-qrs', orgId] as const;

/** QR de paiement du vendeur : création (libre ou montant fixe), affichage en grand, partage, liste et révocation. */
export default function SellerQr() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending: orgsPending } = useMembership(orgId);
  const allowed = canViewFinance(role) || can(role, 'orders.manage');

  const [mode, setMode] = useState<QrMode>('free');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [label, setLabel] = useState('');
  const [expires, setExpires] = useState<number>(QR_EXPIRIES[0]);
  const [singleUse, setSingleUse] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<CreatedPaymentQr | null>(null);

  const list = useInfiniteQuery({
    queryKey: qk(orgId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPaymentQrs(orgId, pageParam),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: allowed,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const create = useMutation({
    mutationFn: (body: CreatePaymentQrRequest) => createPaymentQr(orgId, body),
    onSuccess: (qr) => {
      setShown(qr);
      void qc.invalidateQueries({ queryKey: qk(orgId) });
    },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokePaymentQr(orgId, id),
    onSuccess: (_r, id) => {
      if (shown?.qrId === id) setShown(null);
      void qc.invalidateQueries({ queryKey: qk(orgId) });
    },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });

  const show = useMutation({
    mutationFn: async (q: PaymentQr) => ({ ...q, payload: (await fetchPaymentQrPayload(orgId, q.qrId)).payload }),
    onSuccess: (qr) => setShown(qr),
    onError: (e) => setError(errorMessage(e, t, locale)),
  });

  const title = <Stack.Screen options={{ title: t('sellerQr.title') }} />;
  if (orgsPending) return <>{title}<Loading /></>;
  if (!allowed) {
    return (
      <>
        {title}
        <View style={styles.pad}>
          <Text muted>{t('sellerQr.noAccess')}</Text>
        </View>
      </>
    );
  }

  function submit() {
    setError(null);
    const r = buildCreateQr({ mode, amount, currency, label, expiresInSeconds: expires, singleUse });
    if ('issue' in r) return setError(t(r.issue === 'label' ? 'sellerQr.error.label' : 'wallet.error.amount'));
    create.mutate(r.body);
  }

  const money = (q: { amountMinor: number | null; currency: string }) =>
    q.amountMinor === null ? t('sellerQr.anyAmount') : formatMoney(q.amountMinor, q.currency, locale);
  const expiryLabel = (s: number) => t(s === 900 ? 'sellerQr.exp15' : s === 3600 ? 'sellerQr.exp60' : 'sellerQr.exp24h');

  if (shown) {
    return (
      <>
        {title}
        <ScrollView contentContainerStyle={styles.pad}>
          <SandboxBanner />
          <Text variant="heading" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {shown.label ?? t('sellerQr.defaultLabel')}
          </Text>
          <Text variant="display" color={colors.primary} style={{ textAlign: 'center' }}>
            {money(shown)}
          </Text>
          <QrCode value={shown.payload} size={280} label={t('sellerQr.qrLabel', { amount: money(shown) })} />
          <Text variant="small" muted style={{ textAlign: 'center' }}>
            {t('sellerQr.brightness')}
          </Text>
          <Text variant="small" muted style={{ textAlign: 'center' }}>
            {shown.amountMinor === null
              ? t('sellerQr.noExpiry')
              : t('sellerQr.expiresAt', { time: shown.expiresAt ? new Date(shown.expiresAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '' }) +
                (shown.singleUse ? ` · ${t('sellerQr.singleUse')}` : '')}
          </Text>
          <Button label={t('sellerQr.share')} onPress={() => void shareMessage({ message: shown.payload }, t('share.copied'))} />
          <Button variant="secondary" label={t('sellerQr.revoke')} loading={revoke.isPending} onPress={() => revoke.mutate(shown.qrId)} />
          <Button variant="ghost" label={t('sellerQr.back')} onPress={() => setShown(null)} />
        </ScrollView>
      </>
    );
  }

  return (
    <>
      {title}
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <SandboxBanner />
        <SectionTitle>{t('sellerQr.new')}</SectionTitle>
        <Chips
          options={[
            { value: 'free' as QrMode, label: t('sellerQr.modeFree') },
            { value: 'fixed' as QrMode, label: t('sellerQr.modeFixed') },
          ]}
          value={mode}
          onChange={setMode}
          scroll={false}
        />
        <Text variant="small" muted>
          {mode === 'free' ? t('sellerQr.freeHint') : t('sellerQr.fixedHint')}
        </Text>
        <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as 'USD' | 'CDF'} onChange={setCurrency} scroll={false} />
        {mode === 'fixed' ? (
          <>
            <TextField label={t('pay.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
            <Chips
              options={QR_EXPIRIES.map((s) => ({ value: String(s), label: expiryLabel(s) }))}
              value={String(expires)}
              onChange={(v) => setExpires(Number(v))}
              scroll={false}
            />
            <Chips
              options={[
                { value: 'once', label: t('sellerQr.singleUse') },
                { value: 'multi', label: t('sellerQr.multiUse') },
              ]}
              value={singleUse ? 'once' : 'multi'}
              onChange={(v) => setSingleUse(v === 'once')}
              scroll={false}
            />
          </>
        ) : null}
        <TextField label={t('sellerQr.label')} value={label} onChangeText={setLabel} maxLength={80} />
        {error ? (
          <Text color={colors.danger} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label={t('sellerQr.create')} loading={create.isPending} onPress={submit} />

        <SectionTitle>{t('sellerQr.list')}</SectionTitle>
        {list.isPending ? <Loading /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
        {list.data && items.length === 0 ? <Text muted>{t('sellerQr.empty')}</Text> : null}
        {items.map((q) => (
          <QrRow key={q.qrId} q={q} money={money(q)} busy={revoke.isPending || show.isPending} onShow={() => show.mutate(q)} onRevoke={() => revoke.mutate(q.qrId)} />
        ))}
        {list.hasNextPage ? <Button variant="ghost" label={t('common.retry')} onPress={() => list.fetchNextPage()} /> : null}
      </ScrollView>
    </>
  );
}

function QrRow({ q, money, busy, onShow, onRevoke }: { q: PaymentQr; money: string; busy: boolean; onShow: () => void; onRevoke: () => void }) {
  const { t, locale } = useI18n();
  const active = q.status === 'active';
  return (
    <Card>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '600' }}>{q.label ?? t('sellerQr.defaultLabel')}</Text>
          <Text variant="small" muted>
            {money}
            {q.expiresAt ? ` · ${new Date(q.expiresAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}` : ''}
            {q.singleUse ? ` · ${t('sellerQr.singleUse')}` : ''}
          </Text>
        </View>
        <Badge tone={active ? 'accent' : 'neutral'} label={t(`sellerQr.status.${q.status}` as 'sellerQr.status.active')} />
      </View>
      {active ? <Button variant="secondary" label={t('sellerQr.show')} disabled={busy} onPress={onShow} /> : null}
      {active ? <Button variant="ghost" label={t('sellerQr.revoke')} disabled={busy} onPress={onRevoke} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md },
});
