import { describe, expect, it } from 'vitest';
import {
  ADMIN_TILES,
  CONFIRM_WORD,
  accountDecisions,
  auditQuery,
  auditRow,
  countLabel,
  decisionReady,
  hasAdminAccess,
  isConfirmWord,
  kycDecisions,
  miniappDecisions,
  moderationActions,
  moderationQuery,
  needsStrongConfirm,
  parseCountries,
  visibleTiles,
} from './console-logic';

const ids = (roles: string[]) => visibleTiles(roles).map((t) => t.id);

describe('tuiles par rôle', () => {
  it('administrateur : toutes les rubriques, y compris les écrans des autres lots', () => {
    expect(ids(['user', 'admin'])).toHaveLength(ADMIN_TILES.length);
    for (const route of ['/admin/analytics', '/admin/approvals', '/admin/disputes', '/admin/governance', '/freelance/disputes']) {
      expect(visibleTiles(['admin']).some((t) => t.route === route)).toBe(true);
    }
  });
  it('modérateur : modération, sanctions, recours, mini-apps, boosts et publicités seulement', () => {
    expect(ids(['user', 'moderator'])).toEqual(['moderation', 'sanctions', 'appeals', 'miniapps', 'boosts', 'ads']);
  });
  it('administrateur : paramètres, commissions, annonces et alertes du portefeuille lui sont réservés', () => {
    for (const route of ['/admin/settings', '/admin/commissions', '/admin/announcements', '/admin/wallet-alerts', '/admin/sanctions', '/admin/appeals', '/admin/boosts']) {
      expect(visibleTiles(['admin']).some((t) => t.route === route)).toBe(true);
    }
    for (const id of ['settings', 'commissions', 'announcements', 'walletAlerts']) expect(ids(['user', 'moderator'])).not.toContain(id);
  });
  it('support, utilisateur ou rien : aucun accès', () => {
    expect(hasAdminAccess(['support'])).toBe(false);
    expect(hasAdminAccess(['user'])).toBe(false);
    expect(hasAdminAccess(undefined)).toBe(false);
    expect(hasAdminAccess(['moderator'])).toBe(true);
  });
  it('identifiants de tuile uniques', () => {
    expect(new Set(ADMIN_TILES.map((t) => t.id)).size).toBe(ADMIN_TILES.length);
  });
});

describe('compteurs', () => {
  it('suffixe + quand il reste des pages', () => {
    expect(countLabel(100, true)).toBe('100+');
    expect(countLabel(7, false)).toBe('7');
  });
});

describe('modération', () => {
  it('filtres : le type vide est ignoré', () => {
    expect(moderationQuery('open', '')).toEqual({ status: 'open', limit: '20' });
    expect(moderationQuery('resolved', 'post')).toEqual({ status: 'resolved', limit: '20', targetType: 'post' });
  });
  it('actions selon le statut', () => {
    expect(moderationActions('open')).toEqual(['hide', 'dismiss']);
    expect(moderationActions('resolved')).toEqual(['restore', 'hide']);
  });
});

describe('confirmation renforcée des drapeaux', () => {
  it('exige le mot exact, casse comprise', () => {
    expect(isConfirmWord(CONFIRM_WORD)).toBe(true);
    expect(isConfirmWord('  ACTIVER ')).toBe(true);
    expect(isConfirmWord('activer')).toBe(false);
    expect(isConfirmWord('')).toBe(false);
  });
  it('seulement pour activer un module réglementé', () => {
    expect(needsStrongConfirm({ regulated: true }, true)).toBe(true);
    expect(needsStrongConfirm({ regulated: true }, false)).toBe(false);
    expect(needsStrongConfirm({ regulated: false }, true)).toBe(false);
  });
  it('pays : normalise, déduplique, refuse les codes invalides', () => {
    expect(parseCountries('cd, ke;cd')).toEqual(['CD', 'KE']);
    expect(parseCountries('  ')).toBeNull();
    expect(parseCountries('COD')).toBeUndefined();
    expect(parseCountries('c1')).toBeUndefined();
  });
});

describe('décisions', () => {
  it('KYC : seulement en attente', () => {
    expect(kycDecisions('pending')).toEqual(['approve', 'reject']);
    expect(kycDecisions('approved')).toEqual([]);
  });
  it('mini-apps : transitions de l\'API', () => {
    expect(miniappDecisions('in_review')).toEqual(['approve', 'reject']);
    expect(miniappDecisions('published')).toEqual(['suspend']);
    expect(miniappDecisions('suspended')).toEqual(['reinstate']);
    expect(miniappDecisions('draft')).toEqual([]);
  });
  it('chauffeurs et professionnels', () => {
    expect(accountDecisions('pending')).toEqual(['approve', 'reject']);
    expect(accountDecisions('approved')).toEqual(['suspend']);
    expect(accountDecisions('suspended')).toEqual(['approve']);
  });
  it('motif exigé pour refuser ou suspendre, 3 à 500 caractères', () => {
    expect(decisionReady('approve', '')).toBe(true);
    expect(decisionReady('reject', '  ab ')).toBe(false);
    expect(decisionReady('reject', 'abc')).toBe(true);
    expect(decisionReady('suspend', 'x'.repeat(501))).toBe(false);
  });
});

describe('journal d\'audit', () => {
  const raw = { id: '12', action: 'moderation.action', occurredAt: '2026-11-19T10:00:00.000Z', actorUserId: '8b7d6c5e-1111-4222-8333-944455556666', subjectUserId: null, requestId: 'req-1', ip: '10.0.0.1', userAgent: 'UA', metadata: { note: 'secret' } };
  it('ne garde ni IP, ni agent, ni metadata ; abrège les identifiants', () => {
    const row = auditRow(raw);
    expect(row).toEqual({ id: '12', action: 'moderation.action', when: raw.occurredAt, actor: '8b7d6c5e', subject: null, requestId: 'req-1' });
    expect(JSON.stringify(row)).not.toMatch(/10\.0\.0\.1|UA|secret|metadata/);
  });
  it('filtres : action exacte, compte valide seulement', () => {
    expect(auditQuery(' kyc.decided ', 'pas-un-uuid')).toEqual({ limit: '50', action: 'kyc.decided' });
    const id = '8b7d6c5e-1111-4222-8333-944455556666';
    expect(auditQuery('', id)).toEqual({ limit: '50', subjectUserId: id });
  });
});
