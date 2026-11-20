import { z } from 'zod';
import { httpsUrlSchema, MINIAPP_SCOPES, type MiniAppScope, miniappScopeSchema } from './miniapps.js';
import { webhookDeliveryListSchema, webhookDeliverySchema } from './webhooks.js';

/* Plateforme développeurs, phase 2 (cahier §23) : manifeste déclaratif, événements, notifications, revenus, certification. */

/* ------------------------------------------------------------------ catalogue des endpoints appelables avec un jeton d'application */

export const MINIAPP_API_ENDPOINTS = [
  { method: 'GET', path: '/v1/miniapp-api/me', scope: 'profile.basic' },
  { method: 'GET', path: '/v1/miniapp-api/orders', scope: 'orders.read' },
  { method: 'POST', path: '/v1/miniapp-api/payment-requests', scope: 'wallet.pay' },
  { method: 'GET', path: '/v1/miniapp-api/payment-requests/{id}', scope: 'wallet.pay' },
  { method: 'POST', path: '/v1/miniapp-api/notify', scope: 'notify' },
] as const satisfies readonly { method: 'GET' | 'POST'; path: string; scope: MiniAppScope }[];

export const endpointKey = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;
const CATALOG = new Map<string, MiniAppScope>(MINIAPP_API_ENDPOINTS.map((e) => [endpointKey(e.method, e.path), e.scope]));

/* ------------------------------------------------------------------ événements sortants */

export const MINIAPP_EVENTS = ['authorization.granted', 'authorization.revoked', 'payment.confirmed', 'payment.declined', 'user.data_deletion_requested'] as const;
export const miniappEventSchema = z.enum(MINIAPP_EVENTS);
export type MiniAppEvent = z.infer<typeof miniappEventSchema>;

/** Les événements de paiement exigent le scope wallet.pay ; les autres sont toujours permis. */
export const EVENT_SCOPE: Partial<Record<MiniAppEvent, MiniAppScope>> = { 'payment.confirmed': 'wallet.pay', 'payment.declined': 'wallet.pay' };

/* ------------------------------------------------------------------ manifeste */

export const MINIAPP_COST_MODELS = ['free', 'per_use', 'subscription', 'other'] as const;

export const miniappManifestSchema = z.strictObject({
  dataAccessed: z
    .array(z.strictObject({ scope: miniappScopeSchema, purpose: z.string().trim().min(3).max(120), retention: z.string().trim().min(1).max(80) }))
    .max(MINIAPP_SCOPES.length),
  endpoints: z
    .array(
      z.strictObject({
        method: z.enum(['GET', 'POST']),
        path: z.string().trim().max(200),
      }),
    )
    .max(20),
  events: z.array(miniappEventSchema).max(MINIAPP_EVENTS.length),
  costs: z.strictObject({
    model: z.enum(MINIAPP_COST_MODELS),
    description: z.string().trim().min(1).max(300),
    maxAmountMinor: z.number().int().positive().max(100_000_000).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code expected').nullable(),
  }),
  termsUrl: httpsUrlSchema,
  privacyUrl: httpsUrlSchema,
  supportEmail: z.email().max(200),
  dataLocation: z.string().trim().min(2).max(80),
});
export type MiniAppManifest = z.infer<typeof miniappManifestSchema>;

export interface ManifestProblem {
  path: string;
  message: string;
}

/**
 * Cohérence du manifeste avec les scopes de l'application (partagée API / SDK / outil de validation) : chaque scope a sa
 * ligne « données consultées » et inversement, chaque endpoint est au catalogue et couvert par un scope, les événements de
 * paiement exigent wallet.pay, un coût gratuit n'a pas de plafond, un plafond a une devise. Liste vide = manifeste complet.
 */
export function manifestProblems(m: MiniAppManifest, scopes: readonly string[]): ManifestProblem[] {
  const out: ManifestProblem[] = [];
  const declared = m.dataAccessed.map((d) => d.scope);
  if (new Set(declared).size !== declared.length) out.push({ path: 'dataAccessed', message: 'duplicate scope' });
  for (const s of scopes) if (!declared.includes(s as MiniAppScope)) out.push({ path: 'dataAccessed', message: `scope ${s} is not described` });
  for (const s of declared) if (!scopes.includes(s)) out.push({ path: 'dataAccessed', message: `scope ${s} is not requested` });
  const seen = new Set<string>();
  for (const e of m.endpoints) {
    const key = endpointKey(e.method, e.path);
    const scope = CATALOG.get(key);
    if (seen.has(key)) out.push({ path: 'endpoints', message: `duplicate endpoint ${key}` });
    seen.add(key);
    if (!scope) out.push({ path: 'endpoints', message: `unknown endpoint ${key}` });
    else if (!scopes.includes(scope)) out.push({ path: 'endpoints', message: `${key} needs scope ${scope}` });
  }
  if (new Set(m.events).size !== m.events.length) out.push({ path: 'events', message: 'duplicate event' });
  for (const ev of m.events) {
    const need = EVENT_SCOPE[ev];
    if (need && !scopes.includes(need)) out.push({ path: 'events', message: `${ev} needs scope ${need}` });
  }
  if (m.costs.model === 'free' && m.costs.maxAmountMinor !== null) out.push({ path: 'costs.maxAmountMinor', message: 'a free app has no maximum amount' });
  if ((m.costs.maxAmountMinor === null) !== (m.costs.currency === null)) out.push({ path: 'costs.currency', message: 'maxAmountMinor and currency go together' });
  return out;
}

/** Valide un manifeste brut (zod strict + cohérence) : renvoie le manifeste ou la liste des problèmes. */
export function validateManifest(raw: unknown, scopes: readonly string[]): { ok: true; manifest: MiniAppManifest } | { ok: false; problems: ManifestProblem[] } {
  const parsed = miniappManifestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })) };
  const problems = manifestProblems(parsed.data, scopes);
  return problems.length ? { ok: false, problems } : { ok: true, manifest: parsed.data };
}

/** Lecture tolérante d'un manifeste stocké (null si absent ou invalide). */
export const readManifest = (raw: unknown): MiniAppManifest | null => {
  const p = miniappManifestSchema.safeParse(raw);
  return p.success ? p.data : null;
};

/** Le passage de `prev` à `next` exige-t-il un nouveau consentement : donnée ajoutée ou finalité changée, coût ou lieu des données changé. */
export function manifestNeedsReconsent(prev: MiniAppManifest | null, next: MiniAppManifest): boolean {
  if (!prev) return false;
  for (const d of next.dataAccessed) {
    const before = prev.dataAccessed.find((x) => x.scope === d.scope);
    if (!before || before.purpose !== d.purpose) return true;
  }
  const a = prev.costs;
  const b = next.costs;
  return a.model !== b.model || a.maxAmountMinor !== b.maxAmountMinor || a.currency !== b.currency || prev.dataLocation !== next.dataLocation;
}

/* ------------------------------------------------------------------ certification */

export const miniappCertificationSchema = z.enum(['unreviewed', 'reviewed', 'certified']);
export type MiniAppCertification = z.infer<typeof miniappCertificationSchema>;
export const certifyMiniAppRequestSchema = z.object({ note: z.string().trim().min(3).max(500) });
export type CertifyMiniAppRequest = z.infer<typeof certifyMiniAppRequestSchema>;
export const setRevenueShareRequestSchema = z.object({ revenueShareBps: z.number().int().min(0).max(3000) });
export type SetRevenueShareRequest = z.infer<typeof setRevenueShareRequestSchema>;

/* ------------------------------------------------------------------ webhook d'application */

export const createMiniAppWebhookRequestSchema = z.object({
  url: httpsUrlSchema.refine((v) => v.length <= 500, 'at most 500 characters'),
  /** Absent : tous les événements déclarés dans le manifeste. */
  events: z.array(miniappEventSchema).min(1).max(MINIAPP_EVENTS.length).optional(),
});
export type CreateMiniAppWebhookRequest = z.infer<typeof createMiniAppWebhookRequestSchema>;

export const miniappWebhookSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  events: z.array(miniappEventSchema),
  active: z.boolean(),
  failureCount: z.number().int(),
  lastStatus: z.number().int().nullable(),
  lastDeliveryAt: z.iso.datetime().nullable(),
  disabledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type MiniAppWebhook = z.infer<typeof miniappWebhookSchema>;
/** Le secret n'est renvoyé qu'à la création et à la rotation. */
export const miniappWebhookWithSecretSchema = miniappWebhookSchema.extend({ secret: z.string() });
export type MiniAppWebhookWithSecret = z.infer<typeof miniappWebhookWithSecretSchema>;
export const miniappWebhookDeliverySchema = webhookDeliverySchema;
export const miniappWebhookDeliveryListSchema = webhookDeliveryListSchema;

/** Enveloppe signée envoyée à l'application. `data.sub` est l'identifiant de l'utilisateur propre à CASELIND x cette application. */
export const miniappWebhookEnvelopeSchema = z.object({
  id: z.string(),
  event: miniappEventSchema.or(z.literal('ping')),
  createdAt: z.iso.datetime(),
  appId: z.string(),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])),
});
export type MiniAppWebhookEnvelope = z.infer<typeof miniappWebhookEnvelopeSchema>;

/* ------------------------------------------------------------------ notifications envoyées par une application */

export const MINIAPP_NOTIFY_PER_DAY = 5;

export const miniappNotifyRequestSchema = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(200),
  /** Lien vers l'application (https, même hôte que l'URL de lancement). */
  deepLink: httpsUrlSchema.optional(),
});
export type MiniAppNotifyRequest = z.infer<typeof miniappNotifyRequestSchema>;

export const miniappNotifyResponseSchema = z.object({ delivered: z.boolean(), remainingToday: z.number().int() });
export type MiniAppNotifyResponse = z.infer<typeof miniappNotifyResponseSchema>;

export const setMiniAppMuteRequestSchema = z.object({ muted: z.boolean() });
export type SetMiniAppMuteRequest = z.infer<typeof setMiniAppMuteRequestSchema>;

const LINK_RE = /(?:[a-z][a-z0-9+.-]*:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|app|dev|co|cd|me|info|biz|xyz|link|site|online|shop|fr|be|uk|us|ly)\b[^\s]*)/gi;

/** Hôtes (minuscules) des liens que contient un texte. */
export function linkHostsIn(text: string): string[] {
  const hosts: string[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const raw = m[0];
    try {
      hosts.push(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase());
    } catch {
      hosts.push(raw.toLowerCase());
    }
  }
  return hosts;
}

/** Liens du texte dont l'hôte n'est pas dans la liste autorisée (hôtes du manifeste et de l'application). */
export const undeclaredLinks = (text: string, allowedHosts: readonly string[]): string[] =>
  linkHostsIn(text).filter((h) => !allowedHosts.some((a) => h === a.toLowerCase()));

/* ------------------------------------------------------------------ revenus (relevés indicatifs) */

export const REVENUE_DISCLAIMER = 'Relevé indicatif : aucun versement réel (le paiement en ligne est assuré par un tiers).';

export const miniappRevenueStatementSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}-01$/),
  currency: z.string(),
  grossMinor: z.number().int(),
  platformMinor: z.number().int(),
  developerMinor: z.number().int(),
  shareBps: z.number().int(),
  paymentsCount: z.number().int(),
  status: z.enum(['open', 'closed']),
});
export type MiniAppRevenueStatement = z.infer<typeof miniappRevenueStatementSchema>;
export const miniappRevenueSchema = z.object({ disclaimer: z.string(), revenueShareBps: z.number().int(), items: z.array(miniappRevenueStatementSchema) });
export type MiniAppRevenue = z.infer<typeof miniappRevenueSchema>;

/** Répartition exacte (entiers, arrondi à la demi-unité supérieure) : plateforme = bps x brut / 10000, développeur = reste. */
export function splitRevenue(grossMinor: number, bps: number): { platformMinor: number; developerMinor: number } {
  const platform = Number((BigInt(grossMinor) * BigInt(bps) + 5000n) / 10000n);
  return { platformMinor: platform, developerMinor: grossMinor - platform };
}

/* ------------------------------------------------------------------ mise à jour d'un manifeste de brouillon */

export const setManifestRequestSchema = z.object({ manifest: miniappManifestSchema });
export type SetManifestRequest = z.infer<typeof setManifestRequestSchema>;
