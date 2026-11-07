import type { ComponentType } from 'react';
import { Platform, Share } from 'react-native';

declare const require: (id: string) => unknown;

type QrProps = { value: string; size?: number; color?: string; backgroundColor?: string };

/** Composant QR de `react-native-qrcode-svg`, ou null si le paquet n'est pas installé (repli texte). */
export function loadQrComponent(): ComponentType<QrProps> | null {
  try {
    const mod = require('react-native-qrcode-svg') as { default?: unknown };
    return (mod.default ?? mod) as ComponentType<QrProps>;
  } catch {
    return null;
  }
}

/** Copie dans le presse-papiers : navigator.clipboard (web), expo-clipboard si présent ; false si impossible. */
export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const mod = require('expo-clipboard') as { setStringAsync(t: string): Promise<boolean> };
    await mod.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

/** Feuille de partage du système. */
export async function shareText(text: string): Promise<void> {
  try {
    await Share.share({ message: text });
  } catch {
    /* annulé ou indisponible */
  }
}
