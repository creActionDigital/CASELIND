import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { aiKeys, createAiConversation, fetchAiConversations } from '../../../ai/api';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, IconButton, Screen, Text } from '../../../ui';

/** Assistant IA : conversations privées de l'utilisateur (lot 12). */
export default function AiConversations() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: aiKeys.conversations, queryFn: fetchAiConversations });
  const create = useMutation({
    mutationFn: () => createAiConversation(),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: aiKeys.conversations });
      router.push({ pathname: '/ai/[id]', params: { id: c.id } });
    },
  });

  const header = (
    <Stack.Screen
      options={{
        title: t('ai.title'),
        headerRight: () => <IconButton icon="settings-outline" label={t('ai.settings')} onPress={() => router.push('/ai/settings')} />,
      }}
    />
  );

  if (list.isError) {
    return (
      <Screen>
        {header}
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      </Screen>
    );
  }

  const items = list.data?.items ?? [];
  return (
    <Screen edges={['bottom']} padded={false}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, marginBottom: spacing.lg }}>
            <Button label={t('ai.newChat')} onPress={() => create.mutate()} loading={create.isPending} />
            {create.isError ? <Text color={colors.danger}>{errorMessage(create.error, t, locale)}</Text> : null}
            <Text variant="small" muted>
              {t('ai.privacyNote')}
            </Text>
          </View>
        }
        ListEmptyComponent={
          list.isLoading ? undefined : <EmptyState icon="sparkles-outline" title={t('ai.emptyTitle')} body={t('ai.emptyBody')} />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => router.push({ pathname: '/ai/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1}>{item.title}</Text>
              <Text variant="caption" muted>
                {new Date(item.updatedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg },
  row: { minHeight: TOUCH + 12, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.md },
});
