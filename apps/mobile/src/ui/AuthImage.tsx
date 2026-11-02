import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useI18n } from '../i18n';
import { getAuthMediaUri } from '../media/auth-media';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from './Text';

interface Props {
  /** `contentUrl` renvoyé par l'API (exige Authorization, donc téléchargé avec le jeton). */
  contentUrl: string | null;
  /** Aperçu local affiché pendant l'envoi. */
  localUri?: string;
  label: string;
  style?: StyleProp<ViewStyle>;
}

/** Image protégée : téléchargement authentifié mis en cache, puis affichage. */
export function AuthImage({ contentUrl, localUri, label, style }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    setUri(null);
    if (!contentUrl) return;
    getAuthMediaUri(contentUrl).then(
      (u) => live && setUri(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [contentUrl]);

  const shown = uri ?? localUri ?? null;
  return (
    <View style={[styles.box, { backgroundColor: colors.surfaceAlt }, style]}>
      {shown ? (
        <Image source={{ uri: shown }} accessibilityLabel={label} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : failed ? (
        <Text variant="caption" muted style={styles.center}>
          {t('media.unavailable')}
        </Text>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center', padding: 8 },
});
