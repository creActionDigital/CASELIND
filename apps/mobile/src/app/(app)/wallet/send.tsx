import { WALLET_NOTE_MAX } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { uuidv4 } from '../../../lib/uuid';
import { formatMoney } from '../../../shop/format';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Avatar, Button, Text, TextField } from '../../../ui';
import { Chips } from '../../../seller/ui';
import { parseWalletAmount, WALLET_CURRENCIES } from '../../../wallet/amount';
import { classifyWalletError, failureMessage } from '../../../wallet/errors';
import { fetchUserByHandle, sendTransfer } from '../../../wallet/api';
import { useKyc, useWalletEnabled, walletKeys } from '../../../wallet/hooks';
import { PIN_LENGTH } from '../../../wallet/pin';
import { useWalletPrefs } from '../../../wallet/prefs';
import { PinPad, SandboxBanner } from '../../../wallet/ui';

const HANDLE_RE = /^[a-zA-Z0-9_.]{3,30}$/;
type Step = 'form' | 'review' | 'pin' | 'done';

/** Envoi P2P : destinataire, montant, récapitulatif, PIN. Le `clientId` est conservé tant que les données ne changent pas. */
export default function WalletSend() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useAuth();
  const params = useLocalSearchParams<{ to?: string }>();
  const enabled = useWalletEnabled();
  const prefs = useWalletPrefs();
  const kyc = useKyc();

  const [step, setStep] = useState<Step>('form');
  const [handle, setHandle] = useState(params.to ?? '');
  const [debounced, setDebounced] = useState(handle);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>(prefs.currency);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [needPin, setNeedPin] = useState(false);
  const [newBalance, setNewBalance] = useState<number | null>(null);
  const clientId = useRef<{ sig: string; id: string } | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(handle), 400);
    return () => clearTimeout(h);
  }, [handle]);

  const clean = handle.trim().replace(/^@/, '').toLowerCase();
  const cleanDebounced = debounced.trim().replace(/^@/, '').toLowerCase();
  const handleOk = HANDLE_RE.test(clean);
  const isSelf = !!me && clean === me.handle.toLowerCase();
  const lookup = useQuery({
    queryKey: ['wallet-recipient', cleanDebounced],
    queryFn: () => fetchUserByHandle(cleanDebounced),
    enabled: HANDLE_RE.test(cleanDebounced) && cleanDebounced === clean && cleanDebounced !== me?.handle.toLowerCase(),
    retry: false,
    staleTime: 60_000,
  });
  const recipient = lookup.data && lookup.data.handle.toLowerCase() === clean ? lookup.data : null;

  const parsed = parseWalletAmount(amount, currency);
  const minor = 'minor' in parsed ? parsed.minor : null;
  const noteTooLong = note.trim().length > WALLET_NOTE_MAX;
  const canReview = !!recipient && !isSelf && minor !== null && !noteTooLong;

  const limitOf = (c: string) => kyc.data?.limits.find((l) => l.currency === c)?.maxSingleTransferMinor;
  const explain = (err: unknown): { text: string; kind: ReturnType<typeof classifyWalletError>['kind'] } => {
    const f = classifyWalletError(err);
    const withLimit = f.kind === 'limit_exceeded' && f.limitMinor === undefined && limitOf(currency) !== undefined ? { ...f, limitMinor: limitOf(currency) } : f;
    return {
      text: failureMessage(withLimit, t, (m) => formatMoney(m, currency, locale)) ?? errorMessage(err, t, locale),
      kind: f.kind,
    };
  };

  const send = useMutation({
    mutationFn: (pinValue: string) => {
      const sig = `${clean}|${minor}|${currency}|${note.trim()}`;
      if (clientId.current?.sig !== sig) clientId.current = { sig, id: uuidv4() };
      return sendTransfer({ clientId: clientId.current.id, toHandle: clean, amountMinor: minor!, currency, note: note.trim() || undefined, pin: pinValue });
    },
    onSuccess: (res) => {
      setNewBalance(res.balanceMinor);
      setStep('done');
      clientId.current = null;
      void qc.invalidateQueries({ queryKey: walletKeys.wallet });
      void qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
    },
    onError: (err) => {
      const { text, kind } = explain(err);
      setPin('');
      if (kind === 'pin_invalid' || kind === 'pin_locked') return setPinError(text);
      if (kind === 'pin_not_set') {
        setNeedPin(true);
        return setPinError(text);
      }
      // Fonds, limite, destinataire, compte gelé, réseau : retour au récapitulatif, même clientId pour un réessai.
      setError(text);
      setStep('review');
    },
  });

  function onPin(v: string) {
    setPin(v);
    setPinError(null);
    if (v.length === PIN_LENGTH && !send.isPending) send.mutate(v);
  }

  if (enabled === false) {
    return (
      <View style={styles.pad}>
        <Text muted>{t('wallet.emptyBody')}</Text>
      </View>
    );
  }

  const title = <Stack.Screen options={{ title: t('wallet.send.title') }} />;

  if (step === 'done') {
    return (
      <>
        {title}
        <ScrollView contentContainerStyle={styles.pad}>
          <SandboxBanner />
          <Text variant="title" accessibilityRole="header">
            {t('wallet.send.doneTitle')}
          </Text>
          <Text>{t('wallet.send.doneBody', { amount: formatMoney(minor ?? 0, currency, locale), name: recipient?.displayName ?? `@${clean}` })}</Text>
          {newBalance !== null ? (
            <Text muted>{t('wallet.send.newBalance', { amount: formatMoney(newBalance, currency, locale) })}</Text>
          ) : null}
          <Button label={t('wallet.send.finish')} onPress={() => router.replace('/wallet')} />
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
            {t('wallet.send.pinHint', { amount: formatMoney(minor ?? 0, currency, locale), name: recipient?.displayName ?? `@${clean}` })}
          </Text>
          <PinPad value={pin} onChange={onPin} disabled={send.isPending} error={pinError} />
          {send.isPending ? <Text muted>{t('wallet.send.sending')}</Text> : null}
          {needPin ? <Button label={t('wallet.send.createPin')} onPress={() => router.push('/wallet/pin')} /> : null}
          <Button variant="ghost" label={t('common.cancel')} onPress={() => { setPin(''); setPinError(null); setStep('review'); }} disabled={send.isPending} />
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
            <Row k={t('wallet.send.to')} v={`${recipient?.displayName ?? ''} (@${clean})`} />
            <Row k={t('wallet.send.amount')} v={formatMoney(minor ?? 0, currency, locale)} strong />
            {note.trim() ? <Row k={t('wallet.send.note')} v={note.trim()} /> : null}
          </View>
          {error ? (
            <Text color={colors.danger} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button label={t('wallet.send.confirm')} onPress={() => { setError(null); setPinError(null); setNeedPin(false); setStep('pin'); }} />
          <Button variant="secondary" label={t('wallet.send.edit')} onPress={() => { setError(null); setStep('form'); }} />
        </ScrollView>
      </>
    );
  }

  return (
    <>
      {title}
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <SandboxBanner />
        <TextField
          label={t('wallet.send.recipient')}
          hint={t('wallet.send.recipientHint')}
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="@handle"
          error={isSelf ? t('wallet.error.self') : handleOk && lookup.isError ? t('wallet.error.recipient') : null}
        />
        {recipient ? (
          <View style={[styles.preview, { backgroundColor: colors.surface }]} accessible accessibilityLabel={t('wallet.send.recipientFound', { name: recipient.displayName, handle: recipient.handle })}>
            <Avatar name={recipient.displayName} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600' }} numberOfLines={1}>
                {recipient.displayName}
              </Text>
              <Text variant="small" muted numberOfLines={1}>
                @{recipient.handle}
              </Text>
            </View>
          </View>
        ) : null}
        <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as 'USD' | 'CDF'} onChange={setCurrency} scroll={false} />
        <TextField
          label={t('wallet.send.amount')}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0,00"
          error={amount && minor === null ? t('wallet.error.amount') : null}
        />
        <TextField
          label={t('wallet.send.noteLabel')}
          value={note}
          onChangeText={setNote}
          maxLength={WALLET_NOTE_MAX}
          hint={`${note.length}/${WALLET_NOTE_MAX}`}
        />
        <Button label={t('wallet.send.continue')} disabled={!canReview} onPress={() => setStep('review')} />
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
      <Text variant={strong ? 'heading' : 'body'}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  summary: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
});
