import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { motion, radius, shadow, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { shouldDismiss } from './logic';
import { useReduceMotion } from './useReduceMotion';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Libellé de la feuille (lecteurs d'écran). */
  title: string;
  children: ReactNode;
}

/** Feuille basse glissante avec poignée : se ferme en glissant vers le bas, en touchant le fond ou par Échap/retour. */
export function AnimatedSheet({ visible, onClose, title, children }: Props) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const { height: screenH } = useWindowDimensions();
  const y = useRef(new Animated.Value(screenH)).current;
  const [mounted, setMounted] = useState(visible);
  const [h, setH] = useState(300);
  const hRef = useRef(h);
  hRef.current = h;

  const run = (to: number, done?: () => void) => {
    if (reduce) {
      y.setValue(to);
      done?.();
    } else Animated.timing(y, { toValue: to, duration: motion.base, useNativeDriver: true }).start(done);
  };
  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.setValue(screenH);
      run(0);
    } else if (mounted) run(screenH, () => setMounted(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (shouldDismiss(g.dy, g.vy, hRef.current)) onClose();
          else Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [y, onClose],
  );

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} accessibilityRole="button" accessibilityLabel={title} />
      <View style={styles.end} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={title}
          onLayout={(e) => setH(e.nativeEvent.layout.height)}
          style={[styles.sheet, shadow.raised, { backgroundColor: colors.surface, transform: [{ translateY: y }] }]}
        >
          <View {...pan.panHandlers} style={styles.handleZone} accessibilityRole="adjustable" accessibilityLabel={title} accessibilityHint="Swipe down to close">
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>
          <View style={styles.body}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  end: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 640, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '88%' },
  handleZone: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
});
