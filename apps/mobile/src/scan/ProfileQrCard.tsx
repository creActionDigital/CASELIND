import { Share, View } from 'react-native';
import { useI18n } from '../i18n';
import { spacing } from '../theme/tokens';
import { Button, Text } from '../ui';
import { QrCode } from './QrCode';
import { buildProfileQr } from './scan-logic';

/** QR de profil (`caselind://u/<handle>`), reconnu par le scanner CASELIND. */
export function ProfileQrCard({ handle, size = 200 }: { handle: string; size?: number }) {
  const { t } = useI18n();
  const value = buildProfileQr(handle);
  return (
    <View style={{ gap: spacing.md, alignItems: 'stretch' }}>
      <QrCode value={value} size={size} label={t('scan.profileQrLabel', { handle })} />
      <Text variant="small" muted style={{ textAlign: 'center' }}>
        {t('scan.profileQrHint')}
      </Text>
      <Button variant="secondary" label={t('scan.profileQrShare')} onPress={() => void Share.share({ message: value }).catch(() => undefined)} />
    </View>
  );
}
