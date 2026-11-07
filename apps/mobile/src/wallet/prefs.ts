import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { DEFAULT_PREFS, parsePrefs, type WalletPrefs } from './prefs-logic';

const KEY = 'caselind-wallet-prefs.json';

let state: WalletPrefs = DEFAULT_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') raw = globalThis.localStorage?.getItem(KEY) ?? null;
    else {
      const { File, Paths } = await import('expo-file-system');
      const file = new File(Paths.document, KEY);
      raw = file.exists ? await file.text() : null;
    }
    state = parsePrefs(raw);
    listeners.forEach((l) => l());
  } catch {
    /* préférences par défaut */
  }
}

async function persist(): Promise<void> {
  try {
    const raw = JSON.stringify(state);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, raw);
    else {
      const { File, Paths } = await import('expo-file-system');
      const file = new File(Paths.document, KEY);
      if (!file.exists) file.create();
      file.write(raw);
    }
  } catch {
    /* meilleur effort */
  }
}

export function setWalletPrefs(patch: Partial<WalletPrefs>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  void persist();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  void load();
  return () => {
    listeners.delete(l);
  };
}

export function useWalletPrefs(): WalletPrefs {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => DEFAULT_PREFS,
  );
}
