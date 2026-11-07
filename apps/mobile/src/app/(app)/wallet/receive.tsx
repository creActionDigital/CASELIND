import { Stack } from 'expo-router';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { useI18n } from '../../../i18n';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Avatar, Button, Text } from '../../../ui';
import { SandboxBanner } from '../../../wallet/ui';

/**
 * Recevoir : @handle en grand et partage. Aucune bibliothèque QR n'est installée (ni react-native-svg, ni qrcode) :
 * le QR « profil » reste un point ouvert, sans dépendance ajoutée dans ce lot.
 */
export default function WalletReceive() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { me } = useAuth();
  const handle = me?.handle ?? '';
  return (
    <>
      <Stack.Screen options={{ title: t('wallet.receive.title') }} />
      <ScrollView contentContainerStyle={styles.pad}>
        <SandboxBanner />
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Avatar name={me?.displayName ?? '?'} size={64} />
          <Text variant="heading">{me?.displayName}</Text>
          <Text variant="display" color={colors.primary} selectable accessibilityLabel={t('wallet.receive.handleLabel', { handle })} adjustsFontSizeToFit numberOfLines={1}>
            @{handle}
          </Text>
          <Text muted style={{ textAlign: 'center' }}>
            {t('wallet.receive.intro')}
          </Text>
        </View>
        <Button
          label={t('wallet.receive.share')}
          onPress={() => void Share.share({ message: t('wallet.receive.shareMessage', { handle }) }).catch(() => undefined)}
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.md },
});
