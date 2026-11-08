import { describe, expect, it } from 'vitest';
import { isColorAxis, isSizeAxis, swatchColor } from './swatch';

describe('swatch', () => {
  it('reconnaît les axes', () => {
    expect(isColorAxis('Couleur')).toBe(true);
    expect(isSizeAxis('Taille')).toBe(true);
    expect(isSizeAxis('Matière')).toBe(false);
  });
  it('résout les teintes', () => {
    expect(swatchColor('Noir')).toBe('#111111');
    expect(swatchColor('#abc')).toBe('#abc');
    expect(swatchColor('Turquoise')).toBeNull();
  });
});
