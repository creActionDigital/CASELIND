import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type PlatformRole = 'user' | 'moderator' | 'support' | 'admin';
type Icon = ComponentProps<typeof Ionicons>['name'];

export type AdminTile = {
  id: string;
  route: string;
  icon: Icon;
  /** Rôles plateforme servis par l'API (@Roles) ; la référence reste le serveur (403 -> « accès refusé »). */
  roles: readonly PlatformRole[];
  /** Compteur d'éléments en attente, si une route de liste le permet. */
  count?: 'moderation' | 'kyc' | 'miniapps';
};

const A = ['admin'] as const;
const AM = ['admin', 'moderator'] as const;

/** Rubriques de l'administration, dans l'ordre d'affichage. `id` sert aux libellés `adm.tile.<id>`. */
export const ADMIN_TILES: readonly AdminTile[] = [
  { id: 'moderation', route: '/admin/moderation', icon: 'flag-outline', roles: AM, count: 'moderation' },
  { id: 'sanctions', route: '/admin/sanctions', icon: 'ban-outline', roles: AM },
  { id: 'appeals', route: '/admin/appeals', icon: 'chatbubbles-outline', roles: AM },
  { id: 'disputes', route: '/admin/disputes', icon: 'git-compare-outline', roles: A },
  { id: 'approvals', route: '/admin/approvals', icon: 'people-circle-outline', roles: A },
  { id: 'analytics', route: '/admin/analytics', icon: 'stats-chart-outline', roles: A },
  { id: 'governance', route: '/admin/governance', icon: 'shield-checkmark-outline', roles: A },
  { id: 'help', route: '/admin/help', icon: 'help-buoy-outline', roles: A },
  { id: 'kyc', route: '/admin/kyc', icon: 'id-card-outline', roles: A, count: 'kyc' },
  { id: 'miniapps', route: '/admin/miniapps', icon: 'apps-outline', roles: AM, count: 'miniapps' },
  { id: 'flags', route: '/admin/flags', icon: 'toggle-outline', roles: A },
  { id: 'audit', route: '/admin/audit', icon: 'document-text-outline', roles: A },
  { id: 'ledger', route: '/admin/ledger', icon: 'calculator-outline', roles: A },
  { id: 'health', route: '/admin/health', icon: 'medkit-outline', roles: A },
  { id: 'mobility', route: '/admin/mobility', icon: 'car-sport-outline', roles: A },
  { id: 'freelance', route: '/freelance/disputes', icon: 'hammer-outline', roles: A },
  { id: 'games', route: '/admin/games', icon: 'game-controller-outline', roles: A },
  { id: 'ai', route: '/admin/ai', icon: 'sparkles-outline', roles: A },
  { id: 'announcements', route: '/admin/announcements', icon: 'megaphone-outline', roles: A },
  { id: 'settings', route: '/admin/settings', icon: 'options-outline', roles: A },
  { id: 'commissions', route: '/admin/commissions', icon: 'cash-outline', roles: A },
  { id: 'walletAlerts', route: '/admin/wallet-alerts', icon: 'warning-outline', roles: A },
  { id: 'boosts', route: '/admin/boosts', icon: 'rocket-outline', roles: AM },
  { id: 'ads', route: '/admin/ads', icon: 'megaphone-outline', roles: AM },
  { id: 'subscriptions', route: '/admin/subscriptions', icon: 'ribbon-outline', roles: A },
];

export function visibleTiles(roles: readonly string[] | undefined | null): AdminTile[] {
  const mine = roles ?? [];
  return ADMIN_TILES.filter((t) => t.roles.some((r) => mine.includes(r)));
}

/** Le menu Plus n'affiche « Administration » que si au moins une rubrique est accessible (le rôle « support » seul n'en a aucune). */
export const hasAdminAccess = (roles: readonly string[] | undefined | null): boolean => visibleTiles(roles).length > 0;

/** Compteur d'une page de liste : « 100+ » quand il reste des pages. */
export function countLabel(n: number, hasMore: boolean): string {
  return hasMore ? `${n}+` : String(n);
}

// --- Drapeaux de fonctionnalité ---

export const CONFIRM_WORD = 'ACTIVER';

/** Saisie exacte du mot (espaces autour tolérés, casse respectée). */
export const isConfirmWord = (input: string): boolean => input.trim() === CONFIRM_WORD;

/** Confirmation renforcée : activer un module réglementé, ou changer sa portée alors qu'il reste actif. */
export function needsStrongConfirm(flag: { regulated: boolean }, nextEnabled: boolean): boolean {
  return flag.regulated && nextEnabled;
}

export const COUNTRY_RE = /^[A-Z]{2}$/;

/** « cd, ke » -> ['CD','KE'] ; null (tous les pays) si vide ; undefined si un code est invalide. */
export function parseCountries(input: string): string[] | null | undefined {
  const parts = input.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.some((p) => !COUNTRY_RE.test(p))) return undefined;
  return [...new Set(parts)];
}

export const FLAG_ROLES = ['user', 'moderator', 'support', 'admin'] as const;

// --- Modération ---

export const MOD_STATUSES = ['open', 'resolved'] as const;
export const MOD_TYPES = ['user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job', 'mission', 'course', 'course_review', 'scholarship', 'org_update', 'org_review', 'org_question'] as const;
export type ModAction = 'hide' | 'restore' | 'dismiss';

/** Paramètres de GET /admin/moderation/reports (`type` vide = tous). */
export function moderationQuery(status: 'open' | 'resolved', type: string): Record<string, string> {
  const q: Record<string, string> = { status, limit: '20' };
  if (type) q.targetType = type;
  return q;
}

/** Un signalement en cours se masque ou se rejette ; un traité se restaure (ou se masque après coup). */
export const moderationActions = (status: 'open' | 'resolved'): ModAction[] => (status === 'open' ? ['hide', 'dismiss'] : ['restore', 'hide']);

// --- Décisions avec motif (KYC, mini-apps, chauffeurs, professionnels) ---

export type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate';

/** Le refus et la suspension exigent un motif (API : KYC reject, mini-app reject, chauffeur reject/suspend). */
export const decisionNeedsReason = (d: Decision): boolean => d === 'reject' || d === 'suspend';

export const kycDecisions = (status: string): Decision[] => (status === 'pending' ? ['approve', 'reject'] : []);

export function miniappDecisions(status: string): Decision[] {
  if (status === 'in_review') return ['approve', 'reject'];
  if (status === 'published') return ['suspend'];
  if (status === 'suspended') return ['reinstate'];
  return [];
}

export function accountDecisions(status: string): Decision[] {
  if (status === 'pending') return ['approve', 'reject'];
  if (status === 'approved') return ['suspend'];
  if (status === 'rejected' || status === 'suspended') return ['approve'];
  return [];
}

export const decisionReady = (d: Decision, reason: string): boolean => !decisionNeedsReason(d) || (reason.trim().length >= 3 && reason.trim().length <= 500);

// --- Journal d'audit ---

export type AuditRow = { id: string; action: string; when: string; actor: string | null; subject: string | null; requestId: string | null };

export const shortId = (id: string | null | undefined): string | null => (id ? id.slice(0, 8) : null);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ne conserve que l'action, la date et des identifiants abrégés. L'adresse IP, l'agent utilisateur,
 * la session et `metadata` (contenu libre) ne sont jamais affichés.
 */
export function auditRow(e: { id: string; action: string; occurredAt: string; actorUserId?: string | null; subjectUserId?: string | null; requestId?: string | null }): AuditRow {
  return { id: e.id, action: e.action, when: e.occurredAt, actor: shortId(e.actorUserId), subject: shortId(e.subjectUserId), requestId: e.requestId ?? null };
}

/** Paramètres du journal : action exacte et compte concerné (UUID) ; une valeur invalide est ignorée. */
export function auditQuery(action: string, subject: string): Record<string, string> {
  const q: Record<string, string> = { limit: '50' };
  if (action.trim()) q.action = action.trim().slice(0, 100);
  if (UUID_RE.test(subject.trim())) q.subjectUserId = subject.trim();
  return q;
}
