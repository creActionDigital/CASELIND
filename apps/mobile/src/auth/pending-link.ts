/** Lien de consentement mini-app ouvert hors connexion : mémorisé, puis rejoué une fois connecté. */
const CONSENT_RE = /(?:^|[/:])miniapps\/consent(\?[^#]*)?(?:#.*)?$/i;

/** Chemin interne (`/miniapps/consent?...`) d'une URL de consentement, ou null pour tout autre lien. */
export function consentPathFromUrl(url: string | null | undefined): string | null {
  const m = url ? CONSENT_RE.exec(url) : null;
  return m ? `/miniapps/consent${m[1] ?? ''}` : null;
}

let pending: string | null = null;
export const rememberPendingLink = (url: string | null | undefined): void => {
  const p = consentPathFromUrl(url);
  if (p) pending = p;
};
/** Rend le lien mémorisé une seule fois. */
export function takePendingLink(): string | null {
  const p = pending;
  pending = null;
  return p;
}
