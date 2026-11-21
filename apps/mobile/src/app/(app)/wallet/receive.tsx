import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { useI18n } from '../../../i18n';
import { shareMessage } from '../../../lib/share';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Avatar, Button, Text } from '../../../ui';
import { ProfileQrCard } from '../../../scan/ProfileQrCard';
import { SandboxBanner } from '../../../wallet/ui';

/** Recevoir : QR de profil (`caselind://u/<handle>`), @handle en grand et partage. */
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
          <ProfileQrCard handle={handle} />
          <Text muted style={{ textAlign: 'center' }}>
            {t('wallet.receive.intro')}
          </Text>
        </View>
        <Button
          label={t('wallet.receive.share')}
          onPress={() => void shareMessage({ message: t('wallet.receive.shareMessage', { handle }) }, t('share.copied'))}
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.md },
});
