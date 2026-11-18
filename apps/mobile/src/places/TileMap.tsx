import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useI18n } from '../i18n';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import type { LatLng } from './geo';
import { clampZoom, fitPoints, panCenter, toScreen, visibleTiles } from './tiles';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  selected?: boolean;
}

interface Props {
  /** Points à cadrer à chaque changement de `fitKey` (l'utilisateur reste libre de déplacer la carte entre-temps). */
  fit: readonly LatLng[];
  fitKey: string;
  markers: readonly MapMarker[];
  /** Position de l'appareil, en point bleu. */
  user?: LatLng | null;
  onSelect?: (id: string) => void;
  /** Bouton « ma position » (facultatif). */
  onLocate?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Carte à tuiles (OpenStreetMap) sans module natif : tourne sur Android, iOS et web.
 * Un doigt déplace, les boutons +/− zooment. Les tuiles viennent d'un serveur de tuiles (voir TILE_URL).
 */
export function TileMap({ fit, fitKey, markers, user, onSelect, onLocate, style }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<{ center: LatLng; zoom: number }>({ center: { lat: 0, lng: 0 }, zoom: 3 });
  const viewRef = useRef(view);
  viewRef.current = view;

  // Cadrage initial et à chaque nouvelle recherche (origine ou rayon).
  useEffect(() => {
    if (size.w > 0 && size.h > 0) setView(fitPoints(fit, size.w, size.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fit` est recréé à chaque rendu : `fitKey` le résume.
  }, [fitKey, size.w > 0 && size.h > 0]);

  const start = useRef<LatLng>(view.center);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          start.current = viewRef.current.center;
        },
        onPanResponderMove: (_e, g) => setView((v) => ({ ...v, center: panCenter(start.current, v.zoom, g.dx, g.dy) })),
      }),
    [],
  );

  const tiles = useMemo(() => (size.w > 0 ? visibleTiles(view.center, view.zoom, size.w, size.h) : []), [view, size]);
  const at = (p: LatLng) => toScreen(p, view.center, view.zoom, size.w, size.h);
  const zoomBy = (d: number) => setView((v) => ({ ...v, zoom: clampZoom(v.zoom + d) }));
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View style={[styles.map, { backgroundColor: '#e8e6e0' }, style]} onLayout={onLayout} accessibilityLabel={t('places.mapA11y')} {...pan.panHandlers}>
      {tiles.map((tile) => (
        <Image key={tile.key} source={{ uri: tile.url }} style={[styles.tile, { left: tile.left, top: tile.top }]} accessibilityElementsHidden />
      ))}
      {size.w > 0 ? markers.map((m) => <Pin key={m.id} marker={m} {...at(m)} onSelect={onSelect} color={colors.primary} />) : null}
      {size.w > 0 && user ? <View pointerEvents="none" style={[styles.user, { left: at(user).x - 9, top: at(user).y - 9 }]} /> : null}
      <View style={styles.controls}>
        {onLocate ? <RoundButton icon="locate" label={t('places.locateMe')} onPress={onLocate} /> : null}
        <RoundButton icon="add" label={t('places.zoomIn')} onPress={() => zoomBy(1)} />
        <RoundButton icon="remove" label={t('places.zoomOut')} onPress={() => zoomBy(-1)} />
      </View>
      <View pointerEvents="none" style={styles.attribution}>
        <Text variant="caption" style={{ color: '#333' }}>
          © OpenStreetMap
        </Text>
      </View>
    </View>
  );
}

const Pin = memo(function Pin({ marker, x, y, color, onSelect }: { marker: MapMarker; x: number; y: number; color: string; onSelect?: (id: string) => void }) {
  const big = marker.selected;
  const size = big ? 40 : 30;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={marker.label}
      onPress={() => onSelect?.(marker.id)}
      hitSlop={8}
      style={[styles.pin, { left: x - size / 2, top: y - size, width: size, height: size, zIndex: big ? 2 : 1 }]}
    >
      <Ionicons name="location" size={size} color={big ? '#111' : color} />
    </Pressable>
  );
});

function RoundButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.round, { backgroundColor: colors.surface, opacity: pressed ? 0.8 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  map: { overflow: 'hidden' },
  tile: { position: 'absolute', width: 256, height: 256 },
  pin: { position: 'absolute', alignItems: 'center', justifyContent: 'flex-end' },
  user: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#2563eb', borderWidth: 3, borderColor: '#fff' },
  controls: { position: 'absolute', right: spacing.md, bottom: spacing.md, gap: spacing.sm },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  attribution: { position: 'absolute', left: spacing.sm, bottom: 2, backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4, borderRadius: 4 },
});
