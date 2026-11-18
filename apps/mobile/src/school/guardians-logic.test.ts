import { describe, expect, it } from 'vitest';
import { canLink, feeSummary, normalizeHandle, uniqueStudents } from './guardians-logic';

describe('lien parent-élève', () => {
  it('nettoie l’identifiant du parent', () => {
    expect(normalizeHandle(' @maman_k ')).toBe('maman_k');
    expect(normalizeHandle('papa')).toBe('papa');
    expect(normalizeHandle('@')).toBe('');
    expect(normalizeHandle('deux mots')).toBe('');
    expect(normalizeHandle('x'.repeat(41))).toBe('');
  });

  it('liste les élèves une seule fois, sans parents ni enseignants', () => {
    const a = { handle: 'zoe', displayName: 'Zoé', role: 'student' as const };
    const b = { handle: 'ana', displayName: 'Ana', role: 'student' as const };
    const t = { handle: 'prof', displayName: 'Prof', role: 'teacher' as const };
    expect(uniqueStudents([[a, t], [b, a]]).map((m) => m.handle)).toEqual(['ana', 'zoe']);
    expect(uniqueStudents([])).toEqual([]);
  });

  it('exige un élève choisi et un parent valide', () => {
    expect(canLink(null, 'maman')).toBe(false);
    expect(canLink('zoe', '  ')).toBe(false);
    expect(canLink('zoe', '@maman')).toBe(true);
  });

  it('compte les frais réglés et à payer', () => {
    expect(feeSummary([{ paid: true }, { paid: false }, { paid: false }])).toEqual({ paid: 1, unpaid: 2 });
    expect(feeSummary([])).toEqual({ paid: 0, unpaid: 0 });
  });
});
