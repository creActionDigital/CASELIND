import type { FeatureFlag } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { cck, fetchFlags, updateFlag } from '../../../admin/console-api';
import { CONFIRM_WORD, FLAG_ROLES, isConfirmWord, needsStrongConfirm, parseCountries } from '../../../admin/console-logic';
import { Denied, adminErrorMessage, adminStyles, isDenied, useHasRole } from '../../../admin/kit';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Loading } from '../../../seller/ui';
import { Badge, Button, EmptyState, ErrorState, Screen, Text, TextField } from '../../../ui';

type Pending = { kind: 'toggle' } | { kind: 'scope' };

function FlagCard({ flag }: { flag: FeatureFlag }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [word, setWord] = useState('');
  const [countries, setCountries] = useState((flag.allowedCountries ?? []).join(', '));
  const [roles, setRoles] = useState<string[]>(flag.allowedRoles ?? []);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (b: Parameters<typeof updateFlag>[1]) => updateFlag(flag.key, b),
    onSuccess: (res) => {
      setPending(null); setWord(''); setError(null);
      setNotice('approvalId' in res ? t('adm.flags.awaitingApproval') : null);
      void qc.invalidateQueries({ queryKey: cck.all });
    },
    onError: (e) => setError(adminErrorMessage(e, t, locale)),
  });

  const parsed = parseCountries(countries);
  const nextEnabled = pending?.kind === 'toggle' ? !flag.enabled : flag.enabled;
  const strong = pending ? needsStrongConfirm(flag, nextEnabled) : false;
  const ready = pending && (!strong || isConfirmWord(word)) && (pending.kind === 'toggle' || parsed !== undefined);

  const apply = () => {
    if (!pending) return;
    const body: Parameters<typeof updateFlag>[1] =
      pending.kind === 'toggle' ? { enabled: !flag.enabled } : { allowedCountries: parsed ?? null, allowedRoles: roles.length ? roles : null };
    if (strong) body.confirmRegulated = true;
    const verb = pending.kind === 'toggle' ? t(flag.enabled ? 'adm.flags.disable' : 'adm.flags.enable') : t('adm.flags.save');
    alertConfirm(t('adm.confirmTitle'), t('adm.confirmBody', { action: verb, name: flag.key }), [
      { text: t('adm.cancel'), style: 'cancel' },
      { text: verb, onPress: () => save.mutate(body) },
    ]);
  };

  return (
    <Card style={adminStyles.cardFlat}>
      <Text variant="bodyStrong">{flag.key}</Text>
      <Text variant="small" muted>{flag.description}</Text>
      <View style={adminStyles.badges}>
        <Badge tone={flag.enabled ? 'primary' : 'neutral'} label={t(flag.enabled ? 'adm.flags.on' : 'adm.flags.off')} />
        {flag.regulated ? <Badge tone="accent" label={t('adm.flags.regulated')} /> : null}
      </View>
      <Text variant="small" muted>{t('adm.flags.countries', { list: flag.allowedCountries?.join(', ') ?? t('adm.flags.everyone') })}</Text>
      <Text variant="small" muted>{t('adm.flags.roles', { list: flag.allowedRoles?.map((r) => t(`adm.flags.role.${r}` as MessageKey)).join(', ') ?? t('adm.flags.everyone') })}</Text>
      {notice ? <Text variant="small" accessibilityLiveRegion="polite">{notice}</Text> : null}
      {!pending ? (
        <View style={adminStyles.badges}>
          <Button variant={flag.enabled ? 'secondary' : 'primary'} label={t(flag.enabled ? 'adm.flags.disable' : 'adm.flags.enable')} onPress={() => { setPending({ kind: 'toggle' }); setError(null); }} />
          <Button variant="ghost" label={t('adm.flags.edit')} onPress={() => { setPending({ kind: 'scope' }); setError(null); }} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {pending.kind === 'scope' ? (
            <>
              <TextField label={t('adm.flags.fieldCountries')} value={countries} onChangeText={setCountries} autoCapitalize="characters" maxLength={200} />
              {parsed === undefined ? <Text variant="small" accessibilityLiveRegion="polite">{t('adm.flags.badCountries')}</Text> : null}
              <Text variant="small" muted>{t('adm.flags.fieldRoles')}</Text>
              <View style={adminStyles.badges}>
                {FLAG_ROLES.map((r) => {
                  const on = roles.includes(r);
                  return (
                    <Button
                      key={r}
                      variant={on ? 'primary' : 'secondary'}
                      label={t(`adm.flags.role.${r}` as MessageKey)}
                      accessibilityLabel={`${t(`adm.flags.role.${r}` as MessageKey)}, ${t(on ? 'adm.flags.on' : 'adm.flags.off')}`}
                      onPress={() => setRoles(on ? roles.filter((x) => x !== r) : [...roles, r])}
                    />
                  );
                })}
              </View>
            </>
          ) : null}
          {strong ? (
            <>
              <Text variant="small">{t('adm.flags.strong', { word: CONFIRM_WORD })}</Text>
              <TextField label={t('adm.flags.strongField')} value={word} onChangeText={setWord} autoCapitalize="characters" autoCorrect={false} maxLength={20} />
            </>
          ) : null}
          {error ? <Text variant="small" accessibilityLiveRegion="polite">{error}</Text> : null}
          <Button label={pending.kind === 'toggle' ? t(flag.enabled ? 'adm.flags.disable' : 'adm.flags.enable') : t('adm.flags.save')} loading={save.isPending} disabled={!ready} onPress={apply} />
          <Button variant="ghost" label={t('adm.cancel')} onPress={() => { setPending(null); setWord(''); setError(null); }} />
        </View>
      )}
    </Card>
  );
}

/** Drapeaux de fonctionnalité : activation et portée (pays, rôles). Activer un module réglementé exige de saisir ACTIVER. */
export default function Flags() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin']);
  const q = useQuery({ queryKey: cck.list('flags'), queryFn: fetchFlags, enabled: allowed });
  if (!allowed || isDenied(q.error)) return <Denied />;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('adm.flags.title') }} />
      <Button variant="ghost" label={t('adm.refresh')} loading={q.isRefetching} onPress={() => void q.refetch()} />
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? <EmptyState icon="toggle-outline" title={t('adm.empty')} /> : q.data.items.map((f) => <FlagCard key={f.key} flag={f} />)}
    </Screen>
  );
}
