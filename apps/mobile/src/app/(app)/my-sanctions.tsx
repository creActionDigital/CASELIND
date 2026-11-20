import type { Sanction } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { appealSanction, fetchMySanctions, o2k } from '../../admin/ops2-api';
import { canAppeal } from '../../admin/ops2-logic';
import { useI18n, type MessageKey } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { Card, PagedList } from '../../seller/ui';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Badge, Button, Text, TextField } from '../../ui';

function SanctionCard({ s }: { s: Sanction }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => appealSanction(s.id, message.trim()),
    onSuccess: () => { setOpen(false); setMessage(''); setError(null); void qc.invalidateQueries({ queryKey: o2k.all }); },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Badge tone={s.kind === 'ban' ? 'accent' : 'neutral'} label={t(`ops2.kind.${s.kind}` as MessageKey)} />
        <Badge tone={s.status === 'active' || s.status === 'appealed' ? 'primary' : 'neutral'} label={t(`ops2.sanctionStatus.${s.status}` as MessageKey)} />
      </View>
      <Text variant="small">{s.reason}</Text>
      <Text variant="small" muted>{date(s.startsAt)} · {s.endsAt ? t('ops2.sanctions.until', { date: date(s.endsAt) }) : t('ops2.sanctions.noEnd')}</Text>
      {s.appeal ? (
        <Text variant="small" muted>{t('ops2.sanctions.appealOpen', { status: t(`ops2.appealStatus.${s.appeal.status}` as MessageKey) })}{s.appeal.decisionNote ? ` — ${t('ops2.mine.decision', { note: s.appeal.decisionNote })}` : ''}</Text>
      ) : null}
      {canAppeal(s) ? (
        open ? (
          <View style={styles.col}>
            <TextField label={t('ops2.mine.appealMessage')} value={message} onChangeText={setMessage} multiline maxLength={1000} />
            {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button label={t('ops2.mine.send')} loading={send.isPending} disabled={message.trim().length < 1} onPress={() => send.mutate()} />
            <Button variant="ghost" label={t('adm.cancel')} onPress={() => setOpen(false)} />
          </View>
        ) : (
          <Button variant="secondary" label={t('ops2.mine.appeal')} onPress={() => setOpen(true)} />
        )
      ) : null}
    </Card>
  );
}

/** Mes sanctions : les mesures de modération sur mon compte et mon recours (un seul par sanction). */
export default function MySanctions() {
  const { t } = useI18n();
  const query = useInfiniteQuery({
    queryKey: o2k.list('mine'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchMySanctions(pageParam),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: t('ops2.mine.title') }} />
      <PagedList
        query={query}
        keyExtractor={(s: Sanction) => s.id}
        renderItem={({ item }) => <SanctionCard s={item} />}
        header={
          <View style={styles.intro}>
            <Text muted>{t('ops2.mine.intro')}</Text>
            <Text variant="small" muted>{t('ops2.mine.suspendedNote')}</Text>
          </View>
        }
        empty={{ icon: 'shield-checkmark-outline', title: t('ops2.mine.empty') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { padding: spacing.md, gap: spacing.xs },
  card: { marginHorizontal: spacing.md, marginBottom: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  col: { gap: spacing.sm },
});
