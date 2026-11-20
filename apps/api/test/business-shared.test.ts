import { describe, expect, it } from 'vitest';
import { csvCell, poNumber, toCsv, weightedAverageCost } from '../src/business/business.shared.js';

describe('weightedAverageCost', () => {
  it('prend le coût de l\'entrée quand le coût ou le stock est inconnu ou nul', () => {
    expect(weightedAverageCost(10, null, 5, 120)).toBe(120);
    expect(weightedAverageCost(0, 999, 5, 120)).toBe(120);
  });
  it('pondère par les quantités', () => {
    expect(weightedAverageCost(10, 100, 10, 200)).toBe(150);
    expect(weightedAverageCost(3, 100, 2, 151)).toBe(120); // 602 / 5 = 120,4
    expect(weightedAverageCost(4, 113, 1, 151)).toBe(121); // 603 / 5 = 120,6
  });
  it('arrondit la moitié vers le haut', () => {
    expect(weightedAverageCost(1, 1, 1, 2)).toBe(2); // 1,5
    expect(weightedAverageCost(1, 2, 3, 3)).toBe(3); // 11 / 4 = 2,75
    expect(weightedAverageCost(3, 1, 1, 2)).toBe(1); // 5 / 4 = 1,25
  });
  it('reste exact au-delà de 2^53', () => {
    const big = 1_000_000_000_000;
    expect(weightedAverageCost(2_000_000_000, big, 2_000_000_000, big)).toBe(big);
  });
});

describe('poNumber', () => {
  it('complète à 4 chiffres', () => {
    expect(poNumber(1)).toBe('PO-0001');
    expect(poNumber(12345)).toBe('PO-12345');
  });
});

describe('csv', () => {
  it('protège contre l\'injection de formules', () => {
    for (const bad of ['=1+1', '+33', '-2', '@SUM(A1)', '\t=x', '\r=x']) expect(csvCell(bad).replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('Riz = 5')).toBe('Riz = 5');
  });
  it('échappe virgules, guillemets et sauts de ligne', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(-5)).toBe('-5');
  });
  it('produit BOM, en-têtes et CRLF', () => {
    expect(toCsv(['a', 'b'], [['x', 1], [null, 'y,z']])).toBe('﻿a,b\r\nx,1\r\n,"y,z"\r\n');
  });
});
