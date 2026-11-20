import { describe, expect, it } from 'vitest';
import { parseRefinement, mergeRefinement, withCurrency } from '../search/natural-search.service.js';
import { EMPTY_FILTERS } from '../search/natural-query.js';
import { aiActionsEnabled, coordinatesFromUser, parseModelReply, textFromUser, validateProposal } from './ai-actions.logic.js';

describe('parseModelReply', () => {
  it('extracts valid proposals and strips the block', () => {
    const r = parseModelReply('Je cherche.\n<actions>[{"tool":"open_screen","args":{"path":"/cart"},"label":"  Ouvrir\\n le panier "}]</actions>');
    expect(r.text).toBe('Je cherche.');
    expect(r.proposals).toEqual([{ tool: 'open_screen', args: { path: '/cart' }, label: 'Ouvrir le panier' }]);
    expect(r.ignoredTools).toEqual([]);
  });

  it('ignores unknown tools, extra keys, bad JSON and anything beyond three', () => {
    const open = (p: string) => ({ tool: 'open_screen', args: { path: p } });
    const r = parseModelReply(`x<actions>${JSON.stringify([{ tool: 'transfer_money', args: { amount: 1 } }, { tool: 'open_screen', args: { path: '/cart', x: 1 } }, open('/cart'), open('/orders'), open('/wallet'), open('/search')])}</actions><actions>nope</actions>`);
    expect(r.proposals.map((p) => p.args.path)).toEqual(['/cart', '/orders', '/wallet']);
    expect(r.ignoredTools).toEqual(['unknown', 'open_screen', 'open_screen', 'unknown']);
    expect(validateProposal(null)).toBeNull();
    expect(validateProposal({ tool: 'open_screen', args: { path: '/admin' } })).toBeNull();
  });
});

describe('guards on what the user wrote', () => {
  it('summarises only text found in the message (whitespace and case ignored)', () => {
    expect(textFromUser('le marché ouvre', 'Résume : Le  marché\nouvre à 7 h')).toBe(true);
    expect(textFromUser('autre chose', 'Résume : le marché ouvre')).toBe(false);
  });
  it('uses coordinates only when both appear in the message', () => {
    expect(coordinatesFromUser(-1.6585, 29.2205, 'je suis à -1,6585 ; 29.2205')).toBe(true);
    expect(coordinatesFromUser(-1.6585, 29.2205, 'je suis à Goma')).toBe(false);
    expect(coordinatesFromUser(10, 10, 'rendez-vous à 10 h')).toBe(false);
  });
});

describe('emergency stop', () => {
  it('env wins; unset means on outside production and the flag in production', () => {
    expect(aiActionsEnabled({ envFlag: false, production: false, flagOn: true })).toBe(false);
    expect(aiActionsEnabled({ envFlag: true, production: true, flagOn: false })).toBe(true);
    expect(aiActionsEnabled({ envFlag: undefined, production: false, flagOn: false })).toBe(true);
    expect(aiActionsEnabled({ envFlag: undefined, production: true, flagOn: false })).toBe(false);
    expect(aiActionsEnabled({ envFlag: undefined, production: true, flagOn: true })).toBe(true);
  });
});

describe('natural search refinement', () => {
  it('accepts only the schema, from a fenced answer', () => {
    expect(parseRefinement('```json\n{"city":"Goma","categorySlug":"mode"}\n```')).toEqual({ city: 'Goma', categorySlug: 'mode' });
    expect(parseRefinement('{"sql":"x"}')).toBeUndefined();
    expect(parseRefinement('{"categorySlug":"armes"}')).toBeUndefined();
    expect(parseRefinement('rien')).toBeUndefined();
  });
  it('lets the rules win and fills the gaps', () => {
    const base = { ...EMPTY_FILTERS, city: 'Bukavu', maxPriceMinor: 2000 };
    const merged = mergeRefinement(base, { city: 'Paris', maxPriceMinor: 1, categorySlug: 'mode', keywords: 'sandales' });
    expect(merged).toMatchObject({ city: 'Bukavu', maxPriceMinor: 2000, categorySlug: 'mode', keywords: 'sandales' });
    expect(withCurrency(merged).currency).toBe('USD');
    expect(withCurrency(EMPTY_FILTERS).currency).toBeNull();
  });
});
