import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PublishSheet } from '../../../components/PublishSheet';
import { GlassButton, HubTabs } from '../../../hub/HubTabs';
import { LivePane } from '../../../hub/LivePane';
import { HUB_TABS, tabIndexFromOffset, type HubTab } from '../../../hub/logic';
import { PostsPane } from '../../../hub/PostsPane';
import { ProductsPane } from '../../../hub/ProductsPane';
import { VideosPane } from '../../../hub/VideosPane';
import { useI18n } from '../../../i18n';
import { brandAccent, brandColor, onMedia, TOUCH } from '../../../theme/tokens';
import { Text } from '../../../ui';

/** Onglet central « + » : Live · Vidéos · Posts · Produits, plein écran, onglets glissables ou touchables. */
export default function Hub() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<HubTab>>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [index, setIndex] = useState(1);
  const [publishing, setPublishing] = useState(false);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };
  const select = (i: number) => {
    setIndex(i);
    listRef.current?.scrollToIndex({ index: i, animated: true });
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      {size.w > 0 ? (
        <FlatList
          ref={listRef}
          data={HUB_TABS as unknown as HubTab[]}
          keyExtractor={(k) => k}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={1}
          getItemLayout={(_d, i) => ({ length: size.w, offset: size.w * i, index: i })}
          onMomentumScrollEnd={(e) => setIndex(tabIndexFromOffset(e.nativeEvent.contentOffset.x, size.w))}
          renderItem={({ item, index: i }) => (
            <View style={{ width: size.w, height: size.h }}>
              {item === 'live' ? <LivePane /> : null}
              {item === 'videos' ? <VideosPane active={i === index} height={size.h} /> : null}
              {item === 'posts' ? <PostsPane /> : null}
              {item === 'products' ? <ProductsPane height={size.h} /> : null}
            </View>
          )}
        />
      ) : null}
      <HubTabs active={index} onSelect={select} right={<GlassButton icon="search" label={t('hub.search')} onPress={() => router.push('/search')} />} />
      <View pointerEvents="box-none" style={[styles.plusRow, { top: insets.top + 64 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('hub.publish')} onPress={() => setPublishing(true)} style={styles.plus}>
          <Ionicons name="add" size={22} color={onMedia} />
          <Text variant="bodyStrong" color={onMedia}>
            {t('hub.publish')}
          </Text>
        </Pressable>
      </View>
      <PublishSheet visible={publishing} onClose={() => setPublishing(false)} onLive={() => select(0)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B10' },
  plusRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 9 },
  plus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: TOUCH,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: brandAccent,
  },
});
