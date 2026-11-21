import { notificationCategorySchema, notificationPreferencesSchema, type NotificationPreferences } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { api } from '../../auth/auth-context';
import { useI18n, type MessageKey } from '../../i18n';
import { qk } from '../../messaging/keys';
import { PushCard } from '../../notifications/PushCard';
import { PUSH_SUPPORTED } from '../../notifications/push';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { ErrorState, Screen, Text } from '../../ui';

type Category = NotificationPreferences['pushDisabledCategories'][number];
const CATEGORIES = notificationCategorySchema.options.filter((c): c is Category => c !== 'security');
const QUIET: { key: MessageKey; hours: number | null }[] = [
  { key: 'notifications.quiet.off', hours: null },
  { key: 'notifications.quiet.1h', hours: 1 },
  { key: 'notifications.quiet.8h', hours: 8 },
  { key: 'notifications.quiet.24h', hours: 24 },
];

/** Préférences : catégories, mode silencieux, aperçus des messages (avec explication de confidentialité). */
export default function NotificationPreferencesScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.notificationPrefs,
    queryFn: () => api.request('/me/notification-preferences', { schema: notificationPreferencesSchema }),
  });
  const patch = useMutation({
    mutationFn: (changes: Partial<NotificationPreferences>) =>
      api.request('/me/notification-preferences', { method: 'PATCH', body: changes, schema: notificationPreferencesSchema }),
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: qk.notificationPrefs });
      const previous = qc.getQueryData<NotificationPreferences>(qk.notificationPrefs);
      if (previous) qc.setQueryData(qk.notificationPrefs, { ...previous, ...changes });
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && qc.setQueryData(qk.notificationPrefs, ctx.previous),
    onSuccess: (data) => qc.setQueryData(qk.notificationPrefs, data),
  });

  if (query.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (query.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  const p = query.data;
  const quietActive = !!p.quietUntil && new Date(p.quietUntil).getTime() > Date.now();

  function toggle(category: Category, on: boolean) {
    const rest = p.pushDisabledCategories.filter((c) => c !== category);
    patch.mutate({ pushDisabledCategories: on ? rest : [...rest, category] });
  }

  return (
    <Screen edges={['bottom']} padded={false}>
      {PUSH_SUPPORTED ? <PushCard /> : (
        <Text variant="small" muted style={styles.note}>
          {t('push.webUnavailable')}
        </Text>
      )}
      <View style={styles.body}>
        {patch.isError ? <ErrorState error={patch.error} /> : null}

        <Text variant="heading" accessibilityRole="header" style={styles.h}>
          {t('notifications.categories')}
        </Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {CATEGORIES.map((c) => {
            const label = t(`notifications.cat.${c}` as MessageKey);
            return (
              <View key={c} style={styles.row}>
                <Text style={styles.flex}>{label}</Text>
                <Switch accessibilityRole="switch" accessibilityState={{ checked: !!(!p.pushDisabledCategories.includes(c)) }}
                  accessibilityLabel={label}
                  value={!p.pushDisabledCategories.includes(c)}
                  onValueChange={(v) => toggle(c, v)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                />
              </View>
            );
          })}
        </View>
        <Text variant="small" muted style={styles.hint}>
          {t('notifications.securityAlways')}
        </Text>

        <Text variant="heading" accessibilityRole="header" style={styles.h}>
          {t('notifications.quiet')}
        </Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {QUIET.map((q) => {
            const selected = q.hours === null ? !quietActive : false;
            return (
              <Pressable
                key={q.key}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => patch.mutate({ quietUntil: q.hours === null ? null : new Date(Date.now() + q.hours * 3600_000).toISOString() })}
                style={styles.row}
              >
                <Text style={styles.flex}>{t(q.key)}</Text>
                <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.border }]}>
                  {selected ? <View style={[styles.dotFill, { backgroundColor: colors.primary }]} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {quietActive ? (
          <Text variant="small" muted style={styles.hint}>
            {t('notifications.quietUntil', { when: new Date(p.quietUntil!).toLocaleString() })}
          </Text>
        ) : null}

        <Text variant="heading" accessibilityRole="header" style={styles.h}>
          {t('notifications.previews')}
        </Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Text style={styles.flex}>{t('notifications.previewsToggle')}</Text>
            <Switch accessibilityRole="switch" accessibilityState={{ checked: p.messagePreviews }}
              accessibilityLabel={t('notifications.previewsToggle')}
              value={p.messagePreviews}
              onValueChange={(v) => patch.mutate({ messagePreviews: v })}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </View>
        <Text variant="small" muted style={styles.hint}>
          {t('notifications.previewsPrivacy')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg },
  note: { padding: spacing.lg },
  h: { marginTop: spacing.xl, marginBottom: spacing.sm },
  hint: { marginTop: spacing.sm },
  group: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  row: { minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotFill: { width: 10, height: 10, borderRadius: 5 },
});
