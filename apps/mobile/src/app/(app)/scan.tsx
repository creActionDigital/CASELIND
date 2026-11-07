import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { classifyScan, scanRoute } from '../../scan/scan-logic';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, Text, TextField } from '../../ui';

/** Scanner universel : QR marchand, connexion web, profil. Caméra demandée au besoin ; repli « Coller un code ». */
export default function Scan() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  const [pasted, setPasted] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const locked = useRef(false);

  useFocusEffect(
    useCallback(() => {
      locked.current = false;
    }, []),
  );

  function handle(raw: string) {
    if (locked.current) return;
    const route = scanRoute(classifyScan(raw));
    if (!route) {
      setMessage(t('scan.unknown'));
      return;
    }
    locked.current = true;
    setMessage(null);
    router.push(route as never);
  }

  const granted = permission?.granted === true;
  const denied = asked && !granted;

  return (
    <>
      <Stack.Screen options={{ title: t('scan.title') }} />
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        {granted ? (
          <View style={[styles.camera, { borderColor: colors.border }]} accessibilityLabel={t('scan.cameraLabel')}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(r: { data: string }) => handle(r.data)}
            />
          </View>
        ) : (
          <View style={[styles.explain, { backgroundColor: colors.surface }]}>
            <Text variant="heading" accessibilityRole="header">
              {t('scan.permTitle')}
            </Text>
            <Text muted>{denied ? t('scan.permDenied') : t('scan.permBody')}</Text>
            {!denied || permission?.canAskAgain ? (
              <Button
                label={t('scan.permAllow')}
                onPress={() => {
                  setAsked(true);
                  void requestPermission().catch(() => undefined);
                }}
              />
            ) : null}
          </View>
        )}

        <Text muted style={{ textAlign: 'center' }}>
          {t('scan.hint')}
        </Text>
        {message ? (
          <Text color={colors.danger} accessibilityRole="alert" style={{ textAlign: 'center' }}>
            {message}
          </Text>
        ) : null}

        <TextField
          label={t('scan.paste')}
          hint={t('scan.pasteHint')}
          value={pasted}
          onChangeText={(v) => {
            setPasted(v);
            setMessage(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <Button label={t('scan.pasteGo')} variant="secondary" disabled={pasted.trim().length === 0} onPress={() => handle(pasted)} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  camera: { aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, backgroundColor: '#000' },
  explain: { borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
});
