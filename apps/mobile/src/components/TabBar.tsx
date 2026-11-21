import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { CreateSheet } from './CreateSheet';
import { useI18n, type MessageKey } from '../i18n';
import { brandGradient, shadow, spacing } from '../theme/tokens';

type Icon = ComponentProps<typeof Ionicons>['name'];

// Ordre imposé : Accueil · Maps · + (social et marketplace) · Messagerie · Plus.
const TABS: { name: string; label: MessageKey; icon: Icon; iconOn: Icon }[] = [
  { name: 'index', label: 'tabs.home', icon: 'home-outline', iconOn: 'home' },
  { name: 'maps', label: 'tabs.maps', icon: 'map-outline', iconOn: 'map' },
  { name: 'hub', label: 'tabs.hub', icon: 'add', iconOn: 'add' },
  { name: 'messages', label: 'tabs.messages', icon: 'chatbubble-ellipses-outline', iconOn: 'chatbubble-ellipses' },
  { name: 'more', label: 'tabs.more', icon: 'grid-outline', iconOn: 'grid' },
];

/** Barre flottante en pilule sombre ; le bouton central en dégradé ouvre l'espace social et marketplace. */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [creating, setCreating] = useState(false);
  const activeName = state.routes[state.index]?.name;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={[styles.pill, shadow.float]}>
        {TABS.map((tab) => {
          const route = state.routes.find((r) => r.name === tab.name);
          if (!route) return null;
          const focused = activeName === tab.name;
          const go = () => {
            if (!focused) navigateToTab(route.key);
          };
          if (tab.name === 'hub') {
            return (
              <View key={tab.name} style={styles.centerCell}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('create.title')}
                  onPress={() => setCreating(true)}
                  style={({ pressed }) => [styles.centerBtn, shadow.float, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}
                >
                  <LinearGradient colors={brandGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.centerFill}>
                    <Ionicons name="add" size={30} color="#FFFFFF" />
                  </LinearGradient>
                </Pressable>
              </View>
            );
          }
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityLabel={t(tab.label)}
              accessibilityState={{ selected: focused }}
              onPress={go}
              style={styles.cell}
            >
              <View style={[styles.iconWrap, focused && styles.iconOn]}>
                <Ionicons name={focused ? tab.iconOn : tab.icon} size={22} color={focused ? '#FFFFFF' : 'rgba(255,255,255,0.62)'} />
              </View>
            </Pressable>
          );
        })}
      </View>
      <CreateSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    borderRadius: 32,
    backgroundColor: '#14141C',
    paddingHorizontal: spacing.sm,
  },
  cell: { flex: 1, height: 64, alignItems: 'center', justifyContent: 'center' },
  iconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  iconOn: { backgroundColor: 'rgba(255,255,255,0.14)' },
  centerCell: { flex: 1, alignItems: 'center' },
  centerBtn: { width: 64, height: 64, borderRadius: 32, marginTop: -22 },
  centerFill: { flex: 1, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#FFFFFF' },
});
