import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchCategories } from '../../../shop/api';
import { categoryIcon } from '../../../shop/market-logic';
import { shopKeys } from '../../../shop/hooks';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { EmptyState, ErrorState, Text } from '../../../ui';
import { ActivityIndicator } from 'react-native';

/** Toutes les catégories du catalogue, en grille ; chaque tuile ouvre la page de la catégorie. */
export default function Categories() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const q = useQuery({ queryKey: shopKeys.categories, queryFn: fetchCategories, staleTime: 10 * 60_000 });
  const title = <Stack.Screen options={{ title: t('mc.cat.title') }} />;
  if (q.isPending) return <>{title}<ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /></>;
  if (q.isError) return <>{title}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;
  return (
    <>
      {title}
      <FlatList
        data={q.data.items}
        keyExtractor={(c) => c.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={styles.content}
        refreshing={q.isRefetching}
        onRefresh={() => q.refetch()}
        ListEmptyComponent={<EmptyState icon="grid-outline" title={t('mc.cat.empty')} body={t('mc.cat.emptyBody')} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mc.cat.open', { name: item.name })}
            onPress={() => router.push({ pathname: '/categories/[categoryId]', params: { categoryId: item.id, name: item.name } })}
            style={[styles.tile, { backgroundColor: colors.surface }]}
          >
            <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name={categoryIcon(item.name)} size={26} color={colors.primary} />
            </View>
            <Text variant="bodyStrong" numberOfLines={2}>
              {item.name}
            </Text>
          </Pressable>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md },
  tile: { flex: 1, minHeight: TOUCH * 2, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  icon: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
