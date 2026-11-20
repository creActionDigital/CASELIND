import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { useI18n } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { uuidv4 } from '../lib/uuid';
import { formatMoney } from '../shop/format';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { WALLET_CURRENCIES } from '../wallet/amount';
import { classifyWalletError, failureMessage } from '../wallet/errors';
import { PIN_LENGTH } from '../wallet/pin';
import { PinPad, SandboxBanner } from '../wallet/ui';
import { boostPost, tipPost, tipUser } from './api';
import { boostRange, parseBoostBudget, parseBoostDays, parseTipAmount, tipMax } from './logic';

export type PayTarget =
  | { mode: 'tip'; postId: string; name: string }
  | { mode: 'tip'; userId: string; name: string }
  | { mode: 'boost'; postId: string };

type Step = 'form' | 'pin' | 'done';

/**
 * Feuille de paiement en mode test : pourboire (publication ou profil) ou boost d'une publication. Montant, devise, puis code PIN
 * du portefeuille (PinPad). Le `clientId` d'idempotence est gardé tant que les données ne changent pas ; l'argent est fictif.
 */
export function PaySheet({ target, onClose }: { target: PayTarget | null; onClose: () => void }) {
  return (
    <SheetModal visible={target !== null} onClose={onClose}>
      {target ? <PayBody key={JSON.stringify(target)} target={target} onClose={onClose} /> : null}
    </SheetModal>
  );
}

function PayBody({ target, onClose }: { target: PayTarget; onClose: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const boost = target.mode === 'boost';
  const [step, setStep] = useState<Step>('form');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('3');
  const [currency, setCurrency] = useState<string>(WALLET_CURRENCIES[0]);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [doneText, setDoneText] = useState('');
  const key = useRef<{ sig: string; id: string } | null>(null);

  const parsed = boost ? parseBoostBudget(amount, currency) : parseTipAmount(amount, currency);
  const minor = 'minor' in parsed ? parsed.minor : null;
  const dayCount = parseBoostDays(days);
  const money = (m: number) => formatMoney(m, currency, locale);

  const amountError = (): string | null => {
    if (amount.trim() === '' || !('issue' in parsed)) return null;
    if (parsed.issue === 'too_low') return t('creator.boost.errLow', { min: money(boostRange(currency).min) });
    if (parsed.issue === 'too_high') return boost ? t('creator.boost.errHigh', { max: money(boostRange(currency).max) }) : t('creator.tip.errMax', { max: money(tipMax(currency)) });
    return boost ? t('creator.boost.errBudget') : t('creator.tip.errInvalid');
  };
  const canContinue = minor !== null && (!boost || dayCount !== null);

  const pay = useMutation({
    mutationFn: async (pinValue: string) => {
      const sig = `${boost ? 'b' : 't'}|${minor}|${currency}|${dayCount}`;
      if (key.current?.sig !== sig) key.current = { sig, id: uuidv4() };
      const clientId = key.current.id;
      if (target.mode === 'boost') {
        const r = await boostPost(target.postId, { clientId, days: dayCount!, budgetMinor: minor!, currency, pin: pinValue });
        return t('creator.boost.done', { date: new Date(r.boost.endsAt).toLocaleDateString(locale), amount: money(minor!) });
      }
      const body = { clientId, amountMinor: minor!, currency, pin: pinValue };
      if ('postId' in target) await tipPost(target.postId, body);
      else await tipUser(target.userId, body);
      return t('creator.tip.done', { amount: money(minor!) });
    },
    onSuccess: (text) => {
      setDoneText(text);
      setStep('done');
      key.current = null;
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
      void qc.invalidateQueries({ queryKey: ['creator-overview'] });
    },
    onError: (err) => {
      const f = classifyWalletError(err);
      const reason = err instanceof ApiRequestError ? err.detail<string>('reason') : undefined;
      const text =
        reason === 'boost_already_active'
          ? t('creator.boost.errActive')
          : reason === 'boost_requires_public_post'
            ? t('creator.boost.errPublic')
            : reason === 'tip_daily_limit'
              ? t('creator.tip.errDaily')
              : (failureMessage(f, t, money) ?? errorMessage(err, t, locale));
      setPin('');
      if (f.kind === 'pin_invalid' || f.kind === 'pin_locked' || f.kind === 'pin_not_set') setPinError(text);
      else {
        setError(text);
        setStep('form');
      }
    },
  });

  const onPin = (v: string) => {
    setPin(v);
    setPinError(null);
    if (v.length === PIN_LENGTH && !pay.isPending) pay.mutate(v);
  };

  if (step === 'done') {
    return (
      <View style={styles.gap}>
        <Text variant="heading" accessibilityRole="header">
          {doneText}
        </Text>
        <Button label={t('common.close')} onPress={onClose} />
      </View>
    );
  }

  const who = target.mode === 'tip' ? target.name : '';
  if (step === 'pin') {
    return (
      <View style={[styles.gap, { alignItems: 'center' }]}>
        <View style={{ alignSelf: 'stretch' }}>
          <SandboxBanner />
        </View>
        <Text muted style={{ textAlign: 'center' }}>
          {boost ? t('creator.boost.pinHint', { amount: money(minor ?? 0), days: dayCount ?? 0 }) : t('creator.tip.pinHint', { amount: money(minor ?? 0), name: who })}
        </Text>
        <PinPad value={pin} onChange={onPin} disabled={pay.isPending} error={pinError} />
        {pay.isPending ? <Text muted>{t('creator.tip.sending')}</Text> : null}
        <Button
          variant="ghost"
          label={t('common.cancel')}
          disabled={pay.isPending}
          onPress={() => {
            setPin('');
            setPinError(null);
            setStep('form');
          }}
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.gap} keyboardShouldPersistTaps="handled">
      <Text variant="heading" accessibilityRole="header">
        {boost ? t('creator.boost.title') : t('creator.tip.title')}
      </Text>
      <SandboxBanner />
      {target.mode === 'tip' ? <Text muted>{t('creator.tip.to', { name: target.name })}</Text> : <Text muted>{t('creator.boost.explain')}</Text>}
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('creator.tip.currency')}>
        {WALLET_CURRENCIES.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="radio"
            accessibilityState={{ selected: currency === c }}
            accessibilityLabel={c}
            onPress={() => setCurrency(c)}
            style={[styles.chip, { borderColor: currency === c ? colors.primary : colors.border, backgroundColor: currency === c ? colors.primarySoft : 'transparent' }]}
          >
            <Text color={currency === c ? colors.primary : undefined}>{c}</Text>
          </Pressable>
        ))}
      </View>
      <TextField
        label={boost ? t('creator.boost.budget') : t('creator.tip.amount')}
        value={amount}
        onChangeText={(v) => {
          setAmount(v);
          setError(null);
        }}
        keyboardType="decimal-pad"
        error={amountError()}
      />
      {boost ? (
        <TextField
          label={t('creator.boost.days')}
          value={days}
          onChangeText={setDays}
          keyboardType="number-pad"
          maxLength={2}
          error={dayCount === null && days !== '' ? t('creator.boost.errDays') : null}
        />
      ) : null}
      {error ? (
        <Text color={colors.danger} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('creator.tip.next')}
        disabled={!canContinue}
        onPress={() => {
          setError(null);
          setPinError(null);
          setStep('pin');
        }}
      />
      <Button variant="secondary" label={t('common.cancel')} onPress={onClose} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md, paddingBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, minHeight: 44, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1 },
});
