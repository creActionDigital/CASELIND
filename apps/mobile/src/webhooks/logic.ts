import { type CreateWebhookRequest, type OrgRole, WEBHOOK_EVENTS, type Webhook, type WebhookDelivery, type WebhookEvent } from '@caselind/contracts';

/** Les webhooks envoient des données de commandes hors de la plateforme : propriétaire seulement (`org.admins.manage`). */
export const canManageWebhooks = (role: OrgRole | undefined): boolean => role === 'owner';

export type UrlError = 'empty' | 'invalid' | 'https' | 'credentials' | 'port' | 'host';

/** Contrôle de confort avant l'envoi ; le serveur reste la référence (SSRF, DNS). */
export function checkUrl(text: string): { ok: string } | { error: UrlError } {
  const raw = text.trim();
  if (!raw) return { error: 'empty' };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'invalid' };
  }
  if (u.protocol !== 'https:') return { error: 'https' };
  if (u.username || u.password) return { error: 'credentials' };
  if (u.port !== '' && u.port !== '443' && u.port !== '8443') return { error: 'port' };
  const host = u.hostname.replace(/\.$/, '').toLowerCase();
  if (!host.includes('.')) return { error: 'host' };
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.startsWith('[') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return { error: 'host' };
  return raw.length > 500 ? { error: 'invalid' } : { ok: raw };
}

/** Ajoute ou retire un événement en gardant l'ordre de la liste blanche. */
export function toggleEvent(selected: readonly WebhookEvent[], event: WebhookEvent): WebhookEvent[] {
  const next = new Set(selected);
  if (next.has(event)) next.delete(event);
  else next.add(event);
  return WEBHOOK_EVENTS.filter((e) => next.has(e));
}

export type CreateError = UrlError | 'events';

export function buildWebhook(url: string, events: readonly WebhookEvent[]): { ok: CreateWebhookRequest } | { error: CreateError } {
  const u = checkUrl(url);
  if ('error' in u) return u;
  if (events.length === 0) return { error: 'events' };
  return { ok: { url: u.ok, events: [...events] } };
}

/** Motif `url_*` d'un 400 du serveur (`details: [{ path: 'url', message: 'url_scheme' }]`) → erreur d'écran. */
export function urlErrorOf(details: unknown): UrlError | null {
  if (!Array.isArray(details)) return null;
  const m = details.find((d): d is { path: string; message: string } => !!d && typeof d === 'object' && (d as { path?: unknown }).path === 'url' && typeof (d as { message?: unknown }).message === 'string');
  if (!m) return null;
  switch (m.message) {
    case 'url_scheme':
      return 'https';
    case 'url_userinfo':
      return 'credentials';
    case 'url_port':
      return 'port';
    case 'url_host':
    case 'url_private_address':
      return 'host';
    default:
      return 'invalid';
  }
}

export type HookState = 'disabled' | 'paused' | 'failing' | 'ok';

/** `disabled` : coupé par le système après trop d'échecs ; `paused` : coupé à la main. */
export function hookState(h: Pick<Webhook, 'active' | 'disabledAt' | 'failureCount'>): HookState {
  if (h.disabledAt) return 'disabled';
  if (!h.active) return 'paused';
  return h.failureCount > 0 ? 'failing' : 'ok';
}

/** Hôte seul, pour l'affichage (l'URL complète peut contenir un jeton). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Les 10 plus récentes (le serveur trie déjà du plus récent au plus ancien). */
export const latestDeliveries = (items: readonly WebhookDelivery[]): WebhookDelivery[] => items.slice(0, 10);
