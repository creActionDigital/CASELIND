import { MINIAPP_SCOPES, type AnalyticsPoint, type MiniAppScope, type MiniAppUsageDay } from '@caselind/contracts';

/** Logique pure du portail développeur (testée sans React). */

export const SEMVER_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
export const isSemver = (v: string): boolean => SEMVER_RE.test(v.trim());

/** Version suivante proposée (correctif +1) d'après la plus haute version connue ; 1.0.0 s'il n'y en a pas. */
export function suggestNextVersion(versions: readonly string[]): string {
  let best: [number, number, number] | null = null;
  for (const v of versions) {
    if (!isSemver(v)) continue;
    const p = v.split('.').map(Number) as [number, number, number];
    if (!best || p[0] > best[0] || (p[0] === best[0] && (p[1] > best[1] || (p[1] === best[1] && p[2] > best[2])))) best = p;
  }
  return best ? `${best[0]}.${best[1]}.${best[2] + 1}` : '1.0.0';
}

/** Scopes de `next` absents de `current` : ils exigent un nouveau consentement des utilisateurs. */
export const addedScopes = (current: readonly string[], next: readonly string[]): string[] => next.filter((s) => !current.includes(s));

export function toggleScope(list: readonly MiniAppScope[], scope: MiniAppScope): MiniAppScope[] {
  return MINIAPP_SCOPES.filter((s) => (s === scope ? !list.includes(s) : list.includes(s)));
}

export const isHttpsUrl = (v: string): boolean => {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && u.hostname.length > 0 && !v.includes('*');
  } catch {
    return false;
  }
};

/** Adresses de redirection saisies séparées par des espaces, virgules ou retours à la ligne ; doublons retirés. */
export const parseRedirectUris = (raw: string): string[] => [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];

export type AppFormError = 'name' | 'launchUrl' | 'redirectUris' | 'scopes';

export interface AppForm {
  name: string;
  launchUrl: string;
  redirectUris: string;
  scopes: readonly MiniAppScope[];
}

/** Première erreur du formulaire de création (règles du contrat : nom 2-60, https partout, 1 à 10 redirections), null si valide. */
export function validateAppForm(f: AppForm): AppFormError | null {
  const name = f.name.trim();
  if (name.length < 2 || name.length > 60) return 'name';
  if (!isHttpsUrl(f.launchUrl)) return 'launchUrl';
  const uris = parseRedirectUris(f.redirectUris);
  if (uris.length < 1 || uris.length > 10 || !uris.every(isHttpsUrl)) return 'redirectUris';
  if (f.scopes.length === 0) return 'scopes';
  return null;
}

export type UsageKey = 'apiCalls' | 'authorizations' | 'activeUsers' | 'paymentRequests' | 'paymentsConfirmed' | 'errors';

/** Série du contrat de statistiques -> points du graphique à barres existant. */
export const usagePoints = (items: readonly MiniAppUsageDay[], key: UsageKey): AnalyticsPoint[] => items.map((d) => ({ day: d.day, value: d[key] }));

/** Part d'erreurs sur les appels, en pourcentage entier (0 sans appel). */
export const errorRatePercent = (errors: number, calls: number): number => (calls <= 0 ? 0 : Math.min(100, Math.round((errors * 100) / calls)));
