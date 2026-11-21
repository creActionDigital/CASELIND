import { Ionicons } from '@expo/vector-icons';
import * as Camera from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../i18n';
import { nextAction, toState, type PermissionKind, type PermissionState, type RawPermission } from '../../onboarding/permissions-logic';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Badge, Button, Screen, Text } from '../../ui';

type Icon = ComponentProps<typeof Ionicons>['name'];
const ROWS: { kind: PermissionKind; icon: Icon; label: MessageKey; why: MessageKey }[] = [
  { kind: 'notifications', icon: 'notifications-outline', label: 'ma.perm.notifications', why: 'ma.perm.notifications.why' },
  { kind: 'location', icon: 'location-outline', label: 'ma.perm.location', why: 'ma.perm.location.why' },
  { kind: 'camera', icon: 'camera-outline', label: 'ma.perm.camera', why: 'ma.perm.camera.why' },
  { kind: 'photos', icon: 'images-outline', label: 'ma.perm.photos', why: 'ma.perm.photos.why' },
];

const read: Record<PermissionKind, () => Promise<RawPermission>> = {
  notifications: () => Notifications.getPermissionsAsync(),
  location: () => Location.getForegroundPermissionsAsync(),
  camera: () => Camera.Camera.getCameraPermissionsAsync(),
  photos: () => ImagePicker.getMediaLibraryPermissionsAsync(),
};
const ask: Record<PermissionKind, () => Promise<RawPermission>> = {
  notifications: () => Notifications.requestPermissionsAsync(),
  location: () => Location.requestForegroundPermissionsAsync(),
  camera: () => Camera.Camera.requestCameraPermissionsAsync(),
  photos: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
};

type Info = { state: PermissionState; canAskAgain: boolean };

/** Autorisations : explication de chaque usage, état réel et demande réelle via les API Expo. Sur le web, le navigateur demande à l'usage. */
export default function Permissions() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const web = Platform.OS === 'web';
  const [info, setInfo] = useState<Partial<Record<PermissionKind, Info>>>({});
  const [busy, setBusy] = useState<PermissionKind | null>(null);

  const refresh = useCallback(async () => {
    if (web) return;
    const out: Partial<Record<PermissionKind, Info>> = {};
    for (const r of ROWS) {
      try {
        const p = await read[r.kind]();
        out[r.kind] = { state: toState(p), canAskAgain: p.canAskAgain !== false };
      } catch {
        out[r.kind] = { state: 'unavailable', canAskAgain: false };
      }
    }
    setInfo(out);
  }, [web]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(kind: PermissionKind, action: 'ask' | 'settings') {
    if (action === 'settings') {
      void Linking.openSettings().catch(() => {});
      return;
    }
    setBusy(kind);
    try {
      await ask[kind]();
    } catch {
      /* refus ou indisponible : l'état relu ci-dessous le montre */
    }
    await refresh();
    setBusy(null);
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('ma.perm.title') }} />
      <Text muted style={{ marginBottom: spacing.lg }}>
        {t('ma.perm.intro')}
      </Text>
      {web ? (
        <Text accessibilityLiveRegion="polite" style={[styles.note, { backgroundColor: colors.primarySoft }]}>
          {t('ma.perm.web')}
        </Text>
      ) : null}
      {ROWS.map((r) => {
        const i = info[r.kind];
        const action = i ? nextAction(i.state, i.canAskAgain) : 'none';
        return (
          <View key={r.kind} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name={r.icon} size={24} color={colors.primary} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text variant="bodyStrong">{t(r.label)}</Text>
              <Text variant="small" muted>
                {t(r.why)}
              </Text>
              {!web && i ? (
                <View style={{ flexDirection: 'row' }}>
                  <Badge tone={i.state === 'granted' ? 'primary' : 'neutral'} label={t(`ma.perm.state.${i.state}` as MessageKey)} />
                </View>
              ) : null}
              {action !== 'none' ? (
                <Button
                  variant="secondary"
                  label={action === 'settings' ? t('ma.perm.openSettings') : t('ma.perm.allow')}
                  loading={busy === r.kind}
                  onPress={() => void act(r.kind, action)}
                />
              ) : null}
            </View>
          </View>
        );
      })}
      <Button variant="ghost" label={t('ma.setup.continue')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ marginTop: spacing.md }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderRadius: radius.md, marginBottom: spacing.md },
});
