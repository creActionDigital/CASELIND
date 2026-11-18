import { describe, expect, it } from 'vitest';
import { buildReview, cleanAnswer, cleanQuestion, cleanReviewReply, feedbackError, formatAverage, ratingLabel } from './reviews-logic';

describe('formulaire d’avis', () => {
  it('exige une note de 1 à 5 et limite le texte à 500 caractères', () => {
    expect(buildReview(0, '')).toEqual({ error: 'rating' });
    expect(buildReview(6, '')).toEqual({ error: 'rating' });
    expect(buildReview(3.5, '')).toEqual({ error: 'rating' });
    expect(buildReview(4, 'x'.repeat(501))).toEqual({ error: 'body' });
    expect(buildReview(4, '  Très bien  ')).toEqual({ ok: { rating: 4, body: 'Très bien' } });
    expect(buildReview(5, '   ')).toEqual({ ok: { rating: 5, body: null } });
    expect(buildReview(5, 'x'.repeat(500))).toHaveProperty('ok');
  });
});

describe('questions et réponses', () => {
  it('refuse le vide et les textes trop longs, rogne les espaces', () => {
    expect(cleanQuestion('  Livrez-vous ?  ')).toBe('Livrez-vous ?');
    expect(cleanQuestion('   ')).toBeNull();
    expect(cleanQuestion('x'.repeat(301))).toBeNull();
    expect(cleanQuestion('x'.repeat(300))).not.toBeNull();
    expect(cleanAnswer('x'.repeat(1000))).not.toBeNull();
    expect(cleanAnswer('x'.repeat(1001))).toBeNull();
    expect(cleanReviewReply('x'.repeat(501))).toBeNull();
    expect(cleanReviewReply('Merci')).toBe('Merci');
  });
});

describe('note moyenne', () => {
  it('arrondit à une décimale avec la virgule en français', () => {
    expect(formatAverage(4.5, 'fr')).toBe('4,5');
    expect(formatAverage(3.67, 'fr')).toBe('3,7');
    expect(formatAverage(4.04, 'en')).toBe('4.0');
    expect(formatAverage(5, 'sw')).toBe('5,0');
    expect(ratingLabel({ average: 3.67, count: 3 }, 'en')).toBe('3.7 (3)');
  });
});

describe('erreurs de l’API', () => {
  it('reconnaît les refus métier', () => {
    expect(feedbackError(403, 'not_purchased')).toBe('notPurchased');
    expect(feedbackError(403, 'member')).toBe('member');
    expect(feedbackError(409, 'moderated')).toBe('moderated');
    expect(feedbackError(409, 'rate_limited')).toBe('rateLimited');
    expect(feedbackError(404, undefined)).toBe('unavailable');
    expect(feedbackError(500, undefined)).toBeNull();
    expect(feedbackError(409, 'autre')).toBeNull();
  });
});
