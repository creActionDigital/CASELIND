import { PersonField } from '../../../components/PersonField';
import type { Person } from '../../../people/logic';
import { SCHEDULED_NOTE_MAX, type ScheduledFrequency, type ScheduledPayment } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { uuidv4 } from '../../../lib/uuid';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Chips } from '../../../seller/ui';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';
import { parseWalletAmount, WALLET_CURRENCIES } from '../../../wallet/amount';
import { createScheduled, fetchNextRuns, fetchScheduled, fetchScheduledDetail, setScheduledState, walletFinanceKeys } from '../../../wallet/finance/api';
import { financeErrorMessage } from '../../../wallet/finance/errors';
import { cleanHandle, HANDLE_RE, parseDateOnly, parseLocalDateTime, quickDateTime } from '../../../wallet/finance/logic';
import { Card, FinanceHeader, PinPrompt } from '../../../wallet/finance/ui';

/** Paiements programmés (mode test) : une fois, chaque semaine ou chaque mois, autorisés par votre PIN. */
export default function WalletScheduled() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [handle, setHandle] = useState('');
  const [person, setPerson] = useState<Person | null>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [note, setNote] = useState('');
  const [frequency, setFrequency] = useState<ScheduledFrequency>('monthly');
  const [first, setFirst] = useState('');
  const [ends, setEnds] = useState('');
  const [maxRuns, setMaxRuns] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needPin, setNeedPin] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const clientId = useRef<{ sig: string; id: string } | null>(null);

  const list = useQuery({ queryKey: walletFinanceKeys.scheduled, queryFn: fetchScheduled });
  const refresh = () => void qc.invalidateQueries({ queryKey: walletFinanceKeys.scheduled });

  const clean = cleanHandle(handle);
  const parsed = parseWalletAmount(amount, currency);
  const minor = 'minor' in parsed ? parsed.minor : null;
  const firstIso = parseLocalDateTime(first);
  const endsOn = ends.trim() ? parseDateOnly(ends) : undefined;
  const max = maxRuns.trim() ? Number(maxRuns) : undefined;

  function validate(): boolean {
    if (!HANDLE_RE.test(clean)) return fail(t('wf.req.err.handle'));
    if (minor === null) return fail(t('wf.req.err.amount'));
    if (!firstIso) return fail(t('wf.sch.err.date'));
    if (endsOn === null) return fail(t('wf.sch.err.ends'));
    if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 1000)) return fail(t('wf.sch.err.max'));
    setError(null);
    return true;
  }
  function fail(msg: string): false {
    setError(msg);
    return false;
  }

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'cancel' }) => setScheduledState(id, action),
    onSuccess: refresh,
    onError: (err) => setError(financeErrorMessage(err, t, locale)),
  });

  if (needPin) {
    return (
      <>
        <Stack.Screen options={{ title: t('wf.sch.title') }} />
        <PinPrompt
          hint={`${t('wf.sch.pinHint')} ${formatMoney(minor ?? 0, currency, locale)} → @${clean}`}
          onCancel={() => setNeedPin(false)}
          onSubmit={async (pin) => {
            const sig = JSON.stringify([clean, minor, currency, note.trim(), frequency, firstIso, endsOn, max]);
            if (clientId.current?.sig !== sig) clientId.current = { sig, id: uuidv4() };
            await createScheduled({
              clientId: clientId.current.id,
              recipientHandle: clean,
              amountMinor: minor!,
              currency,
              note: note.trim() || undefined,
              frequency,
              firstRunAt: firstIso!,
              endsOn: endsOn ?? undefined,
              maxRuns: max,
              pin,
            });
            clientId.current = null;
            setNeedPin(false);
            setAmount('');
            setNote('');
            setFirst('');
            setEnds('');
            setMaxRuns('');
            refresh();
          }}
        />
      </>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('wf.sch.title') }} />
      <View style={{ gap: spacing.lg }}>
        <FinanceHeader />
        <Card>
          <Text variant="bodyStrong" accessibilityRole="header">
            {t('wf.sch.new')}
          </Text>
          <PersonField label={t('wf.sch.recipient')} value={clean ? { handle: clean, displayName: person?.displayName ?? clean, avatarUrl: person?.avatarUrl } : null} onChange={(x) => { setPerson(x); setHandle(x?.handle ?? ''); }} />
          <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as 'USD' | 'CDF'} onChange={setCurrency} scroll={false} />
          <TextField label={t('wf.amount')} value={amount} onChangeText={setAmount} maxLength={12} keyboardType="decimal-pad" placeholder="0,00" error={amount && minor === null ? t('wf.req.err.amount') : null} />
          <TextField label={t('wf.note')} value={note} onChangeText={setNote} maxLength={SCHEDULED_NOTE_MAX} />
          <Chips
            options={(['once', 'weekly', 'monthly'] as const).map((f) => ({ value: f as ScheduledFrequency, label: t(`wf.sch.freq.${f}` as const) }))}
            value={frequency}
            onChange={setFrequency}
            scroll={false}
          />
          <TextField label={t('wf.sch.first')} value={first} onChangeText={setFirst} maxLength={16} placeholder="2026-12-01 09:00" autoCapitalize="none" />
          <Chips
            options={(['tomorrow', 'week', 'month'] as const).map((k) => ({ value: k, label: t(`wf.sch.quick.${k}` as const) }))}
            value={null}
            onChange={(k) => setFirst(quickDateTime(k))}
            scroll={false}
          />
          <Text variant="caption" muted>
            {t('wf.sch.tz', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}
          </Text>
          {frequency !== 'once' ? (
            <>
              <TextField label={t('wf.sch.ends')} value={ends} onChangeText={setEnds} maxLength={10} placeholder="2027-06-30" autoCapitalize="none" />
              <TextField label={t('wf.sch.maxRuns')} value={maxRuns} onChangeText={setMaxRuns} keyboardType="number-pad" />
            </>
          ) : null}
          <Text variant="caption" muted>
            {t('wf.sch.limits')}
          </Text>
          {error ? (
            <Text color={colors.danger} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button label={t('wf.sch.create')} onPress={() => validate() && setNeedPin(true)} />
        </Card>

        {list.isPending ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data?.items.length === 0 ? (
          <Text muted>{t('wf.sch.empty')}</Text>
        ) : (
          list.data?.items.map((p) => (
            <PaymentCard
              key={p.id}
              p={p}
              expanded={open === p.id}
              onToggle={() => setOpen(open === p.id ? null : p.id)}
              onAction={(action) => {
                if (action !== 'cancel') return act.mutate({ id: p.id, action });
                alertConfirm(t('wf.sch.confirmCancel'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('wf.sch.cancel'), style: 'destructive', onPress: () => act.mutate({ id: p.id, action }) }]);
              }}
            />
          ))
        )}
      </View>
    </Screen>
  );
}

function PaymentCard({ p, expanded, onToggle, onAction }: { p: ScheduledPayment; expanded: boolean; onToggle: () => void; onAction: (a: 'pause' | 'resume' | 'cancel') => void }) {
  const { t, locale } = useI18n();
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const live = p.status === 'active' || p.status === 'paused';
  const detail = useQuery({ queryKey: ['wf-scheduled-detail', p.id, p.runsDone, p.status], queryFn: () => fetchScheduledDetail(p.id), enabled: expanded });
  const next = useQuery({ queryKey: ['wf-scheduled-next', p.id, p.runsDone, p.status], queryFn: () => fetchNextRuns(p.id, 5), enabled: expanded && live });
  return (
    <Card>
      <Text variant="bodyStrong">
        {formatMoney(p.amountMinor, p.currency, locale)} → @{p.recipient.handle}
      </Text>
      <Text muted>
        {t(`wf.sch.freq.${p.frequency}` as const)} · {t(`wf.status.${p.status}` as const)} · {t('wf.sch.runs', { n: p.runsDone })}
      </Text>
      {p.nextRunAt && live ? <Text variant="small">{t('wf.sch.nextRun', { date: fmt(p.nextRunAt) })}</Text> : null}
      {p.note ? <Text variant="small" muted>{p.note}</Text> : null}
      <View style={styles.actions}>
        {p.status === 'active' ? <Button variant="secondary" label={t('wf.sch.pause')} onPress={() => onAction('pause')} /> : null}
        {p.status === 'paused' ? <Button variant="secondary" label={t('wf.sch.resume')} onPress={() => onAction('resume')} /> : null}
        {live ? <Button variant="secondary" label={t('wf.sch.cancel')} onPress={() => onAction('cancel')} /> : null}
        <Button variant="ghost" label={expanded ? '−' : t('wf.sch.history')} accessibilityLabel={t('wf.sch.history')} onPress={onToggle} />
      </View>
      {expanded ? (
        <View style={{ gap: spacing.xs }}>
          {live && next.data ? (
            <>
              <Text variant="small" style={{ fontWeight: '600' }}>
                {t('wf.sch.next')}
              </Text>
              {next.data.items.map((d) => (
                <Text key={d} variant="small" muted>
                  {fmt(d)}
                </Text>
              ))}
            </>
          ) : null}
          <Text variant="small" style={{ fontWeight: '600' }}>
            {t('wf.sch.history')}
          </Text>
          {detail.data?.runs.map((r, i) => (
            <Text key={`${r.runNumber}-${i}`} variant="small" muted>
              #{r.runNumber} · {fmt(r.ranAt)} · {r.status === 'ok' ? t('wf.sch.run.ok') : t('wf.sch.run.failed', { code: r.errorCode ?? '?' })}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
