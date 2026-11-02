import Constants from 'expo-constants';

/**
 * Base de l'API. Port par défaut de l'API : 3000 (apps/api/src/config/env.ts).
 * Sans EXPO_PUBLIC_API_URL, en développement sur un téléphone (Expo Go), `localhost` désignerait le
 * téléphone : on reprend l'hôte du serveur Metro (`hostUri`, l'IP du PC sur le réseau local).
 */
function defaultApiUrl(): string {
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${devHost && devHost !== 'localhost' ? devHost : 'localhost'}:3000/v1`;
}
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultApiUrl();

/** Origine de l'API (sans le préfixe /v1) : sert au socket et aux chemins absolus renvoyés par l'API. */
export function originOf(apiUrl: string): string {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return apiUrl.replace(/\/v1\/?$/, '');
  }
}
export const API_ORIGIN = originOf(API_URL);

/** Résout un chemin renvoyé par l'API (`/v1/media/…`) en URL absolue. */
export function absoluteUrl(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : API_ORIGIN + pathOrUrl;
}
