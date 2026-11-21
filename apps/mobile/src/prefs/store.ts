import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { DEFAULT_PREFS, parsePrefs, type Prefs } from './logic';

/** Préférences locales de l'appareil (onboarding, langue/pays de premier lancement, thème). Non sensibles. */
const KEY = 'caselind.prefs';
let state: Prefs = DEFAULT_PREFS;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function read(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}
async function write(value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') localStorage.setItem(KEY, value);
    else await SecureStore.setItemAsync(KEY, value);
  } catch {
    /* préférences non conservées : l'app reste utilisable */
  }
}

void read().then((raw) => {
  state = parsePrefs(raw);
  loaded = true;
  emit();
});

export function setPrefs(patch: Partial<Prefs>): void {
  state = { ...state, ...patch };
  emit();
  void write(JSON.stringify(state));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Préférences et indicateur de chargement (le stockage est asynchrone). */
export function usePrefs(): Prefs & { loaded: boolean } {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  const l = useSyncExternalStore(subscribe, () => loaded, () => loaded);
  return { ...s, loaded: l };
}
