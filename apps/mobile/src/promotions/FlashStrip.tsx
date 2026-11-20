import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { ProductCard } from '../shop/ProductGrid';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { fetchFlashSales, promoKeys } from './api';

/** Section « Ventes flash » de la boutique (absente sans vente en cours ou si le service est indisponible) + lien vers les souhaits. */
export function FlashStrip() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const { status } = useAuth();
  const flash = useQuery({ queryKey: promoKeys.flash, queryFn: () => fetchFlashSales(undefined, 10), enabled: status === 'signedIn', staleTime: 60_000, retry: false });
  const items = flash.data?.items ?? [];
  return (
    <View style={styles.wrap}>
      {status === 'signedIn' ? (
      <Pressable accessibilityRole="link" accessibilityLabel={t('wish.open')} onPress={() => router.push('/wishlist')} style={styles.link}>
        <Text variant="small" color={colors.primary} style={styles.bold}>
          {t('wish.open')}
        </Text>
      </Pressable>
      ) : null}
      {items.length > 0 ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('promo.flash.title')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {items.map((p) => (
              <ProductCard key={p.id} product={p} width={156} />
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  link: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },
  bold: { fontWeight: '600' },
  row: { gap: spacing.md },
});
