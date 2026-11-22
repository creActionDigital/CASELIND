import { describe, expect, it } from 'vitest';
import {
  boostRange,
  dedupeById,
  ImpressionTracker,
  parseBoostBudget,
  parseBoostDays,
  parseTipAmount,
  seriesPoints,
  splitHashtags,
} from './logic';

describe('splitHashtags', () => {
  it('découpe le texte sans rien perdre et marque les tags en minuscules', () => {
    const text = 'Salut #Kinshasa, bienvenue à #été_26 !';
    const parts = splitHashtags(text);
    expect(parts.map((p) => p.text).join('')).toBe(text);
    expect(parts.filter((p) => p.tag).map((p) => p.tag)).toEqual(['kinshasa', 'été_26']);
  });

  it('ignore les adresses, les mots collés, les nombres et les tags trop longs', () => {
    expect(splitHashtags('https://x.test/a#frag mot#colle #123 #' + 'a'.repeat(41)).some((p) => p.tag)).toBe(false);
    expect(splitHashtags('').length).toBe(0);
    expect(splitHashtags('sans tag')).toEqual([{ text: 'sans tag' }]);
  });
});

describe('ImpressionTracker', () => {
  it('ne rapporte qu’après 1 s de visibilité continue, une seule fois', () => {
    const t = new ImpressionTracker();
    t.update(['a', 'b'], 0);
    expect(t.take(500)).toEqual([]);
    t.update(['a'], 600); // b sort de l’écran avant 1 s
    expect(t.take(1000)).toEqual(['a']);
    t.update(['a', 'b'], 1100);
    expect(t.take(2200)).toEqual(['b']);
    t.update([], 2300);
    t.update(['a'], 2400);
    expect(t.take(9000)).toEqual([]);
  });

  it('permet de rapporter de nouveau après un échec et limite un lot à 50', () => {
    const t = new ImpressionTracker();
    t.update(['a'], 0);
    const first = t.take(1000);
    t.release(first);
    t.update(['a'], 1500);
    expect(t.take(2600)).toEqual(['a']);
    const many = Array.from({ length: 120 }, (_, i) => `p${i}`);
    t.update(many, 3000);
    expect(t.take(5000)).toHaveLength(50);
    expect(t.take(5000)).toHaveLength(50);
    expect(t.take(5000)).toHaveLength(20);
  });
});

describe('fil et tableau de bord', () => {
  it('garde la première occurrence d’un id', () => {
    expect(dedupeById([{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'a', n: 3 }])).toEqual([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
  });

  it('convertit une série en points de graphique', () => {
    const d = { date: '2026-11-19', impressions: 4, uniqueViewers: 3, reactions: 1, comments: 0, newFollowers: 2 };
    expect(seriesPoints([d], 'impressions')).toEqual([{ day: '2026-11-19', value: 4 }]);
    expect(seriesPoints([d], 'newFollowers')).toEqual([{ day: '2026-11-19', value: 2 }]);
  });
});

describe('montants de test', () => {
  it('plafonne un pourboire (50,00 USD ; ×2800 en CDF)', () => {
    expect(parseTipAmount('5', 'USD')).toEqual({ minor: 500 });
    expect(parseTipAmount('50,01', 'USD')).toEqual({ issue: 'too_high' });
    expect(parseTipAmount('abc', 'USD')).toEqual({ issue: 'invalid' });
    expect(parseTipAmount('100000', 'CDF')).toEqual({ minor: 10_000_000 });
  });

  it('borne un budget de boost et ses jours', () => {
    expect(boostRange('USD')).toEqual({ min: 100, max: 10_000 });
    expect(parseBoostBudget('0.5', 'USD')).toEqual({ issue: 'too_low' });
    expect(parseBoostBudget('1', 'USD')).toEqual({ minor: 100 });
    expect(parseBoostBudget('100.01', 'USD')).toEqual({ issue: 'too_high' });
    expect(parseBoostDays('3')).toBe(3);
    expect(parseBoostDays('0')).toBeNull();
    expect(parseBoostDays('15')).toBeNull();
    expect(parseBoostDays('x')).toBeNull();
  });
});

import { completeHashtag, typingHashtag } from './logic';
describe('hashtag en cours de frappe', () => {
  it('détecte et complète', () => {
    expect(typingHashtag('salut #ma')).toBe('ma');
    expect(typingHashtag('salut ma')).toBeNull();
    expect(typingHashtag('mail a#b')).toBeNull();
    expect(completeHashtag('salut #ma', '#marché')).toBe('salut #marché ');
  });
});
