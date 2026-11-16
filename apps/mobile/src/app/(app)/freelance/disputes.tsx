import type { AdminDispute } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { fetchAdminDisputes, frKeys, resolveAdminDispute } from '../../../freelance/api';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { Card, PagedList } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, Text, TextField } from '../../../ui';

/** Litiges ouverts (administrateurs). Aucun message privé n'est montré ; la décision ne déplace aucun argent. */
export default function AdminDisputes() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me?.roles.includes('admin') ?? false;
  const query = useInfiniteQuery({
    queryKey: [...frKeys.all, 'admin-disputes'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchAdminDisputes(pageParam),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: isAdmin,
  });
  const resolve = useMutation({
    mutationFn: (v: { id: string; outcome: 'resume' | 'cancel' }) => resolveAdminDispute(v.id, v.outcome, text.trim()),
    onSuccess: () => { setOpen(null); setText(''); setError(null); void qc.invalidateQueries({ queryKey: frKeys.all }); },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });
  const decide = (id: string, outcome: 'resume' | 'cancel') => {
    const msg = t(outcome === 'resume' ? 'freelance.admin.confirmResume' : 'freelance.admin.confirmCancel');
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (globalThis.confirm?.(msg)) resolve.mutate({ id, outcome });
      return;
    }
    Alert.alert(t('freelance.admin.title'), msg, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('freelance.admin.confirm'), onPress: () => resolve.mutate({ id, outcome }) }]);
  };

  if (!isAdmin) {
    return <EmptyState icon="lock-closed-outline" title={t('freelance.admin.forbidden')} />;
  }
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('freelance.admin.title') }} />
      <PagedList
        query={query as UseInfiniteQueryResult<InfiniteData<{ items: AdminDispute[]; nextCursor: string | null }>>}
        keyExtractor={(d: AdminDispute) => d.id}
        renderItem={({ item }) => (
          <Card onPress={() => { setOpen(open === item.id ? null : item.id); setError(null); }} label={item.missionTitle} style={styles.card}>
            <Text variant="bodyStrong">{item.missionTitle}</Text>
            <Text variant="small" muted>{t('freelance.admin.openedBy', { name: item.openedBy.handle, date: new Date(item.createdAt).toLocaleDateString(locale) })}</Text>
            <Text variant="small">{item.reason}</Text>
            {open === item.id ? (
              <>
                <TextField label={t('freelance.admin.resolution')} value={text} onChangeText={setText} multiline maxLength={500} />
                {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
                <Button label={t('freelance.admin.resume')} loading={resolve.isPending} disabled={text.trim().length < 3} onPress={() => decide(item.id, 'resume')} />
                <Button variant="danger" label={t('freelance.admin.cancel')} disabled={text.trim().length < 3 || resolve.isPending} onPress={() => decide(item.id, 'cancel')} />
              </>
            ) : null}
          </Card>
        )}
        empty={{ icon: 'checkmark-circle-outline', title: t('freelance.admin.empty') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, card: { marginHorizontal: spacing.md, marginBottom: spacing.sm, gap: spacing.xs } });
