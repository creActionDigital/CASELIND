import type { RidePoint } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../i18n';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Text } from '../../ui';

/** Date et heure locales courtes d’un instant ISO. */
export const formatWhen = (iso: string, locale: string): string =>
  new Date(iso).toLocaleString(locale, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Jour AAAA-MM-JJ lisible, sans décalage de fuseau. */
export const formatDay = (day: string, locale: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Ligne de choix d’un lieu : ouvre la feuille de lieux (PlaceSheet). */
export function PlaceRow({ label, point, icon, onPress }: { label: string; point: RidePoint | null; icon: 'radio-button-on' | 'flag-outline'; onPress: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${point ? point.label : t('mobility.choose')}`}
      onPress={onPress}
      style={[styles.place, { backgroundColor: colors.surface }]}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" muted>
          {label}
        </Text>
        <Text variant="bodyStrong" numberOfLines={1} color={point ? undefined : colors.textMuted}>
          {point ? point.label : t('mobility.choose')}
        </Text>
      </View>
      <Text variant="small" color={colors.primary}>
        {point ? t('mobility.change') : ''}
      </Text>
    </Pressable>
  );
}

/** Étoiles 1 à 5 : un appui envoie la note. */
export function StarPicker({ label, busy, onPick }: { label: string; busy?: boolean; onPick: (rating: number) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="bodyStrong">{label}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={t('mobility.rate.star' as MessageKey, { n })}
            disabled={busy}
            onPress={() => onPick(n)}
            style={styles.star}
          >
            <Ionicons name="star-outline" size={30} color={colors.primary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  place: { minHeight: TOUCH + 12, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.md },
  star: { minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
