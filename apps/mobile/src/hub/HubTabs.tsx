import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { glass, onMedia, TOUCH } from '../theme/tokens';
import { Text } from '../ui';
import { HUB_TABS, type HubTab } from './logic';

/** Rond translucide 44 pt posé sur un média (retour, recherche). */
export function GlassButton({ icon, label, onPress }: { icon: 'chevron-back' | 'search'; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.round, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={onMedia} />
    </Pressable>
  );
}

interface Props {
  active: number;
  onSelect: (index: number) => void;
  left?: ReactNode;
  right?: ReactNode;
}

/** Onglets texte en haut de l'écran, l'actif étant souligné ; voile sombre uni derrière pour le contraste. */
export function HubTabs({ active, onSelect, left, right }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.slot}>{left}</View>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {HUB_TABS.map((k: HubTab, i) => {
          const on = i === active;
          return (
            <Pressable
              key={k}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => onSelect(i)}
              style={styles.tab}
            >
              <Text variant={on ? 'bodyStrong' : 'body'} color={onMedia} numberOfLines={1} style={{ opacity: on ? 1 : 0.8, flexShrink: 1 }}>
                {t(`hub.tab.${k}` as const)}
              </Text>
              <View style={[styles.underline, { backgroundColor: on ? onMedia : 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.slot}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 10,
  },
  slot: { width: TOUCH, alignItems: 'flex-start' },
  // Les onglets se partagent la place entre les deux boutons (libellés longs en sw : sinon débordement à 375 px).
  tabs: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  tab: { minHeight: TOUCH, flexShrink: 1, minWidth: 0, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  underline: { height: 2, width: 18, borderRadius: 1, marginTop: 2 },
  round: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: glass.dark,
    borderWidth: 1,
    borderColor: glass.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
