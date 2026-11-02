import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import type { PostVisibility } from './types';

export const VISIBILITIES: PostVisibility[] = ['public', 'followers', 'friends', 'private'];

export const visibilityIcon = {
  public: 'earth-outline',
  followers: 'people-outline',
  friends: 'heart-outline',
  private: 'lock-closed-outline',
} as const;

export const visibilityKey = (v: PostVisibility) => `feed.visibility.${v}` as MessageKey;

/** Segments Public / Abonnés / Amis / Moi seul. */
export function VisibilityPicker({ value, onChange }: { value: PostVisibility; onChange: (v: PostVisibility) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View accessibilityRole="radiogroup" style={[styles.row, { backgroundColor: colors.surfaceAlt }]}>
      {VISIBILITIES.map((v) => {
        const on = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(visibilityKey(v))}
            onPress={() => onChange(v)}
            style={[styles.seg, on && { backgroundColor: colors.surface }]}
          >
            <Text variant="small" color={on ? colors.primary : colors.textMuted} style={{ fontWeight: on ? '600' : '400' }} numberOfLines={1}>
              {t(visibilityKey(v))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, gap: 2 },
  seg: { flex: 1, minHeight: TOUCH - 6, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
});
