import { orgKindSchema } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { sectorCore, splitBySector } from './sector';

const all = ['/orders', '/products', '/stock', '/batches', '/rentals', '/qr', '/hr'].map((path) => ({ path }));

describe('secteur -> modules du tableau de bord pro', () => {
  it('chaque secteur du contrat a au moins un module essentiel', () => {
    for (const k of orgKindSchema.options) expect(sectorCore(k).length).toBeGreaterThan(0);
  });
  it('met en tête les modules du secteur dans son ordre et garde les autres', () => {
    const r = splitBySector('pharmacy', all);
    expect(r.core.map((s) => s.path)).toEqual(['/products', '/stock', '/batches']);
    expect(r.others.map((s) => s.path)).toEqual(['/orders', '/rentals', '/qr', '/hr']);
  });
  it('un hôtel voit les locations avant le reste, sans perdre aucun module', () => {
    const r = splitBySector('hotel', all);
    expect(r.core[0]!.path).toBe('/rentals');
    expect(r.core.length + r.others.length).toBe(all.length);
  });
});
