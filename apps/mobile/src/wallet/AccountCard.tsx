import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { formatMoney } from '../shop/format';
import { brandColor, radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';

/** Couleurs unies des cartes de compte (texte blanc >= 4,5:1). */
export const ACCOUNT_COLORS: Record<string, string> = { USD: brandColor, CDF: '#0F6B3E' };
const FALLBACK = '#B34700';
export const accountColor = (currency: string): string => ACCOUNT_COLORS[currency] ?? FALLBACK;

export const CARD_W = 220;
export const CARD_H = 140;

/** Un compte du wallet présenté comme une carte (aucune carte bancaire réelle : au plus `•••• USD`). */
export function AccountCard({ currency, balanceMinor, hidden, selected, onPress }: { currency: string; balanceMinor: number; hidden: boolean; selected?: boolean; onPress?: () => void }) {
  const { t, locale } = useI18n();
  const amount = hidden ? '••••••' : formatMoney(balanceMinor, currency, locale);
  const label = `${t('wallet.accountCard', { currency })}, ${hidden ? t('wallet.balanceHiddenLabel') : amount}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: accountColor(currency), opacity: pressed ? 0.9 : 1, borderColor: selected ? '#FFFFFF' : 'transparent' }]}
    >
      <View style={styles.blobA} />
      <View style={styles.blobB} />
      <Text variant="bodyStrong" color="#FFFFFF" numberOfLines={1} adjustsFontSizeToFit>
        {amount}
      </Text>
      <View style={{ flex: 1 }} />
      <View style={styles.bottom}>
        <Ionicons name="wallet-outline" size={26} color="#FFFFFF" />
        <Text variant="caption" color="#FFFFFF">
          •••• {currency}
        </Text>
      </View>
    </Pressable>
  );
}

export function AddCardTile({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.add, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name="add" size={28} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: CARD_W, height: CARD_H, borderRadius: radius.xl, padding: spacing.lg, overflow: 'hidden', borderWidth: 2 },
  blobA: { position: 'absolute', right: -40, top: -40, width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(255,255,255,0.12)' },
  blobB: { position: 'absolute', right: 30, bottom: -50, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.08)' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  add: { width: 84, height: CARD_H, borderRadius: radius.xl, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
});
