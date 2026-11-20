import { describe, expect, it } from 'vitest';
import {
  announcementActions,
  announcementReady,
  audienceOf,
  bpsLabel,
  canAppeal,
  canDecide,
  canLift,
  dayToIso,
  kindsFor,
  parseDuration,
  parseSettingValue,
  sanctionReady,
  scopeOf,
  wholeBps,
} from './ops2-logic';

describe('sanctions', () => {
  it('types proposés selon le rôle', () => {
    expect(kindsFor(['user', 'admin'])).toEqual(['warning', 'mute_posting', 'suspension_temp', 'ban']);
    expect(kindsFor(['moderator'])).toEqual(['warning', 'mute_posting']);
    expect(kindsFor(['support'])).toEqual([]);
    expect(kindsFor(undefined)).toEqual([]);
  });
  it('durées par type', () => {
    expect(parseDuration('warning', '')).toBeUndefined();
    expect(parseDuration('ban', '5')).toBeUndefined();
    expect(parseDuration('mute_posting', '6')).toBeNull();
    expect(parseDuration('mute_posting', '7')).toBe(7);
    expect(parseDuration('mute_posting', '31')).toBeNull();
    expect(parseDuration('suspension_temp', '1')).toBe(1);
    expect(parseDuration('suspension_temp', '30')).toBe(30);
    expect(parseDuration('suspension_temp', '0')).toBeNull();
    expect(parseDuration('suspension_temp', 'abc')).toBeNull();
  });
  it('formulaire prêt : motif de 3 à 300 caractères et durée valide', () => {
    expect(sanctionReady('warning', 'abus', '')).toBe(true);
    expect(sanctionReady('warning', 'ab', '')).toBe(false);
    expect(sanctionReady('warning', 'x'.repeat(301), '')).toBe(false);
    expect(sanctionReady('suspension_temp', 'abus', '')).toBe(false);
    expect(sanctionReady('suspension_temp', 'abus', '3')).toBe(true);
  });
  it('lever, trancher et faire appel selon le rôle et l\'état', () => {
    expect(canLift({ status: 'active', kind: 'ban' }, ['admin'])).toBe(true);
    expect(canLift({ status: 'appealed', kind: 'ban' }, ['moderator'])).toBe(false);
    expect(canLift({ status: 'active', kind: 'mute_posting' }, ['moderator'])).toBe(true);
    expect(canLift({ status: 'lifted', kind: 'warning' }, ['admin'])).toBe(false);
    expect(canDecide({ status: 'pending', sanctionKind: 'ban' }, ['moderator'])).toBe(false);
    expect(canDecide({ status: 'pending', sanctionKind: 'warning' }, ['moderator'])).toBe(true);
    expect(canDecide({ status: 'accepted', sanctionKind: 'warning' }, ['admin'])).toBe(false);
    expect(canAppeal({ status: 'active', appeal: null })).toBe(true);
    expect(canAppeal({ status: 'appealed', appeal: { id: 'x' } })).toBe(false);
    expect(canAppeal({ status: 'expired', appeal: null })).toBe(false);
  });
});

describe('annonces', () => {
  it('actions par statut', () => {
    expect(announcementActions('draft')).toEqual(['publish', 'delete']);
    expect(announcementActions('published')).toEqual(['end']);
    expect(announcementActions('ended')).toEqual([]);
  });
  it('audience et dates', () => {
    expect(audienceOf('all', '')).toBe('all');
    expect(audienceOf('role', 'moderator')).toBe('role:moderator');
    expect(audienceOf('role', 'chef')).toBeNull();
    expect(audienceOf('country', 'cd')).toBe('country:CD');
    expect(audienceOf('country', 'congo')).toBeNull();
    expect(dayToIso('2026-12-01')).toBe('2026-12-01T00:00:00.000Z');
    expect(dayToIso('2026-02-30')).toBeNull();
    expect(dayToIso('01/12/2026')).toBeNull();
    expect(announcementReady('Titre', 'Texte', '2026-12-01')).toBe(true);
    expect(announcementReady('', 'Texte', '2026-12-01')).toBe(false);
    expect(announcementReady('T', 'x'.repeat(501), '2026-12-01')).toBe(false);
  });
});

describe('paramètres et commissions', () => {
  it('valeurs saisies par clé', () => {
    expect(parseSettingValue('commission.defaultBps', '250')).toBe(250);
    expect(parseSettingValue('commission.defaultBps', '2,5')).toBeUndefined();
    expect(parseSettingValue('currencies.enabled', 'usd, cdf, usd')).toEqual(['USD', 'CDF']);
    expect(parseSettingValue('currencies.enabled', 'EUR')).toBeUndefined();
    expect(parseSettingValue('cities.pilot', 'Kinshasa, Goma')).toEqual(['Kinshasa', 'Goma']);
    expect(parseSettingValue('support.contact', 'aide@caselind.test')).toEqual({ email: 'aide@caselind.test' });
    expect(parseSettingValue('support.contact', '{"phone":"+243810000000"}')).toEqual({ phone: '+243810000000' });
    expect(parseSettingValue('support.contact', 'n\'importe quoi')).toBeUndefined();
    expect(parseSettingValue('limits.maxOrderMinor', 'usd 5000000, CDF: 900000000')).toEqual({ USD: 5000000, CDF: 900000000 });
    expect(parseSettingValue('limits.maxOrderMinor', '5000000')).toBeUndefined();
    expect(parseSettingValue('limits.maxOrderMinor', 'USD 0')).toBeUndefined();
  });
  it('portée', () => {
    expect(scopeOf('')).toBe('global');
    expect(scopeOf('Global')).toBe('global');
    expect(scopeOf('cd')).toBe('country:CD');
    expect(scopeOf('cd:Goma')).toBe('city:CD:Goma');
    expect(scopeOf('Congo')).toBeNull();
  });
  it('taux en points de base', () => {
    expect(bpsLabel(250)).toBe('2,5 %');
    expect(bpsLabel(300)).toBe('3 %');
    expect(bpsLabel(125)).toBe('1,25 %');
    expect(bpsLabel(0)).toBe('0 %');
    expect(wholeBps('3000')).toBe(3000);
    expect(wholeBps('3001')).toBeNull();
    expect(wholeBps('-1')).toBeNull();
  });
});
