import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { radius, spacing } from '../theme/tokens';
import { Text } from '../ui';
import { useI18n } from '../i18n';

/** QR toujours noir sur blanc (lisible quel que soit le thème), avec zone calme. */
export function QrCode({ value, size = 240, label }: { value: string; size?: number; label?: string }) {
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label ?? t('scan.qrLabel')}
      style={{ backgroundColor: '#FFFFFF', padding: spacing.md, borderRadius: radius.md, alignSelf: 'center' }}
    >
      <QRCode value={value} size={size} color="#000000" backgroundColor="#FFFFFF" ecl="M" />
    </View>
  );
}

export function QrHint({ children }: { children: string }) {
  return (
    <Text variant="small" muted style={{ textAlign: 'center' }}>
      {children}
    </Text>
  );
}
