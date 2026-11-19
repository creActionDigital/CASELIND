import { useMemo, type ComponentRef, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useI18n } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { Button } from '../ui';
import { hasInk, SIG_W, signaturePng, strokeToPath, type Pt } from './png';

const HEIGHT = 160;

/** Zone de tracé tactile (doigt ou souris) : Effacer, Valider → PNG 300×150 rendu par `onSubmit`. */
export function SignaturePad({ onSubmit, busy }: { onSubmit: (png: Uint8Array) => void; busy?: boolean }) {
  const { t } = useI18n();
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  widthRef.current = width;
  const ref = useRef<ComponentRef<typeof View>>(null);
  const origin = useRef<Pt | null>(null);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false, // le défilement ne doit pas voler le tracé
        onPanResponderGrant: (_e, s) => {
          origin.current = null;
          const [x0, y0] = [s.x0, s.y0];
          // pageX/pageY moins la position du cadre : locationX/Y n'est pas fiable sur le web.
          ref.current?.measureInWindow((ox, oy) => {
            origin.current = { x: ox, y: oy };
            setStrokes((cur) => [...cur, [{ x: x0 - ox, y: y0 - oy }]]);
          });
        },
        onPanResponderMove: (_e, s) => {
          const o = origin.current;
          if (!o) return;
          const p = { x: Math.min(widthRef.current, Math.max(0, s.moveX - o.x)), y: Math.min(HEIGHT, Math.max(0, s.moveY - o.y)) };
          setStrokes((cur) => (cur.length === 0 ? cur : [...cur.slice(0, -1), [...cur[cur.length - 1]!, p]]));
        },
      }),
    [],
  );

  const inked = hasInk(strokes);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={{ gap: spacing.sm }}>
      <View ref={ref} onLayout={onLayout} accessibilityLabel={t('delivery.signature.pad')} style={styles.pad} {...pan.panHandlers}>
        <Svg pointerEvents="none" width={width} height={HEIGHT}>
          {strokes.map((s, i) => (
            <Path key={i} d={strokeToPath(s)} stroke="#111" strokeWidth={(3 * width) / SIG_W} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
        </Svg>
      </View>
      <View style={styles.row}>
        <Button variant="ghost" label={t('delivery.signature.clear')} disabled={!inked || busy} onPress={() => setStrokes([])} style={styles.flex} />
        <Button label={t('delivery.signature.submit')} disabled={!inked} loading={busy} onPress={() => onSubmit(signaturePng(strokes, width, HEIGHT))} style={styles.flex} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { width: '100%', height: HEIGHT, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#cbd5e1', overflow: 'hidden' },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
