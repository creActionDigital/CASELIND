import { describe, expect, it } from 'vitest';
import { factsFromText } from './ai-description-facts';

describe('factsFromText', () => {
  it('découpe par ligne ou point-virgule et borne', () => {
    expect(factsFromText('Coton ; Taille M\n\n Bleu ')).toEqual(['Coton', 'Taille M', 'Bleu']);
    expect(factsFromText(Array.from({ length: 12 }, (_, i) => `f${i}`).join('\n'))).toHaveLength(10);
    expect(factsFromText('   ')).toEqual([]);
  });
});
