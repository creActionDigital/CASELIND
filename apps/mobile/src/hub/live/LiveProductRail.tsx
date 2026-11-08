import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { formatMoney } from '../../shop/format';
import { glass, onMedia, radius } from '../../theme/tokens';
import { Text } from '../../ui';
import type { LiveProduct } from './types';

/** Colonne de produits à droite, chacun avec son prix. */
export function LiveProductRail({ products, onPress }: { products: LiveProduct[]; onPress?: (p: LiveProduct) => void }) {
  const { t, locale } = useI18n();
  return (
    <ScrollView style={styles.rail} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} accessibilityLabel={t('live.products')}>
      {products.map((p) => {
        const price = formatMoney(p.priceMinor, p.currency, locale);
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={t('live.product', { title: p.title, price })}
            onPress={() => onPress?.(p)}
            style={[styles.tile, { backgroundColor: p.tint }]}
          >
            <Ionicons name="shirt-outline" size={32} color="rgba(0,0,0,0.45)" style={styles.icon} />
            {p.hot ? <Ionicons name="flame" size={20} color="#FF7A00" style={styles.hot} accessibilityLabel={t('live.hot')} /> : null}
            <View style={styles.price}>
              <Text variant="caption" color={onMedia}>
                {price}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { width: 76, flexGrow: 0, maxHeight: 340 },
  content: { gap: 8, paddingBottom: 4 },
  tile: { width: 76, height: 76, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: glass.border },
  icon: { position: 'absolute', top: 12, alignSelf: 'center' },
  hot: { position: 'absolute', top: 4, left: 4 },
  price: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.65)' },
});
