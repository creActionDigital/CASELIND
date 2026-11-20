import { MINIAPP_API_ENDPOINTS, MINIAPP_EVENTS, type MiniAppManifest, type MiniAppScope, validateManifest } from '@caselind/contracts';

/** Logique pure de l'éditeur de manifeste (portail développeur) : modèle de départ et validation locale, mêmes règles que le serveur. */

/** Manifeste de départ cohérent avec les accès de l'application : à compléter (finalités, conservation, coûts, liens). */
export function manifestTemplate(scopes: readonly MiniAppScope[]): MiniAppManifest {
  return {
    dataAccessed: scopes.map((scope) => ({ scope, purpose: '', retention: '' })),
    endpoints: MINIAPP_API_ENDPOINTS.filter((e) => scopes.includes(e.scope)).map((e) => ({ method: e.method, path: e.path })),
    events: MINIAPP_EVENTS.filter((e) => !e.startsWith('payment.') || scopes.includes('wallet.pay')),
    costs: { model: 'free', description: '', maxAmountMinor: null, currency: null },
    termsUrl: 'https://',
    privacyUrl: 'https://',
    supportEmail: '',
    dataLocation: '',
  };
}

export type ManifestCheck = { ok: true; manifest: MiniAppManifest } | { ok: false; problems: string[] };

/** JSON saisi -> manifeste valide pour ces accès, ou la liste des problèmes (`chemin : message`). */
export function checkManifestText(text: string, scopes: readonly string[]): ManifestCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problems: ['json : invalid JSON'] };
  }
  const r = validateManifest(raw, scopes);
  return r.ok ? r : { ok: false, problems: r.problems.map((p) => `${p.path} : ${p.message}`) };
}
