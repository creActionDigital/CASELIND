/** Lien de consentement mini-app ouvert hors connexion : mémorisé, puis rejoué une fois connecté. */
const CONSENT_RE = /(?:^|[/:])miniapps\/consent(\?[^#]*)?(?:#.*)?$/i;

/** Chemin interne (`/miniapps/consent?...`) d'une URL de consentement, ou null pour tout autre lien. */
export function consentPathFromUrl(url: string | null | undefined): string | null {
  const m = url ? CONSENT_RE.exec(url) : null;
  return m ? `/miniapps/consent${m[1] ?? ''}` : null;
}

const AUTH_PATHS = new Set(['', '/', '/welcome', '/sign-in', '/sign-up', '/otp-verify', '/forgot-password', '/reset-password']);

/** Chemin interne d'un lien profond (`/transport`, `/orders/1?x=2`) ; null pour l'accueil, les écrans de connexion ou une URL illisible. */
export function deepPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/[^/?#]*)?(\/[^?#]*)?(\?[^#]*)?/i.exec(url.replace(/\/--(?=\/)/, '').replace(/^(?!https?:|exps?:)[a-z][a-z0-9+.-]*:\/\//i, '/'));
  const path = (m?.[1] ?? '').replace(/\/+$/, '');
  if (!m || AUTH_PATHS.has(path) || !/^\/[\w\-./[\]%]+$/.test(path)) return null;
  return `${path}${m[2] ?? ''}`;
}

let pending: string | null = null;
/** À appeler hors connexion seulement : un utilisateur déjà connecté n'est jamais détourné. */
export const rememberPendingLink = (url: string | null | undefined): void => {
  const p = consentPathFromUrl(url) ?? deepPathFromUrl(url);
  if (p) pending = p;
};
/** Rend le lien mémorisé une seule fois. */
export function takePendingLink(): string | null {
  const p = pending;
  pending = null;
  return p;
}
