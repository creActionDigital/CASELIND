import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';

interface Props {
  children: ReactNode;
  scroll?: boolean;
  /** Bords protégés par la zone sûre (par défaut : tous sauf ceux gérés par un en-tête / barre d'onglets). */
  edges?: Edge[];
  padded?: boolean;
  /** Espace réservé en bas, par ex. sous la barre d'onglets flottante. */
  bottomSpace?: number;
}

export function Screen({ children, scroll = true, edges = ['top', 'bottom', 'left', 'right'], padded = true, bottomSpace = 0 }: Props) {
  const { colors } = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.grow, padded && styles.padded]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
      {bottomSpace > 0 && <View style={{ height: bottomSpace }} />}
    </ScrollView>
  ) : (
    <View style={[styles.grow, padded && styles.padded]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Apparition sobre ; ignorée quand « réduire les animations » est actif. */}
        <Animated.View entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)} style={styles.flex}>
          {body}
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  padded: { padding: spacing.lg },
});
