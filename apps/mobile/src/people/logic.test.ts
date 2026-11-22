import { describe, expect, it } from 'vitest';
import { buildSections, dedupe, manualPerson, normalizePhone, phonesToMatch, type Person } from './logic';

const p = (handle: string, displayName = handle): Person => ({ id: handle, handle, displayName });

describe('normalizePhone', () => {
  it('normalise les formats courants', () => {
    expect(normalizePhone('+243 81 234 5678')).toBe('+243812345678');
    expect(normalizePhone('0812345678')).toBe('+243812345678');
    expect(normalizePhone('00243812345678')).toBe('+243812345678');
    expect(normalizePhone('243812345678')).toBe('+243812345678');
    expect(normalizePhone('(081) 234-5678', 'CD')).toBe('+243812345678');
    expect(normalizePhone('0712345678', 'RW')).toBe('+250712345678');
  });
  it('refuse les numéros inexploitables', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('*100#')).toBeNull();
  });
  it('dédoublonne et plafonne', () => {
    expect(phonesToMatch(['0812345678', '+243812345678', 'x'])).toEqual(['+243812345678']);
    expect(phonesToMatch(['0812345678', '0812345679', '0812345670'], 'CD', 2)).toHaveLength(2);
  });
});

describe('buildSections', () => {
  const src = { recent: [p('ana')], phone: [p('ana'), p('ben', 'Bénédicte')], following: [p('ben'), p('cy')], followers: [p('cy'), p('dan')], search: [p('dan'), p('eve')] };
  it('chaque personne une seule fois, dans la première section', () => {
    const s = buildSections(src, '');
    expect(s.recent.map((x) => x.handle)).toEqual(['ana']);
    expect(s.phone.map((x) => x.handle)).toEqual(['ben']);
    expect(s.following.map((x) => x.handle)).toEqual(['cy']);
    expect(s.followers.map((x) => x.handle)).toEqual(['dan']);
    expect(s.search.map((x) => x.handle)).toEqual(['eve']);
  });
  it('filtre sans accent ni casse et retire soi-même', () => {
    const s = buildSections(src, 'BENED', 'ana');
    expect(s.phone.map((x) => x.handle)).toEqual(['ben']);
    expect(s.recent).toEqual([]);
    expect(s.following).toEqual([]);
  });
  it('dedupe ignore la casse des pseudos', () => {
    expect(dedupe([p('Ana'), p('ana'), p('bob')])).toHaveLength(2);
  });
});

describe('manualPerson', () => {
  it('accepte un pseudo valide, avec ou sans @', () => {
    expect(manualPerson('@Gina')?.handle).toBe('gina');
    expect(manualPerson('ab')).toBeNull();
    expect(manualPerson('a b c')).toBeNull();
  });
});
