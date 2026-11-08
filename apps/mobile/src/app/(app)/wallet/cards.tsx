import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { brandColor, radius, spacing } from '../../../theme/tokens';
import { Button, Screen, Text } from '../../../ui';
import { SandboxBanner } from '../../../wallet/ui';

/** Cartes virtuelles : pas encore d'émetteur, l'écran l'annonce sans rien inventer. */
export default function WalletCards() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <Stack.Screen options={{ title: t('wallet.cards.title') }} />
      <View style={styles.wrap}>
        <SandboxBanner />
        <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.cardBack, { backgroundColor: '#0F6B3E' }]} />
          <View style={[styles.cardFront, { backgroundColor: brandColor }]}>
            <Ionicons name="card-outline" size={34} color="#FFFFFF" />
          </View>
        </View>
        <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('wallet.cards.soonTitle')}
        </Text>
        <Text muted style={{ textAlign: 'center' }}>
          {t('wallet.cards.soonBody')}
        </Text>
        <Button label={t('wallet.cards.back')} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  art: { height: 180, alignItems: 'center', justifyContent: 'center' },
  cardBack: { position: 'absolute', width: 220, height: 138, borderRadius: radius.xl, transform: [{ rotate: '-8deg' }, { translateX: 22 }] },
  cardFront: { width: 220, height: 138, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '5deg' }] },
});
