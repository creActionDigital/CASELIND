import { Ionicons } from '@expo/vector-icons';
import { memo, type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useI18n } from '../i18n';
import { brandColor, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import type { LatLng } from './geo';
import { clampZoom, fitPoints, isDoubleTap, isTap, linePoints, panCenter, pinchZoom, screenToLatLng, toScreen, touchDistance, visibleTiles } from './tiles';

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
  /** Trace une ligne (ex. départ → arrêt → arrivée) entre ces points. */
  line?: readonly LatLng[];
  /** Un appui court sur la carte (sans déplacement) pose un point. */
  onPick?: (p: LatLng) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Carte à tuiles (OpenStreetMap) sans module natif : tourne sur Android, iOS et web.
 * Un doigt déplace, deux doigts (ou la molette sur le web) et le double appui zooment, les boutons +/− aussi. Les tuiles viennent d'un serveur de tuiles (voir TILE_URL).
 */
export function TileMap({ fit, fitKey, markers, user, onSelect, onLocate, line, onPick, style }: Props) {
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

  const mapRef = useRef<ComponentRef<typeof View>>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const g = useRef({ center: view.center, t0: 0, moved: false, pinch: null as { dist: number; zoom: number } | null, lastTap: null as { x: number; y: number; at: number } | null });
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, s) => Math.abs(s.dx) + Math.abs(s.dy) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          g.current.center = viewRef.current.center;
          g.current.moved = false;
          g.current.t0 = Date.now();
          g.current.pinch = null;
        },
        onPanResponderMove: (e, s) => {
          const st = g.current;
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            const dist = touchDistance(touches);
            st.moved = true;
            if (!st.pinch) st.pinch = { dist, zoom: viewRef.current.zoom };
            else {
              const zoom = pinchZoom(st.pinch.zoom, st.pinch.dist, dist);
              setView((v) => (v.zoom === zoom ? v : { ...v, zoom }));
            }
            return;
          }
          if (st.pinch) return; // un doigt levé après un pincement : on n'enchaîne pas sur un déplacement
          if (!st.moved && !isTap(s.dx, s.dy, 0)) st.moved = true;
          if (st.moved) setView((v) => ({ ...v, center: panCenter(st.center, v.zoom, s.dx, s.dy) }));
        },
        onPanResponderRelease: (_e, s) => {
          const st = g.current;
          const at = Date.now();
          if (st.moved || !isTap(s.dx, s.dy, at - st.t0)) return;
          const x0 = s.x0;
          const y0 = s.y0;
          if (isDoubleTap(st.lastTap, x0, y0, at)) {
            st.lastTap = null;
            setView((v) => ({ ...v, zoom: clampZoom(v.zoom + 1) }));
            return;
          }
          st.lastTap = { x: x0, y: y0, at };
          // pageX/pageY moins la position de la carte dans la fenêtre : locationX/Y n'est pas fiable (web, enfants).
          if (onPickRef.current) {
            mapRef.current?.measureInWindow((ox, oy) => {
              const { w, h } = sizeRef.current;
              const v = viewRef.current;
              onPickRef.current?.(screenToLatLng(x0 - ox, y0 - oy, v.center, v.zoom, w, h));
            });
          }
        },
      }),
    [],
  );

  // Molette (web) : un cran par coup, au plus un toutes les 150 ms.
  const lastWheel = useRef(0);
  const webWheel =
    Platform.OS === 'web'
      ? {
          onWheel: (e: { deltaY: number }) => {
            const now = Date.now();
            if (now - lastWheel.current < 150 || e.deltaY === 0) return;
            lastWheel.current = now;
            setView((v) => ({ ...v, zoom: clampZoom(v.zoom + (e.deltaY < 0 ? 1 : -1)) }));
          },
        }
      : {};

  const tiles = useMemo(() => (size.w > 0 ? visibleTiles(view.center, view.zoom, size.w, size.h) : []), [view, size]);
  const at = (p: LatLng) => toScreen(p, view.center, view.zoom, size.w, size.h);
  const zoomBy = (d: number) => setView((v) => ({ ...v, zoom: clampZoom(v.zoom + d) }));
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View ref={mapRef} style={[styles.map, { backgroundColor: '#e8e6e0' }, style]} onLayout={onLayout} accessibilityLabel={t('places.mapA11y')} {...pan.panHandlers} {...webWheel}>
      {tiles.map((tile) => (
        <Image key={tile.key} source={{ uri: tile.url }} style={[styles.tile, { left: tile.left, top: tile.top }]} accessibilityElementsHidden />
      ))}
      {size.w > 0 && line && line.length >= 2 ? (
        <Svg pointerEvents="none" width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
          <Polyline points={linePoints(line, view.center, view.zoom, size.w, size.h)} fill="none" stroke={brandColor} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : null}
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
