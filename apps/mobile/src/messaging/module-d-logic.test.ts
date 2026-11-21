import { describe, expect, it } from 'vitest';
import type { Call } from '@caselind/contracts';
import { addRecent, callHistory, callRow, groupTiles, locationBody, parseLocation, parseRecents, RECENTS_MAX } from './module-d-logic';

const call = (o: Partial<Call>): Call => ({
  id: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222', callerId: 'me', calleeId: 'peer', kind: 'audio',
  status: 'ended', createdAt: '2026-11-21T10:00:00.000Z', answeredAt: '2026-11-21T10:00:05.000Z', endedAt: '2026-11-21T10:01:35.000Z', ...o,
});

describe('historique des appels', () => {
  it('direction, durée et issue', () => {
    expect(callRow(call({}), 'me')).toMatchObject({ direction: 'out', outcome: 'done', seconds: 90 });
    expect(callRow(call({}), 'peer')?.direction).toBe('in');
    expect(callRow(call({ status: 'missed', answeredAt: null, endedAt: null }), 'peer')).toMatchObject({ outcome: 'missed', seconds: 0 });
  });
  it('ignore les appels en cours et trie du plus récent', () => {
    expect(callRow(call({ status: 'ringing' }), 'me')).toBeNull();
    const rows = callHistory([call({ id: 'a', createdAt: '2026-11-20T10:00:00.000Z' }), call({ id: 'b' }), call({ id: 'c', status: 'active' })], 'me');
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('position partagée', () => {
  it('aller-retour et refus des corps ordinaires ou hors bornes', () => {
    const p = parseLocation(locationBody(-4.32758, 15.31357));
    expect(p).toMatchObject({ lat: -4.32758, lon: 15.31357 });
    expect(p?.url.startsWith('https://www.openstreetmap.org/')).toBe(true);
    expect(parseLocation('Rendez-vous ici https://www.openstreetmap.org/?mlat=1&mlon=2')).toBeNull();
    expect(parseLocation('📍 https://www.openstreetmap.org/?mlat=95&mlon=2')).toBeNull();
    expect(parseLocation(null)).toBeNull();
  });
});

describe('mini-apps récentes', () => {
  it('place en tête, sans doublon, plafonnée', () => {
    expect(addRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(addRecent(Array.from({ length: 12 }, (_, i) => `x${i}`), 'new')).toHaveLength(RECENTS_MAX);
    expect(parseRecents('pas du json')).toEqual([]);
    expect(parseRecents('["a",1,"b"]')).toEqual(['a', 'b']);
  });
});

describe('administration regroupée', () => {
  it('range les rubriques par section et garde l\'ordre', () => {
    const g = groupTiles([{ id: 'audit' }, { id: 'kyc' }, { id: 'ledger' }, { id: 'help' }]);
    expect(g.map((x) => x.section)).toEqual(['people', 'money', 'platform']);
    expect(g[0]!.tiles.map((t) => t.id)).toEqual(['kyc', 'help']);
  });
});
