import { privacySettingsSchema, type PrivacySettings } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { api } from '../../auth/auth-context';
import { useI18n, type MessageKey } from '../../i18n';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, ErrorState, Screen, Text } from '../../ui';

const FROM: PrivacySettings['contactRequestsFrom'][] = ['everyone', 'contacts_of_contacts', 'nobody'];

/** Confidentialité : GET/PATCH /v1/me/privacy (mise à jour optimiste, annulée en cas d'erreur). */
export default function Privacy() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const query = useQuery({
    queryKey: ['privacy'],
    queryFn: () => api.request('/me/privacy', { schema: privacySettingsSchema }),
  });
  const patch = useMutation({
    mutationFn: (changes: Partial<PrivacySettings>) =>
      api.request('/me/privacy', { method: 'PATCH', body: changes, schema: privacySettingsSchema }),
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: ['privacy'] });
      const previous = qc.getQueryData<PrivacySettings>(['privacy']);
      if (previous) qc.setQueryData(['privacy'], { ...previous, ...changes });
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && qc.setQueryData(['privacy'], ctx.previous),
    onSuccess: (data) => {
      qc.setQueryData(['privacy'], data);
      void qc.invalidateQueries({ queryKey: ['presence'] });
    },
  });

  if (query.isPending) return <Screen edges={['bottom']}><ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /></Screen>;
  if (query.isError) return <Screen edges={['bottom']}><ErrorState error={query.error} onRetry={() => query.refetch()} /></Screen>;
  const s = query.data;

  const toggles: { key: 'discoverableByPhone' | 'discoverableByEmail' | 'readReceipts' | 'showPresence'; label: MessageKey }[] = [
    { key: 'discoverableByPhone', label: 'privacy.discoverableByPhone' },
    { key: 'discoverableByEmail', label: 'privacy.discoverableByEmail' },
    { key: 'readReceipts', label: 'privacy.readReceipts' },
    { key: 'showPresence', label: 'privacy.showPresence' },
  ];

  return (
    <Screen edges={['bottom']}>
      {patch.isError ? <ErrorState error={patch.error} /> : null}
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {toggles.map((row) => (
          <View key={row.key} style={styles.row}>
            <Text style={{ flex: 1 }}>{t(row.label)}</Text>
            <Switch accessibilityRole="switch" accessibilityState={{ checked: !!(s[row.key]) }}
              accessibilityLabel={t(row.label)}
              value={s[row.key]}
              onValueChange={(v) => patch.mutate({ [row.key]: v })}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        ))}
      </View>
      <Text variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }} accessibilityRole="header">
        {t('privacy.contactRequestsFrom')}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {FROM.map((value) => {
          const selected = s.contactRequestsFrom === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => patch.mutate({ contactRequestsFrom: value })}
              style={styles.row}
            >
              <Text style={{ flex: 1 }}>{t(`privacy.from.${value}` as MessageKey)}</Text>
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.border }]}>
                {selected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
        <Button variant="secondary" label={t('privacy.myConsents')} onPress={() => router.push('/consents')} />
        <Button variant="secondary" label={t('blocks.manage')} onPress={() => router.push('/blocked')} />
        <Button variant="secondary" label={t('privacy.myData')} onPress={() => router.push('/my-data')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  row: { minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
