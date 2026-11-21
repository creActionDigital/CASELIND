import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { addRecent, parseRecents } from '../messaging/module-d-logic';

/** Mini-apps ouvertes récemment, sur l'appareil seulement (identifiants, rien de sensible). */
const KEY = 'caselind.miniapp.recents';

export async function loadRecents(): Promise<string[]> {
  try {
    return parseRecents(Platform.OS === 'web' ? (typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)) : await SecureStore.getItemAsync(KEY));
  } catch {
    return [];
  }
}

export async function pushRecent(id: string): Promise<void> {
  try {
    const value = JSON.stringify(addRecent(await loadRecents(), id));
    if (Platform.OS === 'web') localStorage.setItem(KEY, value);
    else await SecureStore.setItemAsync(KEY, value);
  } catch {
    /* non conservé : la liste des récentes reste facultative */
  }
}
