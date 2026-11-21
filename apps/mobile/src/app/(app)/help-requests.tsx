import { HELP_CATEGORIES } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../i18n';
import { ApiRequestError } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { createHelp, fetchMyHelp, mdKeys } from '../../messaging/module-d-api';
import { Card, Chips, Loading } from '../../seller/ui';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../ui';

/** Support CASELIND : formulaire de demande d'aide et suivi des réponses de l'équipe. */
export default function HelpRequests() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: mdKeys.help, queryFn: fetchMyHelp });
  const [category, setCategory] = useState<(typeof HELP_CATEGORIES)[number]>('other');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const valid = subject.trim().length >= 3 && body.trim().length >= 5;
  const send = useMutation({
    mutationFn: () => createHelp({ category, subject: subject.trim(), body: body.trim() }),
    onSuccess: () => {
      setSubject('');
      setBody('');
      setSent(true);
      void qc.invalidateQueries({ queryKey: mdKeys.help });
    },
  });
  const err = send.error;
  const errText = !err ? null : err instanceof ApiRequestError && err.detail<string>('reason') === 'too_many_open' ? t('md.help.err.tooManyOpen') : errorMessage(err, t, locale);
  return (
    <Screen>
      <Stack.Screen options={{ title: t('md.help.title') }} />
      <Text variant="title" accessibilityRole="header">{t('md.help.title')}</Text>
      <Text muted style={{ marginBottom: spacing.md }}>{t('md.help.intro')}</Text>
      <Text variant="small" style={{ fontWeight: '600' }}>{t('md.help.category')}</Text>
      <Chips
        value={category}
        onChange={(c) => { setCategory(c); setSent(false); }}
        options={HELP_CATEGORIES.map((c) => ({ value: c, label: t(`md.help.cat.${c}` as MessageKey) }))}
      />
      <TextField label={t('md.help.subject')} value={subject} onChangeText={(v) => { setSubject(v); setSent(false); }} maxLength={120} />
      <TextField label={t('md.help.body')} value={body} onChangeText={(v) => { setBody(v); setSent(false); }} maxLength={2000} multiline numberOfLines={5} />
      {!valid && (subject || body) ? <Text variant="caption" muted>{t('md.help.err.short')}</Text> : null}
      {errText ? <Text color={colors.danger} accessibilityRole="alert">{errText}</Text> : null}
      {sent ? <Text accessibilityRole="alert">{t('md.help.sent')}</Text> : null}
      <Button label={t('md.help.send')} onPress={() => send.mutate()} loading={send.isPending} disabled={!valid} />
      <Text variant="heading" accessibilityRole="header" style={{ marginTop: spacing.lg }}>{t('md.help.mine')}</Text>
      <View style={{ gap: spacing.md }}>
        {mine.isPending ? <Loading /> : null}
        {mine.isError ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> : null}
        {mine.data && mine.data.items.length === 0 ? <Text muted>{t('md.help.empty')}</Text> : null}
        {mine.data?.items.map((r) => (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>{r.subject}</Text>
              <Badge tone={r.status === 'open' ? 'neutral' : 'accent'} label={r.status === 'open' ? t('md.help.open') : t('md.help.resolved')} />
            </View>
            <Text variant="small" muted>{`${t(`md.help.cat.${r.category}` as MessageKey)} · ${new Date(r.createdAt).toLocaleDateString(locale)}`}</Text>
            <Text>{r.body}</Text>
            {r.reply ? (
              <View>
                <Text variant="small" style={{ fontWeight: '600' }}>{t('md.help.reply')}</Text>
                <Text>{r.reply}</Text>
              </View>
            ) : null}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
