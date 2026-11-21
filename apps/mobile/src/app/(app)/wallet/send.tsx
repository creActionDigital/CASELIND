import { WALLET_NOTE_MAX } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WalletTransaction } from '@caselind/contracts';
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
import { useKyc, useTransactions, useWalletEnabled, walletKeys } from '../../../wallet/hooks';
import { inPeriod, type Period } from '../../../wallet/history';
import { counterpartyName } from '../../../wallet/ui';
import { PIN_LENGTH } from '../../../wallet/pin';
import { cleanHandle, HANDLE_RE } from '../../../wallet/finance/logic';
import { useWalletPrefs } from '../../../wallet/prefs';
import { PinPad, SandboxBanner } from '../../../wallet/ui';

const PERIODS: Period[] = ['week', 'month', 'year'];
type Step = 'form' | 'review' | 'pin' | 'done';

/** Envoi P2P : destinataire, montant, récapitulatif, PIN. Le `clientId` est conservé tant que les données ne changent pas. */
export default function WalletSend() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useAuth();
  const params = useLocalSearchParams<{ to?: string; amount?: string; currency?: string }>();
  const enabled = useWalletEnabled();
  const prefs = useWalletPrefs();
  const kyc = useKyc();

  const [step, setStep] = useState<Step>('form');
  const [handle, setHandle] = useState(params.to ?? '');
  const [debounced, setDebounced] = useState(handle);
  const [amount, setAmount] = useState(() => (/^\d{1,12}$/.test(params.amount ?? '') && (params.currency === 'USD' || params.currency === 'CDF') ? (Number(params.amount) / 100).toFixed(2) : ''));
  const [currency, setCurrency] = useState<string>(params.currency === 'USD' || params.currency === 'CDF' ? params.currency : prefs.currency);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [needPin, setNeedPin] = useState(false);
  const [newBalance, setNewBalance] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const clientId = useRef<{ sig: string; id: string } | null>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  const recents = useTransactions(prefs.currency);
  const recentItems = (recents.data?.pages.flatMap((p) => p.items) ?? []).filter((x) => x.counterparty?.kind === 'user');
  const suggested = recentItems.reduce<{ handle: string; name: string }[]>((acc, x) => {
    const cp = x.counterparty;
    if (cp?.kind === 'user' && !acc.some((a) => a.handle === cp.handle) && acc.length < 8) acc.push({ handle: cp.handle, name: cp.displayName });
    return acc;
  }, []);
  const periodItems = recentItems.filter((x) => inPeriod(x.createdAt, period)).slice(0, 8);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(handle), 400);
    return () => clearTimeout(h);
  }, [handle]);

  const clean = cleanHandle(handle);
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
          <Button variant="ghost" label={t('wf.pin.forgot')} onPress={() => router.push('/wallet/pin')} disabled={send.isPending} />
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
        <Text variant="bodyStrong" accessibilityRole="header">
          {t('wallet.send.suggested')}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.lg }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('wallet.send.add')} onPress={() => setFocusSearch(true)} style={styles.contact}>
            <View style={[styles.addCircle, { borderColor: colors.border }]}>
              <Ionicons name="add" size={24} color={colors.textMuted} />
            </View>
            <Text variant="caption" muted numberOfLines={1}>
              {t('wallet.send.add')}
            </Text>
          </Pressable>
          {suggested.map((c) => (
            <Pressable key={c.handle} accessibilityRole="button" accessibilityLabel={`${c.name}, @${c.handle}`} onPress={() => setHandle(c.handle)} style={styles.contact}>
              <Avatar name={c.name} size={56} />
              <Text variant="caption" numberOfLines={1} style={{ maxWidth: 64 }}>
                {c.name.split(' ')[0]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <TextField
          key={focusSearch ? 'f' : 'n'}
          autoFocus={focusSearch}
          label={t('wallet.send.recipient')}
          hint={t('wallet.send.searchHint')}
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('wallet.send.searchPlaceholder')}
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
        <Text variant="bodyStrong" accessibilityRole="header" style={{ marginTop: spacing.sm }}>
          {t('wallet.send.recentTitle')}
        </Text>
        <View style={[styles.tabs, { backgroundColor: colors.surfaceAlt }]}>
          {PERIODS.map((p) => (
            <Pressable
              key={p}
              accessibilityRole="tab"
              accessibilityState={{ selected: period === p }}
              onPress={() => setPeriod(p)}
              style={[styles.tab, period === p && { backgroundColor: colors.surface }]}
            >
              <Text variant="caption" style={{ fontWeight: period === p ? '600' : '400' }}>
                {t(`wallet.period.${p}` as const)}
              </Text>
            </Pressable>
          ))}
        </View>
        {periodItems.length === 0 ? (
          <Text variant="small" muted>
            {t('wallet.send.noRecent')}
          </Text>
        ) : (
          periodItems.map((x: WalletTransaction) => (
            <Pressable
              key={x.id}
              accessibilityRole="button"
              accessibilityLabel={counterpartyName(x.counterparty, t)}
              onPress={() => x.counterparty?.kind === 'user' && setHandle(x.counterparty.handle)}
              style={[styles.recent, { backgroundColor: colors.surface }]}
            >
              <Avatar name={counterpartyName(x.counterparty, t)} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }} numberOfLines={1}>
                  {counterpartyName(x.counterparty, t)}
                </Text>
                <Text variant="small" muted numberOfLines={1}>
                  {x.note ?? new Date(x.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <Text style={{ fontWeight: '600' }} color={x.direction === 'in' ? colors.success : colors.text}>
                {x.direction === 'in' ? '+' : '−'}
                {formatMoney(x.amountMinor, x.currency, locale)}
              </Text>
            </Pressable>
          ))
        )}
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
  contact: { alignItems: 'center', gap: spacing.xs, minWidth: 64, minHeight: 44 },
  addCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', borderRadius: radius.pill, padding: 3 },
  tab: { flex: 1, minHeight: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  recent: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, minHeight: 56 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
});
