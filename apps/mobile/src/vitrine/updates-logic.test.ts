import { describe, expect, it } from 'vitest';
import { buildUpdate, emptyForm, formatRange, parseDateTime, toInputText } from './updates-logic';

describe('dates des actualités', () => {
  it('lit AAAA-MM-JJ HH:MM et refuse les dates impossibles', () => {
    expect(parseDateTime('2026-11-20 18:30')?.getHours()).toBe(18);
    expect(parseDateTime(' 2026-11-20T08:05 ')?.getMinutes()).toBe(5);
    expect(parseDateTime('2026-02-31 10:00')).toBeNull();
    expect(parseDateTime('2026-11-20 25:00')).toBeNull();
    expect(parseDateTime('20/11/2026 10:00')).toBeNull();
    expect(parseDateTime('')).toBeNull();
  });

  it('refait la saisie à partir d’un instant ISO et formate les plages', () => {
    const iso = parseDateTime('2026-11-20 18:30')!.toISOString();
    expect(toInputText(iso)).toBe('2026-11-20 18:30');
    expect(toInputText(null)).toBe('');
    const end = parseDateTime('2026-11-20 20:00')!.toISOString();
    expect(formatRange({ startsAt: iso, endsAt: end })).toBe('20/11/2026 18:30 → 20:00');
    expect(formatRange({ startsAt: iso, endsAt: null })).toBe('20/11/2026 18:30');
    expect(formatRange({ startsAt: null, endsAt: null })).toBe('');
  });
});

describe('formulaire d’actualité', () => {
  const base = { ...emptyForm(), title: ' Soldes ', body: 'Tout doit partir' };
  it('accepte une publication sans date et nettoie les champs', () => {
    expect(buildUpdate(base)).toEqual({ ok: { kind: 'post', title: 'Soldes', body: 'Tout doit partir', startsAt: null, endsAt: null, place: null } });
  });
  it('refuse titre ou texte vides ou trop longs', () => {
    expect(buildUpdate({ ...base, title: ' ' })).toEqual({ error: 'title' });
    expect(buildUpdate({ ...base, title: 'x'.repeat(81) })).toEqual({ error: 'title' });
    expect(buildUpdate({ ...base, body: '' })).toEqual({ error: 'body' });
    expect(buildUpdate({ ...base, body: 'x'.repeat(1001) })).toEqual({ error: 'body' });
  });
  it('un événement exige un début, la fin vient après le début', () => {
    expect(buildUpdate({ ...base, kind: 'event' })).toEqual({ error: 'startsRequired' });
    expect(buildUpdate({ ...base, kind: 'event', startsAt: 'demain' })).toEqual({ error: 'startsAt' });
    expect(buildUpdate({ ...base, kind: 'event', startsAt: '2026-11-20 18:00', endsAt: '2026-11-20 17:00' })).toEqual({ error: 'endBeforeStart' });
    expect(buildUpdate({ ...base, kind: 'promo', endsAt: '2026-13-01 10:00' })).toEqual({ error: 'endsAt' });
    const ok = buildUpdate({ ...base, kind: 'event', startsAt: '2026-11-20 18:00', endsAt: '2026-11-20 20:00', place: ' Gombe ' });
    expect(ok).toMatchObject({ ok: { kind: 'event', place: 'Gombe' } });
  });
});
