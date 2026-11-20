import type { ConversationMember, NaturalFilters } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../lib/api';
import {
  actionErrorKey,
  applyMention,
  consentNeeded,
  filterChips,
  isPending,
  mentionIds,
  mentionQuery,
  removeFilter,
  resultLines,
  splitMentions,
  suggestMembers,
  translationTarget,
} from './assist-logic';

const member = (userId: string, handle: string, displayName: string): ConversationMember => ({ userId, handle, displayName, avatarUrl: null, role: 'member', joinedAt: '2026-01-01T00:00:00.000Z', lastReadSeq: null });
const MEMBERS = [member('a', 'amani', 'Amani K'), member('b', 'zawadi.m', 'Zawadi'), member('me', 'moi', 'Moi')];

describe('mentions', () => {
  it('detects the handle being typed at the end of the text', () => {
    expect(mentionQuery('salut @za')).toEqual({ start: 6, query: 'za' });
    expect(mentionQuery('@')).toEqual({ start: 0, query: '' });
    expect(mentionQuery('mail@za')).toBeNull();
    expect(mentionQuery('salut @za bien')).toBeNull();
  });
  it('suggests members by handle or name prefix, never oneself', () => {
    expect(suggestMembers(MEMBERS, 'z', 'me').map((m) => m.userId)).toEqual(['b']);
    expect(suggestMembers(MEMBERS, '', 'me').map((m) => m.userId)).toEqual(['a', 'b']);
    expect(suggestMembers(MEMBERS, 'mo', 'me')).toEqual([]);
  });
  it('completes the mention and finds the ids to send', () => {
    const mq = mentionQuery('salut @za')!;
    expect(applyMention('salut @za', mq, 'zawadi.m')).toBe('salut @zawadi.m ');
    expect(mentionIds('salut @zawadi.m et @AMANI, @moi', MEMBERS, 'me')).toEqual(['a', 'b']);
    expect(mentionIds('salut @zawadi.mx', MEMBERS, 'me')).toEqual([]);
    expect(mentionIds('x@amani', MEMBERS, 'me')).toEqual([]);
  });
  it('bolds only the handles of mentioned members', () => {
    expect(splitMentions('salut @amani, ça va ? @inconnu', ['amani'])).toEqual([
      { text: 'salut ', bold: false },
      { text: '@amani', bold: true },
      { text: ', ça va ? @inconnu', bold: false },
    ]);
    expect(splitMentions('rien', [])).toEqual([{ text: 'rien', bold: false }]);
    expect(splitMentions('@zawadi.m', ['zawadi.m'])).toEqual([{ text: '@zawadi.m', bold: true }]);
  });
});

describe('errors and states', () => {
  const err = (code: string, details?: unknown) => new ApiRequestError(409, code, 'x', details);
  it('reads the consent a 409 asks for', () => {
    expect(consentNeeded(err('consent_required', { kind: 'translation' }))).toBe('translation');
    expect(consentNeeded(err('consent_required', { kind: 'ai_processing' }))).toBe('ai_processing');
    expect(consentNeeded(err('consent_required', { kind: 'health' }))).toBeNull();
    expect(consentNeeded(err('conflict'))).toBeNull();
    expect(consentNeeded(new Error('x'))).toBeNull();
  });
  it('maps action errors', () => {
    expect(actionErrorKey(err('conflict', { reason: 'action_expired' }))).toBe('aiact.err.expired');
    expect(actionErrorKey(err('conflict', { reason: 'action_not_pending' }))).toBe('aiact.err.decided');
    expect(actionErrorKey(err('feature_disabled', { reason: 'ai_actions_disabled' }))).toBe('aiact.err.off');
    expect(actionErrorKey(err('conflict'))).toBeNull();
  });
  it('knows when a card can still be used', () => {
    const now = Date.parse('2026-01-01T10:00:00Z');
    expect(isPending({ status: 'proposed', expiresAt: '2026-01-01T10:05:00Z' }, now)).toBe(true);
    expect(isPending({ status: 'proposed', expiresAt: '2026-01-01T09:59:00Z' }, now)).toBe(false);
    expect(isPending({ status: 'confirmed', expiresAt: '2026-01-01T10:05:00Z' }, now)).toBe(false);
  });
  it('picks the target language', () => {
    expect(translationTarget('sw')).toBe('sw');
    expect(translationTarget('en')).toBe('en');
    expect(translationTarget('fr')).toBe('fr');
    expect(translationTarget('de')).toBe('fr');
  });
  it('describes results line by line', () => {
    expect(resultLines({ kind: 'products', items: [{ id: 'x', title: 'Sandales', minPriceMinor: 1500, currency: 'USD', orgName: 'Chez Amani' }] })).toEqual(['Sandales · 15.00 USD · Chez Amani']);
    expect(resultLines({ kind: 'places', items: [{ id: 'x', slug: 's', name: 'Pharmacie', city: 'Goma', distanceKm: 1.234 }] })).toEqual(['Pharmacie · Goma · 1.2 km']);
    expect(resultLines({ kind: 'open_screen', path: '/cart' })).toEqual([]);
  });
});

describe('natural search chips', () => {
  const base: NaturalFilters = { keywords: 'sandales', categorySlug: null, minPriceMinor: null, maxPriceMinor: 2000, currency: 'USD', city: 'Goma', placeKind: null, cheapFirst: true, nearMe: false };
  it('lists one chip per set filter', () => {
    expect(filterChips(base)).toEqual([
      { key: 'keywords', label: 'sandales' },
      { key: 'price', label: '≤ 20 USD' },
      { key: 'city', label: 'Goma' },
      { key: 'cheapFirst', label: '' },
    ]);
  });
  it('removes a filter, the price as a whole', () => {
    expect(removeFilter(base, 'price')).toMatchObject({ minPriceMinor: null, maxPriceMinor: null, currency: null, city: 'Goma' });
    expect(removeFilter(base, 'cheapFirst').cheapFirst).toBe(false);
    expect(filterChips(removeFilter(removeFilter(base, 'keywords'), 'city')).map((c) => c.key)).toEqual(['price', 'cheapFirst']);
  });
});
