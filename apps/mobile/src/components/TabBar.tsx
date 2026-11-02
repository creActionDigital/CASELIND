import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n, type MessageKey } from '../i18n';
import { shadow, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { PublishSheet } from './PublishSheet';

type Icon = ComponentProps<typeof Ionicons>['name'];

// Ordre imposé : Accueil · Maps · + Publier · Messagerie · Plus.
const TABS: { name: string; label: MessageKey; icon: Icon; iconOn: Icon }[] = [
  { name: 'index', label: 'tabs.home', icon: 'home-outline', iconOn: 'home' },
  { name: 'maps', label: 'tabs.maps', icon: 'map-outline', iconOn: 'map' },
  { name: 'publish', label: 'tabs.publish', icon: 'add', iconOn: 'add' },
  { name: 'messages', label: 'tabs.messages', icon: 'chatbubbles-outline', iconOn: 'chatbubbles' },
  { name: 'more', label: 'tabs.more', icon: 'grid-outline', iconOn: 'grid' },
];

export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [publishOpen, setPublishOpen] = useState(false);
  const activeName = state.routes[state.index]?.name;

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.tabBar, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      {TABS.map((tab) => {
        const label = t(tab.label);
        if (tab.name === 'publish') {
          return (
            <View key={tab.name} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => setPublishOpen(true)}
                style={({ pressed }) => [
                  styles.publish,
                  shadow.raised,
                  { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="add" size={32} color={colors.onAccent} />
              </Pressable>
            </View>
          );
        }
        const route = state.routes.find((r) => r.name === tab.name);
        if (!route) return null;
        const focused = activeName === tab.name;
        const color = focused ? colors.primary : colors.textMuted;
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            onPress={() => {
              if (!focused) navigateToTab(route.key);
            }}
            style={styles.cell}
          >
            <Ionicons name={focused ? tab.iconOn : tab.icon} size={24} color={color} />
            <Text variant="caption" color={color} numberOfLines={1} style={focused ? { fontWeight: '700' } : undefined}>
              {label}
            </Text>
          </Pressable>
        );
      })}
      <PublishSheet visible={publishOpen} onClose={() => setPublishOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.xs },
  cell: { flex: 1, minHeight: TOUCH + 8, alignItems: 'center', justifyContent: 'center', gap: 2 },
  publish: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
  },
});
