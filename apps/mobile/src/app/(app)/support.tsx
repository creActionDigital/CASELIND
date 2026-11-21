import { createHelpRequestRequestSchema, helpRequestListSchema, helpRequestSchema, HELP_CATEGORIES } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { api } from '../../auth/auth-context';
import { FormError } from '../../auth/FormError';
import { useI18n, type MessageKey } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../ui';

const KEY = ['help-requests'] as const;

/** Contacter le support / signaler un problème : demande envoyée à l'équipe (POST /me/help-requests, module support) et suivi des réponses. */
export default function Support() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const problem = mode === 'problem';
  const [category, setCategory] = useState<(typeof HELP_CATEGORIES)[number]>(problem ? 'bug' : 'other');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [errs, setErrs] = useState<{ subject?: string; body?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const list = useQuery({ queryKey: KEY, queryFn: () => api.request('/me/help-requests', { schema: helpRequestListSchema }) });
  const send = useMutation({
    mutationFn: () => api.request('/me/help-requests', { method: 'POST', body: { category, subject: subject.trim(), body: body.trim() }, schema: helpRequestSchema }),
    onSuccess: () => {
      setSent(true);
      setSubject('');
      setBody('');
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });

  function submit() {
    setError(null);
    setSent(false);
    const r = createHelpRequestRequestSchema.safeParse({ category, subject, body });
    const e: typeof errs = {};
    if (!r.success) for (const i of r.error.issues) e[i.path[0] === 'subject' ? 'subject' : 'body'] = t(i.path[0] === 'subject' ? 'ma.support.subjectShort' : 'ma.support.bodyShort');
    setErrs(e);
    if (r.success) send.mutate();
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: problem ? t('ma.support.problemTitle') : t('ma.support.title') }} />
      <Text muted style={{ marginBottom: spacing.lg }}>
        {problem ? t('ma.support.problemIntro') : t('ma.support.intro')}
      </Text>
      <FormError message={error} />
      {sent ? (
        <Text accessibilityLiveRegion="polite" style={[styles.ok, { backgroundColor: colors.primarySoft }]}>
          {t('ma.support.sent')}
        </Text>
      ) : null}
      <Text variant="small" style={{ marginBottom: spacing.xs }}>
        {t('ma.support.category')}
      </Text>
      <View style={styles.chips}>
        {HELP_CATEGORIES.map((c) => {
          const selected = category === c;
          return (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setCategory(c)}
              style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
            >
              <Text variant="small" color={selected ? colors.onPrimary : colors.text}>
                {t(`ma.support.cat.${c}` as MessageKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextField label={t('ma.support.subject')} value={subject} onChangeText={setSubject} maxLength={120} error={errs.subject} />
      <TextField label={t('ma.support.body')} value={body} onChangeText={setBody} multiline maxLength={2000} error={errs.body} />
      <Button label={t('ma.support.send')} onPress={submit} loading={send.isPending} />

      <Text variant="heading" accessibilityRole="header" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        {t('ma.support.mine')}
      </Text>
      {list.isPending ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.data && list.data.items.length === 0 ? <Text muted>{t('ma.support.none')}</Text> : null}
      {list.data?.items.map((x) => (
        <View key={x.id} style={[styles.ticket, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {x.subject}
            </Text>
            <Badge tone={x.status === 'resolved' ? 'primary' : 'neutral'} label={t(x.status === 'resolved' ? 'ma.support.resolved' : 'ma.support.open')} />
          </View>
          <Text variant="small" muted>
            {x.body}
          </Text>
          {x.reply ? (
            <Text variant="small" style={{ marginTop: spacing.xs }}>
              {t('ma.support.reply')} : {x.reply}
            </Text>
          ) : null}
          <Text variant="caption" muted>
            {new Date(x.createdAt).toLocaleString(locale)}
          </Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  ok: { padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: { minHeight: TOUCH, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ticket: { gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderRadius: radius.md, marginBottom: spacing.sm },
});
