import { MINIAPP_SCOPES, type MiniAppManifest, type MiniAppScope, readManifest } from '@caselind/contracts';

/** Logique pure de l'écran de consentement natif (lien profond `caselind://miniapps/consent?...`), testée sans React. */

export interface ConsentParams {
  clientId: string;
  redirectUri: string;
  scopes: MiniAppScope[];
  state: string;
  codeChallenge: string;
}

export type ConsentParamsError = 'client_id' | 'redirect_uri' | 'scope' | 'state' | 'code_challenge' | 'code_challenge_method';

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/** Vrai pour une URL https sans identifiants ni fragment ni joker (le serveur compare ensuite à l'identique aux adresses enregistrées). */
export function isSafeRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && u.hostname.length > 0 && !uri.includes('*');
  } catch {
    return false;
  }
}

/** Paramètres du lien : PKCE S256 obligatoire (challenge de 43 caractères, méthode S256 explicite), état d'au moins 8 caractères. */
export function parseConsentParams(raw: Record<string, string | string[] | undefined>): { ok: true; value: ConsentParams } | { ok: false; error: ConsentParamsError } {
  const clientId = first(raw.client_id);
  if (!clientId || clientId.length > 100) return { ok: false, error: 'client_id' };
  const redirectUri = first(raw.redirect_uri);
  if (!redirectUri || redirectUri.length > 2000 || !isSafeRedirect(redirectUri)) return { ok: false, error: 'redirect_uri' };
  const scopes = [...new Set(first(raw.scope).split(/\s+/).filter(Boolean))];
  if (scopes.length === 0 || !scopes.every((s): s is MiniAppScope => (MINIAPP_SCOPES as readonly string[]).includes(s))) return { ok: false, error: 'scope' };
  const state = first(raw.state);
  if (state.length < 8 || state.length > 500) return { ok: false, error: 'state' };
  const codeChallenge = first(raw.code_challenge);
  if (!BASE64URL_43.test(codeChallenge)) return { ok: false, error: 'code_challenge' };
  if (first(raw.code_challenge_method) !== 'S256') return { ok: false, error: 'code_challenge_method' };
  return { ok: true, value: { clientId, redirectUri, scopes: scopes as MiniAppScope[], state, codeChallenge } };
}

/** Retour à l'application après un refus (RFC 6749 : `error=access_denied` et l'état reçu). À n'appeler qu'une fois la redirection validée par le serveur. */
export function deniedRedirect(redirectUri: string, state: string): string {
  const u = new URL(redirectUri);
  u.searchParams.set('error', 'access_denied');
  u.searchParams.set('state', state);
  return u.toString();
}

/** Un manifeste lisible (null si absent ou invalide : l'écran refuse alors d'autoriser). */
export const manifestOf = (raw: unknown): MiniAppManifest | null => readManifest(raw);

/** Plafond de coût lisible : null s'il n'y en a pas. */
export const costCap = (m: MiniAppManifest): { amountMinor: number; currency: string } | null =>
  m.costs.maxAmountMinor !== null && m.costs.currency !== null ? { amountMinor: m.costs.maxAmountMinor, currency: m.costs.currency } : null;
