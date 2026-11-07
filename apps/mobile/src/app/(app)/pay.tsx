import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { uuidv4 } from '../../lib/uuid';
import { payQr, resolveQr } from '../../scan/api';
import { classifyPayError, isQrRefusal, payErrorMessage } from '../../scan/pay-errors';
import { formatMoney } from '../../shop/format';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Avatar, Badge, Button, ErrorState, Text, TextField } from '../../ui';
import { Loading } from '../../seller/ui';
import { validateFreeAmount } from '../../scan/qr-forms';
import { classifyWalletError } from '../../wallet/errors';
import { useWalletEnabled, walletKeys } from '../../wallet/hooks';
import { PIN_LENGTH } from '../../wallet/pin';
import { PinPad, SandboxBanner } from '../../wallet/ui';

type Step = 'card' | 'review' | 'pin' | 'done';

/** Paiement marchand par QR : carte du marchand, montant, récapitulatif, PIN, reçu. Sandbox (ADR-017). */
export default function Pay() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { payload: rawPayload } = useLocalSearchParams<{ payload?: string }>();
  const payload = String(rawPayload ?? '');
  const enabled = useWalletEnabled();

  const [step, setStep] = useState<Step>('card');
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [needPin, setNeedPin] = useState(false);
  const [refused, setRefused] = useState(false);
  const clientId = useRef<{ sig: string; id: string } | null>(null);

  const resolved = useQuery({ queryKey: ['qr-resolve', payload], queryFn: () => resolveQr(payload), enabled: payload.length > 0 && enabled !== false, retry: false });
  const qr = resolved.data;
  const fixed = qr?.amountMinor ?? null;
  const parsed = qr ? validateFreeAmount(amount, qr.currency) : null;
  const minor = fixed ?? (parsed && 'minor' in parsed ? parsed.minor : null);
  const money = (m: number) => formatMoney(m, qr?.currency ?? 'USD', locale);
  const time = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const explain = (err: unknown) => payErrorMessage(err, t, money, time) ?? errorMessage(err, t, locale);

  const pay = useMutation({
    mutationFn: (pinValue: string) => {
      const sig = `${payload}|${minor}`;
      if (clientId.current?.sig !== sig) clientId.current = { sig, id: uuidv4() };
      return payQr({ clientId: clientId.current.id, payload, ...(fixed === null && minor !== null ? { amountMinor: minor } : {}), pin: pinValue });
    },
    onSuccess: () => {
      setStep('done');
      clientId.current = null;
      void qc.invalidateQueries({ queryKey: walletKeys.wallet });
      void qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
    },
    onError: (err) => {
      const f = classifyPayError(err);
      const w = f.kind === 'wallet' ? classifyWalletError(err).kind : null;
      const text = explain(err);
      setPin('');
      if (f.kind === 'pin_locked' || w === 'pin_invalid') return setPinError(text);
      if (w === 'pin_not_set') {
        setNeedPin(true);
        return setPinError(text);
      }
      // QR refusé, fonds, limite, compte gelé, réseau : retour en arrière, même clientId pour un réessai.
      if (isQrRefusal(err)) setRefused(true);
      setError(text);
      setStep(f.kind === 'qr' && f.reason === 'amount_required' ? 'card' : 'review');
    },
  });

  function onPin(v: string) {
    setPin(v);
    setPinError(null);
    if (v.length === PIN_LENGTH && !pay.isPending) pay.mutate(v);
  }

  const title = <Stack.Screen options={{ title: t('pay.title') }} />;

  if (enabled === false) {
    return (
      <>
        {title}
        <View style={styles.pad}>
          <Text muted>{t('wallet.emptyBody')}</Text>
        </View>
      </>
    );
  }
  if (!payload) {
    return (
      <>
        {title}
        <View style={styles.pad}>
          <Text muted>{t('scan.unknown')}</Text>
          <Button label={t('pay.rescan')} onPress={() => router.replace('/scan')} />
        </View>
      </>
    );
  }
  if (resolved.isPending || enabled === undefined) return <>{title}<Loading /></>;
  if (resolved.isError || !qr) {
    const text = explain(resolved.error);
    return (
      <>
        {title}
        <ScrollView contentContainerStyle={styles.pad}>
          <SandboxBanner />
          <Text variant="heading" accessibilityRole="header">
            {t('pay.cannotPay')}
          </Text>
          <Text color={colors.danger} accessibilityRole="alert">
            {isQrRefusal(resolved.error) || classifyPayError(resolved.error).kind === 'qr' ? text : ''}
          </Text>
          {classifyPayError(resolved.error).kind === 'qr' ? <Button label={t('pay.rescan')} onPress={() => router.replace('/scan')} /> : <ErrorState error={resolved.error} onRetry={() => resolved.refetch()} />}
        </ScrollView>
      </>
    );
  }

  const merchant = (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Avatar name={qr.org.name} size={56} />
      <View style={styles.nameRow}>
        <Text variant="heading" numberOfLines={2} style={{ flexShrink: 1, textAlign: 'center' }}>
          {qr.org.name}
        </Text>
        {qr.org.verified ? <Badge tone="accent" label={t('pay.verified')} /> : null}
      </View>
      {qr.label ? <Text muted>{qr.label}</Text> : null}
      {fixed !== null ? (
        <Text variant="display" color={colors.primary}>
          {money(fixed)}
        </Text>
      ) : null}
    </View>
  );

  if (step === 'done') {
    const res = pay.data;
    return (
      <>
        {title}
        <ScrollView contentContainerStyle={styles.pad}>
          <SandboxBanner />
          <View style={styles.center}>
            <Ionicons name="checkmark-circle" size={56} color={colors.success} />
            <Text variant="title" accessibilityRole="header">
              {t('pay.doneTitle')}
            </Text>
          </View>
          <View style={[styles.summary, { backgroundColor: colors.surface }]}>
            <Row k={t('pay.merchant')} v={res?.org.name ?? qr.org.name} />
            <Row k={t('pay.amount')} v={money(res?.amountMinor ?? minor ?? 0)} strong />
            <Row k={t('pay.date')} v={new Date().toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' })} />
            <Row k={t('pay.ref')} v={res?.transferId ?? ''} />
          </View>
          {res?.replayed ? <Text variant="small" muted>{t('pay.replayed')}</Text> : null}
          <Button label={t('pay.finish')} onPress={() => router.replace('/wallet')} />
        </ScrollView>
      </>
    );
  }

  if (step === 'pin') {
    return (
      <>
        {title}
        <ScrollView contentContainerStyle={[styles.pad, { alignItems: 'center' }]}>
          <View style={{ alignSelf: 'stretch' }}>
            <SandboxBanner />
          </View>
          <Text variant="heading" accessibilityRole="header">
            {t('wallet.send.pinTitle')}
          </Text>
          <Text muted style={{ textAlign: 'center' }}>
            {t('pay.pinHint', { amount: money(minor ?? 0), name: qr.org.name })}
          </Text>
          <PinPad value={pin} onChange={onPin} disabled={pay.isPending} error={pinError} />
          {pay.isPending ? <Text muted>{t('pay.paying')}</Text> : null}
          {needPin ? <Button label={t('wallet.send.createPin')} onPress={() => router.push('/wallet/pin')} /> : null}
          <Button variant="ghost" label={t('common.cancel')} disabled={pay.isPending} onPress={() => { setPin(''); setPinError(null); setStep('review'); }} />
        </ScrollView>
      </>
    );
  }

  if (step === 'review') {
    return (
      <>
        {title}
        <ScrollView contentContainerStyle={styles.pad}>
          <SandboxBanner />
          <Text variant="heading" accessibilityRole="header">
            {t('wallet.send.review')}
          </Text>
          <View style={[styles.summary, { backgroundColor: colors.surface }]}>
            <Row k={t('pay.merchant')} v={qr.org.name} />
            {qr.label ? <Row k={t('pay.label')} v={qr.label} /> : null}
            <Row k={t('pay.amount')} v={money(minor ?? 0)} strong />
          </View>
          {error ? (
            <Text color={colors.danger} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {refused ? (
            <Button label={t('pay.rescan')} onPress={() => router.replace('/scan')} />
          ) : (
            <Button label={t('pay.confirm')} onPress={() => { setError(null); setPinError(null); setNeedPin(false); setStep('pin'); }} />
          )}
          {fixed === null && !refused ? <Button variant="secondary" label={t('wallet.send.edit')} onPress={() => { setError(null); setStep('card'); }} /> : null}
        </ScrollView>
      </>
    );
  }

  return (
    <>
      {title}
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <SandboxBanner />
        {merchant}
        {fixed === null ? (
          <TextField
            label={t('pay.amountLabel', { currency: qr.currency })}
            value={amount}
            onChangeText={(v) => {
              setAmount(v);
              setError(null);
            }}
            keyboardType="decimal-pad"
            placeholder="0,00"
            error={amount && minor === null ? t('wallet.error.amount') : null}
          />
        ) : null}
        {error ? (
          <Text color={colors.danger} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label={t('wallet.send.continue')} disabled={minor === null} onPress={() => { setError(null); setStep('review'); }} />
      </ScrollView>
    </>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${k}: ${v}`} style={{ gap: 2 }}>
      <Text variant="caption" muted>
        {k}
      </Text>
      <Text variant={strong ? 'heading' : 'body'} selectable>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  summary: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  center: { alignItems: 'center', gap: spacing.sm },
});
