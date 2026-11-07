import type { SearchResult } from '@caselind/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RADII_KM, directionsUrl, formatDistance, parseCoordinate } from '../places/geo';
import { createLatestQueue, debounce, effectiveQuery, groupResults } from './logic';

describe('effectiveQuery', () => {
  it('exige 2 caractères après rognage', () => {
    expect(effectiveQuery(' a ')).toBeNull();
    expect(effectiveQuery(' ab ')).toBe('ab');
  });
});

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("n'exécute que le dernier appel d'une rafale, 300 ms après", () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d('a');
    vi.advanceTimersByTime(200);
    d('ab');
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('ab');
  });
  it('cancel annule', () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d();
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('createLatestQueue', () => {
  it('signale obsolète la réponse lente quand une requête plus récente existe', async () => {
    const q = createLatestQueue();
    let release!: (v: string) => void;
    const slow = q.run(() => new Promise<string>((r) => (release = r)));
    const fast = await q.run(async () => 'new');
    release('old');
    expect(fast).toEqual({ stale: false, value: 'new' });
    expect(await slow).toEqual({ stale: true });
  });
});

const id = '00000000-0000-4000-8000-000000000001';
describe('groupResults', () => {
  it('garde les catégories non vides dans l’ordre, avec « voir plus »', () => {
    const r: SearchResult = {
      scope: 'all',
      users: { items: [], nextCursor: null },
      orgs: { items: [{ id, slug: 's', name: 'N', kind: 'shop', logoUrl: null, city: null, verified: false }], nextCursor: 'c' },
      posts: {
        items: [{ id, authorId: id, authorHandle: 'h', authorDisplayName: 'H', snippet: 'x', createdAt: '2026-01-01T00:00:00.000Z' }],
        nextCursor: null,
      },
    };
    expect(groupResults(r)).toEqual([
      { category: 'orgs', count: 1, more: true },
      { category: 'posts', count: 1, more: false },
    ]);
    expect(groupResults(undefined)).toEqual([]);
  });
});

describe('formatDistance', () => {
  it('mètres sous 1 km, une décimale sous 10 km, entier au-delà', () => {
    expect(formatDistance(0.853, 'fr')).toBe('850 m');
    expect(formatDistance(1.24, 'fr')).toBe('1,2 km');
    expect(formatDistance(1.24, 'en')).toBe('1.2 km');
    expect(formatDistance(12.4, 'fr')).toBe('12 km');
    expect(formatDistance(0.9996, 'fr')).toBe('1 km');
    expect(formatDistance(0, 'fr')).toBe('10 m');
  });
  it('propose les rayons attendus', () => expect([...RADII_KM]).toEqual([1, 5, 10, 25]));
});

describe('directionsUrl', () => {
  const dest = { lat: -1.6585, lng: 29.2205, label: 'Chez Amani & Fils' };
  it('Android : geo:', () =>
    expect(directionsUrl('android', dest)).toBe('geo:-1.6585,29.2205?q=-1.6585,29.2205(Chez%20Amani%20%26%20Fils)'));
  it('iOS : maps:', () => expect(directionsUrl('ios', dest)).toBe('maps:?daddr=-1.6585,29.2205&q=Chez%20Amani%20%26%20Fils'));
  it('web : OpenStreetMap', () =>
    expect(directionsUrl('web', { lat: 1, lng: 2 })).toBe('https://www.openstreetmap.org/?mlat=1&mlon=2#map=17/1/2'));
});

describe('parseCoordinate', () => {
  it('accepte la virgule et refuse les valeurs hors plage', () => {
    expect(parseCoordinate('-1,6585', 'lat')).toBe(-1.6585);
    expect(parseCoordinate('91', 'lat')).toBeNull();
    expect(parseCoordinate('181', 'lng')).toBeNull();
    expect(parseCoordinate('abc', 'lng')).toBeNull();
  });
});
