import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { getAuthMediaUri } from '../media/auth-media';
import { onMedia, radius } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, Text } from '../ui';

export interface MediaItem {
  key: string;
  mime: string | null;
  contentUrl: string | null;
  localUri?: string;
}

const GAP = 2;

function Video({ item }: { item: MediaItem }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  return (
    <View style={[styles.fill, { backgroundColor: colors.surfaceAlt }]}>
      {playing ? (
        <Player item={item} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('feed.play')}
          onPress={() => setPlaying(true)}
          style={[styles.fill, styles.center]}
        >
          <View style={[styles.playDisc, { backgroundColor: colors.overlay }]}>
            <Ionicons name="play" size={28} color={onMedia} />
          </View>
        </Pressable>
      )}
    </View>
  );
}

/** Lecture : le fichier protégé est téléchargé avec le jeton (cache partagé avec les images), puis lu en local. */
function Player({ item }: { item: MediaItem }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [uri, setUri] = useState<string | null>(item.localUri ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (item.localUri || !item.contentUrl) return;
    let live = true;
    getAuthMediaUri(item.contentUrl).then(
      (u) => live && setUri(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [item.contentUrl, item.localUri]);
  if (failed) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text variant="caption" muted>
          {t('media.unavailable')}
        </Text>
      </View>
    );
  }
  if (!uri) {
    return (
      <View style={[styles.fill, styles.center]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  return <VideoSurface uri={uri} />;
}

function VideoSurface({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={styles.fill} nativeControls contentFit="contain" />;
}

function Photo({ item, index, total, style }: { item: MediaItem; index: number; total: number; style: object }) {
  const { t } = useI18n();
  return (
    <AuthImage
      contentUrl={item.contentUrl}
      localUri={item.localUri}
      label={t('feed.image', { n: index + 1, total })}
      style={[style, { borderRadius: 0 }]}
    />
  );
}

/** Médias d'une publication : 1 image pleine largeur, 2 à 4 en grille, au-delà 4 vignettes avec « +n ». */
export function PostMedia({ items }: { items: MediaItem[] }) {
  const { colors } = useTheme();
  if (items.length === 0) return null;
  const first = items[0];
  if (first.mime?.startsWith('video/')) {
    return (
      <View style={[styles.single, styles.round]}>
        <Video item={first} />
      </View>
    );
  }
  if (items.length === 1) {
    return (
      <View style={[styles.single, styles.round]}>
        <Photo item={first} index={0} total={1} style={styles.fill} />
      </View>
    );
  }
  const shown = items.slice(0, 4);
  const extra = items.length - shown.length;
  const columns = shown.length === 2 ? [[0], [1]] : shown.length === 3 ? [[0], [1, 2]] : [[0, 2], [1, 3]];
  return (
    <View style={[styles.grid, styles.round]}>
      {columns.map((col, c) => (
        <View key={c} style={styles.col}>
          {col.map((i) => (
            <View key={shown[i].key} style={styles.cell}>
              <Photo item={shown[i]} index={i} total={items.length} style={styles.fill} />
              {extra > 0 && i === 3 ? (
                <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.overlay }]}>
                  <Text variant="heading" color={onMedia}>
                    +{extra}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  round: { borderRadius: radius.md, overflow: 'hidden' },
  single: { width: '100%', aspectRatio: 4 / 3 },
  grid: { width: '100%', aspectRatio: 1, flexDirection: 'row', gap: GAP },
  col: { flex: 1, gap: GAP },
  cell: { flex: 1 },
  playDisc: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
