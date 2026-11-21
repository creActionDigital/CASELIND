import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { FlatList, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { brandAccent, brandColor, onMedia, radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Text } from '../Text';
import { pageIndex } from './logic';
import { PressableScale } from './PressableScale';

export interface Promo {
  id: string;
  title: string;
  subtitle?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  /** Aplat de fond (bleu de marque par défaut ; orange pour une variante). */
  color?: string;
  onPress?: () => void;
}

/** Carrousel horizontal de bannières promo (aplats, pas de dégradé) à pagination par points. */
export function PromoBanner({ items }: { items: Promo[] }) {
  const { colors } = useTheme();
  const [w, setW] = useState(0);
  const [page, setPage] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  return (
    <View onLayout={onLayout} style={{ gap: spacing.sm }}>
      {w > 0 ? (
        <FlatList
          horizontal
          pagingEnabled
          data={items}
          keyExtractor={(i) => i.id}
          showsHorizontalScrollIndicator={false}
          onScroll={(e) => setPage(pageIndex(e.nativeEvent.contentOffset.x, w, items.length))}
          scrollEventThrottle={32}
          renderItem={({ item }) => (
            <View style={{ width: w }}>
              <PressableScale onPress={item.onPress} disabled={!item.onPress} accessibilityLabel={item.subtitle ? `${item.title}. ${item.subtitle}` : item.title} style={[styles.card, { backgroundColor: item.color ?? brandColor }]}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text variant="heading" color={onMedia}>
                    {item.title}
                  </Text>
                  {item.subtitle ? (
                    <Text variant="small" color={onMedia}>
                      {item.subtitle}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name={item.icon ?? 'sparkles'} size={44} color={onMedia} />
              </PressableScale>
            </View>
          )}
        />
      ) : null}
      {items.length > 1 ? (
        <View style={styles.dots} accessibilityLabel={`${page + 1} / ${items.length}`} accessible>
          {items.map((it, i) => (
            <View key={it.id} style={[styles.dot, { width: i === page ? 18 : 6, backgroundColor: i === page ? brandAccent : colors.border }]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 112, padding: spacing.xl, borderRadius: radius.xl },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs },
  dot: { height: 6, borderRadius: 3 },
});
