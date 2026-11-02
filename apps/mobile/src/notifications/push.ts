import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '../auth/auth-context';

/** Les notifications push n'existent pas sur le web. */
export const PUSH_SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

export type PushResult = 'registered' | 'denied' | 'unavailable';

let currentToken: string | null = null;

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

async function obtainToken(): Promise<string | null> {
  const id = projectId();
  if (!id) {
    // Développement sans projet EAS : pas de jeton Expo possible, on continue sans push.
    console.info('[push] aucun projectId EAS : enregistrement push ignoré');
    return null;
  }
  const Notifications = await import('expo-notifications');
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return data;
  } catch (err) {
    console.info('[push] jeton Expo indisponible', err);
    return null;
  }
}

async function registerWithServer(token: string): Promise<void> {
  currentToken = token;
  await api.request('/me/push-tokens', {
    method: 'PUT',
    body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
  });
}

export async function getPushPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  if (!PUSH_SUPPORTED) return 'unsupported';
  const Notifications = await import('expo-notifications');
  const s = await Notifications.getPermissionsAsync();
  return s.granted ? 'granted' : s.canAskAgain === false ? 'denied' : 'undetermined';
}

/** Demande la permission (après l'explication affichée à l'écran), puis enregistre le jeton. */
export async function requestPushAndRegister(): Promise<PushResult> {
  if (!PUSH_SUPPORTED) return 'unavailable';
  const Notifications = await import('expo-notifications');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let status = await Notifications.getPermissionsAsync();
  if (!status.granted) status = await Notifications.requestPermissionsAsync();
  if (!status.granted) return 'denied';
  const token = await obtainToken();
  if (!token) return 'unavailable';
  await registerWithServer(token);
  return 'registered';
}

/** Au démarrage de session : si la permission est déjà accordée, on rafraîchit l'enregistrement sans rien demander. */
export async function registerPushIfGranted(): Promise<void> {
  try {
    if ((await getPushPermission()) !== 'granted') return;
    const token = await obtainToken();
    if (token) await registerWithServer(token);
  } catch (err) {
    console.info('[push] enregistrement ignoré', err);
  }
}

/** À appeler AVANT `POST /auth/logout` (le jeton d'accès doit encore être valide). Ne lève jamais. */
export async function unregisterPush(): Promise<void> {
  if (!PUSH_SUPPORTED) return;
  try {
    const token = currentToken ?? (((await getPushPermission()) === 'granted' && (await obtainToken())) || null);
    if (token) await api.request('/me/push-tokens/unregister', { method: 'POST', body: { token } });
  } catch (err) {
    console.info('[push] désenregistrement ignoré', err);
  } finally {
    currentToken = null;
  }
}
