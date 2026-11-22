import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../../theme/tokens';
import { ServiceTile } from './ServiceTile';

export interface ServiceItem {
  id: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  /** Force l'orange (sinon bleu et orange alternent). */
  accent?: boolean;
  badge?: number;
}

/** Grille unique de services : 4 tuiles par ligne, bleu/orange en alternance. Jamais de défilement horizontal pour des services. */
export function ServiceGrid({ items }: { items: ServiceItem[] }) {
  return (
    <View style={styles.grid}>
      {items.map((s, i) => (
        <View key={s.id} style={styles.cell}>
          <ServiceTile icon={s.icon} label={s.label} badge={s.badge} onPress={s.onPress} tone={s.accent || (s.accent === undefined && i % 2 === 1) ? 'action' : 'primary'} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  cell: { width: '25%', alignItems: 'center' },
});
