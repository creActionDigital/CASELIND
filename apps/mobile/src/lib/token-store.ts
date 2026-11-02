import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Seul module qui touche au stockage du refresh token.
 * - iOS / Android : expo-secure-store (Keychain / Keystore). Jamais AsyncStorage.
 * - Web : REPLI DE DÉVELOPPEMENT UNIQUEMENT (mémoire + sessionStorage) pour pouvoir vérifier
 *   l'application dans un navigateur. Ce n'est pas un stockage sûr ; le web n'est pas une cible de production.
 */
const KEY = 'caselind.refreshToken';
let memory: string | null = null;

const isWeb = Platform.OS === 'web';

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  if (isWeb) {
    return memory ?? session()?.getItem(KEY) ?? null;
  }
  return SecureStore.getItemAsync(KEY);
}

export async function setRefreshToken(token: string): Promise<void> {
  if (isWeb) {
    memory = token;
    try {
      session()?.setItem(KEY, token);
    } catch {
      /* repli mémoire seulement */
    }
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearRefreshToken(): Promise<void> {
  if (isWeb) {
    memory = null;
    try {
      session()?.removeItem(KEY);
    } catch {
      /* ignoré */
    }
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}
