import type { HealthEntryKind } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { createShare, fetchAccessLog, fetchShares, proKeys, revokeShare } from '../../../health/api';
import { ENTRY_KINDS, healthProErrorKey, kindKey } from '../../../health/logic';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Screen, Text, TextField } from '../../../ui';

/** Partage temporaire du dossier avec un professionnel vérifié (éléments choisis, durée limitée, retrait immédiat) et journal des accès. */
export default function Sharing() {
  const { professionalId, name } = useLocalSearchParams<{ professionalId?: string; name?: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [kinds, setKinds] = useState<HealthEntryKind[]>(['allergy', 'condition', 'medication']);
  const [days, setDays] = useState('7');
  const [error, setError] = useState<string | null>(null);
  const shares = useQuery({ queryKey: proKeys.shares, queryFn: fetchShares });
  const log = useQuery({ queryKey: proKeys.accessLog, queryFn: fetchAccessLog });

  const done = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['health'] });
  };
  const fail = (e: unknown) => setError(healthProErrorKey(e) ? t(healthProErrorKey(e)!) : errorMessage(e, t, locale));
  const create = useMutation({
    mutationFn: () => {
      const d = Number(days);
      if (!professionalId || kinds.length === 0 || !Number.isInteger(d)) throw new Error('invalid');
      return createShare({ professionalId, kinds, days: d });
    },
    onSuccess: done,
    onError: (e) => (e instanceof Error && e.message === 'invalid' ? setError(t('health.err.invalid')) : fail(e)),
  });
  const revoke = useMutation({ mutationFn: (id: string) => revokeShare(id), onSuccess: done, onError: fail });
  const toggle = (k: HealthEntryKind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('health.sharing') }} />
      <View style={styles.body}>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {professionalId ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="heading">{name}</Text>
            <Text variant="bodyStrong">{t('health.share.kinds')}</Text>
            <View style={styles.wrap}>
              {ENTRY_KINDS.map((k) => (
                <Button key={k} variant={kinds.includes(k) ? 'primary' : 'secondary'} label={kinds.includes(k) ? `✓ ${t(kindKey(k))}` : t(kindKey(k))} onPress={() => toggle(k)} />
              ))}
            </View>
            <TextField label={t('health.share.days')} value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={2} />
            <Button label={t('health.share.send')} loading={create.isPending} disabled={kinds.length === 0} onPress={() => create.mutate()} />
          </View>
        ) : null}

        {shares.data?.items.length === 0 ? <Text muted>{t('health.share.empty')}</Text> : null}
        {shares.data?.items.map((s) => (
          <View key={s.id} style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="bodyStrong">{s.professional.displayName}</Text>
            <Text variant="small" muted>
              {s.kinds.map((k) => t(kindKey(k))).join(', ')}
            </Text>
            <Badge tone="neutral" label={s.active ? t('health.share.active', { date: new Date(s.expiresAt).toLocaleDateString(locale) }) : t('health.share.over')} />
            {s.active ? <Button variant="danger" label={t('health.share.revoke')} loading={revoke.isPending && revoke.variables === s.id} onPress={() => revoke.mutate(s.id)} /> : null}
          </View>
        ))}

        <Text variant="heading" accessibilityRole="header">
          {t('health.accessLog')}
        </Text>
        {log.data?.items.length === 0 ? <Text muted>{t('health.accessLog.empty')}</Text> : null}
        {log.data?.items.map((l, i) => (
          <Text key={i} variant="small">
            {t('health.accessLog.line', { name: l.accessor.displayName, n: l.entriesCount, date: new Date(l.at).toLocaleString(locale) })}
          </Text>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
