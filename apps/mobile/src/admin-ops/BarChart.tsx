import type { AnalyticsPoint } from '@caselind/contracts';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { barHeights, shortDay, summarizeSeries } from './logic';

const HEIGHT = 72;

/**
 * Barres simples dessinées avec des View (aucune bibliothèque de graphiques). Le graphique est lu comme UN texte
 * (total, maximum et son jour, moyenne) : les barres elles-mêmes sont cachées aux lecteurs d'écran.
 */
export function BarChart({ title, points, format = (n) => String(n) }: { title: string; points: AnalyticsPoint[]; format?: (n: number) => string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = summarizeSeries(points);
  const heights = barHeights(points.map((p) => p.value), HEIGHT);
  const spoken = t('aops.analytics.chartSummary', { title, total: format(s.total), max: format(s.max), day: shortDay(s.maxDay), avg: format(s.average) });
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={spoken} style={styles.wrap}>
      <Text variant="small" muted>{title}</Text>
      <View style={[styles.bars, { borderBottomColor: colors.border }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {heights.map((h, i) => (
          <View key={points[i]!.day} style={styles.slot}>
            <View style={{ height: h, backgroundColor: colors.primary, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
          </View>
        ))}
      </View>
      <View style={styles.axis} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text variant="caption" muted>{shortDay(points[0]?.day ?? null)}</Text>
        <Text variant="caption" muted>{shortDay(points.at(-1)?.day ?? null)}</Text>
      </View>
      <Text variant="caption" muted importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {t('aops.analytics.chartLegend', { total: format(s.total), max: format(s.max), day: shortDay(s.maxDay) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginTop: spacing.sm },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: HEIGHT, gap: 1, borderBottomWidth: StyleSheet.hairlineWidth },
  slot: { flex: 1, justifyContent: 'flex-end' },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
