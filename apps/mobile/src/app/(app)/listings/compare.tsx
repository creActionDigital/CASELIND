import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { fetchCompare, listingKeys } from '../../../listings/api';
import { toggleCompareId, useCompareIds } from '../../../listings/compare-store';
import { priceLabel, vehicleRows } from '../../../listings/logic';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text } from '../../../ui';

/** Comparer : 2 ou 3 véhicules côte à côte (prix, ville, vendeur, photos, date, description). L'état est local à l'appareil. */
export default function Compare() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const ids = useCompareIds();
  const q = useQuery({ queryKey: listingKeys.compare(ids), queryFn: () => fetchCompare(ids), enabled: ids.length >= 2, retry: false });

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('listings.compare.title') }} />
      {ids.length < 2 ? (
        <Text muted>{t('listings.compare.hint')}</Text>
      ) : q.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      ) : q.isError ? (
        <>
          <Text color={colors.danger}>{t('listings.compare.err')}</Text>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
          {ids.map((id) => (
            <Button key={id} variant="ghost" label={t('listings.compare.remove')} onPress={() => toggleCompareId(id)} />
          ))}
        </>
      ) : (
        <ScrollView horizontal>
          <View style={styles.row}>
            {q.data.items.map((l) => {
              const rows: [string, string][] = [
                ['listings.compare.row.price', priceLabel(l, locale) ?? '-'],
                ...vehicleRows(l, t as (k: MessageKey) => string, true),
                ['listings.compare.row.city', l.city],
                ['listings.compare.row.seller', l.owner.displayName],
                ['listings.compare.row.photos', String(l.mediaIds.length)],
                ['listings.compare.row.date', new Date(l.createdAt).toLocaleDateString(locale)],
                ['listings.compare.row.description', l.description || '-'],
              ];
              return (
                <View key={l.id} style={[styles.col, { backgroundColor: colors.surface }]}>
                  <Text variant="heading" numberOfLines={2}>
                    {l.title}
                  </Text>
                  {rows.map(([k, v]) => (
                    <View key={k}>
                      <Text variant="small" muted>
                        {t(k as 'listings.compare.row.price')}
                      </Text>
                      <Text>{v}</Text>
                    </View>
                  ))}
                  <Button variant="secondary" label={t('listings.title')} onPress={() => router.push({ pathname: '/listings/[id]', params: { id: l.id } })} />
                  <Button variant="ghost" label={t('listings.compare.remove')} onPress={() => toggleCompareId(l.id)} />
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  col: { width: 240, borderRadius: radius.md, gap: spacing.sm, padding: spacing.md },
});
