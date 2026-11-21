import { Ionicons } from '@expo/vector-icons';
import type { ProductMedia } from '@caselind/contracts';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { onMedia, spacing, TOUCH } from '../theme/tokens';
import { AuthImage, Text } from '../ui';

/** Galerie plein écran (fond noir uni) : défilement horizontal, compteur, bouton fermer. */
export function GalleryViewer({ media, startIndex, visible, onClose }: { media: readonly ProductMedia[]; startIndex: number; visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(startIndex);
  const ref = useRef<FlatList>(null);
  useEffect(() => {
    if (visible) setPage(startIndex);
  }, [visible, startIndex]);
  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <FlatList
          ref={ref}
          data={media}
          keyExtractor={(m) => m.id}
          horizontal
          pagingEnabled
          initialScrollIndex={Math.min(startIndex, Math.max(media.length - 1, 0))}
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item, index }) => (
            <AuthImage contentUrl={item.contentUrl} label={t('product.photo', { n: index + 1, total: media.length })} style={{ width, height: height * 0.8, borderRadius: 0 }} />
          )}
        />
        <View style={[styles.top, { top: insets.top + spacing.sm }]}>
          <Text color={onMedia} accessibilityLiveRegion="polite">
            {t('mc.gallery.counter', { n: page + 1, total: media.length })}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('mc.gallery.close')} onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={26} color={onMedia} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
  top: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  close: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
