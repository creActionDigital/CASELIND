import { describe, expect, it } from 'vitest';
import { canRequestDeletion, exportJson, humanizeKey, isDeletionWord, sectionLabel, summarizeExport } from './logic';

describe('confirmation de suppression', () => {
  it('accepte SUPPRIMER ou DELETE, quelle que soit la casse, et exige un mot de passe', () => {
    expect(isDeletionWord(' supprimer ')).toBe(true);
    expect(isDeletionWord('Delete')).toBe(true);
    expect(isDeletionWord('supprim')).toBe(false);
    expect(isDeletionWord('')).toBe(false);
    expect(canRequestDeletion('SUPPRIMER', 'secret')).toBe(true);
    expect(canRequestDeletion('SUPPRIMER', '')).toBe(false);
    expect(canRequestDeletion('non', 'secret')).toBe(false);
  });
});

describe('résumé de l’export', () => {
  const data = { exportedAt: '2026-11-19T10:00:00Z', profile: { id: 'x' }, orders: [1, 2, 3], posts: [], orderReturns: [1], consentJournal: [1, 2], twoFactorEnabled: false };
  it('ne compte que les listes non vides, triées par libellé', () => {
    const s = summarizeExport(data, 'fr');
    expect(s.rows.map((r) => r.key)).toEqual(['orders', 'orderReturns', 'consentJournal'].sort((a, b) => sectionLabel(a, 'fr').localeCompare(sectionLabel(b, 'fr'), 'fr')));
    expect(s.rows.find((r) => r.key === 'orders')?.count).toBe(3);
    expect(s.total).toBe(6);
  });
  it('libellés traduits, repli lisible pour une clé inconnue', () => {
    expect(sectionLabel('orders', 'fr')).toBe('Commandes');
    expect(sectionLabel('orders', 'en')).toBe('Orders');
    expect(sectionLabel('orders', 'sw')).toBe('Orders');
    expect(humanizeKey('someNewSection')).toBe('Some new section');
    expect(sectionLabel('someNewSection', 'fr')).toBe('Some new section');
  });
  it('donne le JSON complet', () => {
    expect(JSON.parse(exportJson(data))).toEqual(data);
  });
});
