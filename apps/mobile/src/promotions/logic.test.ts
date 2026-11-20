import { describe, expect, it } from 'vitest';
import { buildPromotion, countdown, discountPercent, emptyPromotionForm, type PromotionForm } from './logic';

describe('pourcentage affiché', () => {
  it('arrondit et reste entre 1 et 99', () => {
    expect(discountPercent(10_000, 8_000)).toBe(20);
    expect(discountPercent(3_000, 2_000)).toBe(33);
    expect(discountPercent(10_000, 9_999)).toBe(1);
    expect(discountPercent(10_000, 1)).toBe(99);
  });
  it('ne montre rien sans vraie réduction', () => {
    expect(discountPercent(null, 100)).toBeNull();
    expect(discountPercent(undefined, 100)).toBeNull();
    expect(discountPercent(100, 100)).toBeNull();
    expect(discountPercent(100, 150)).toBeNull();
  });
});

describe('compte à rebours', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  it('affiche jours et HH:MM:SS', () => {
    expect(countdown('2026-11-22T13:12:05Z', now)).toEqual({ days: 2, clock: '03:12:05' });
    expect(countdown('2026-11-20T10:00:59Z', now)).toEqual({ days: 0, clock: '00:00:59' });
    expect(countdown('2026-11-20T10:00:00.400Z', now)).toEqual({ days: 0, clock: '00:00:01' });
  });
  it('est nul une fois la fin atteinte ou la date invalide', () => {
    expect(countdown('2026-11-20T10:00:00Z', now)).toBeNull();
    expect(countdown('2026-11-19T10:00:00Z', now)).toBeNull();
    expect(countdown('pas une date', now)).toBeNull();
  });
});

describe('formulaire de promotion', () => {
  const now = new Date(2026, 10, 20, 10, 0).getTime();
  const base: PromotionForm = { ...emptyPromotionForm(), productId: 'p1', value: '20', label: 'Soldes', endsAt: '2026-11-25 18:00' };

  it('construit la requête sans jamais envoyer de prix calculé', () => {
    const r = buildPromotion(base, now);
    expect(r).toEqual({ ok: { productId: 'p1', variantId: null, kind: 'percent', value: 20, label: 'Soldes', endsAt: new Date(2026, 10, 25, 18, 0).toISOString() } });
  });
  it('lit un prix fixe dans la devise, un plafond et une variante', () => {
    const r = buildPromotion({ ...base, kind: 'fixed_price', value: '7,50', variantId: 'v1', stockCap: '30', startsAt: '2026-11-21 08:00', basePriceMinor: 1000 }, now);
    expect(r).toMatchObject({ ok: { kind: 'fixed_price', value: 750, variantId: 'v1', stockCap: 30, startsAt: new Date(2026, 10, 21, 8, 0).toISOString() } });
  });
  it('refuse ce que le serveur refuserait', () => {
    expect(buildPromotion({ ...base, productId: '' }, now)).toEqual({ error: 'product' });
    expect(buildPromotion({ ...base, label: ' ' }, now)).toEqual({ error: 'label' });
    expect(buildPromotion({ ...base, label: 'x'.repeat(41) }, now)).toEqual({ error: 'label' });
    expect(buildPromotion({ ...base, value: '95' }, now)).toEqual({ error: 'value' });
    expect(buildPromotion({ ...base, value: '0' }, now)).toEqual({ error: 'value' });
    expect(buildPromotion({ ...base, value: 'abc' }, now)).toEqual({ error: 'value' });
    expect(buildPromotion({ ...base, kind: 'fixed_price', value: '10', basePriceMinor: 1000 }, now)).toEqual({ error: 'valueFixed' });
    expect(buildPromotion({ ...base, kind: 'fixed_price', value: '1.234' }, now)).toEqual({ error: 'value' });
    expect(buildPromotion({ ...base, endsAt: '' }, now)).toEqual({ error: 'endsAt' });
    expect(buildPromotion({ ...base, endsAt: '25/11/2026' }, now)).toEqual({ error: 'endsAt' });
    expect(buildPromotion({ ...base, startsAt: 'demain' }, now)).toEqual({ error: 'startsAt' });
    expect(buildPromotion({ ...base, startsAt: '2026-11-26 08:00' }, now)).toEqual({ error: 'endBeforeStart' });
    expect(buildPromotion({ ...base, endsAt: '2026-12-25 18:00' }, now)).toEqual({ error: 'tooLong' });
    expect(buildPromotion({ ...base, endsAt: '2026-11-20 09:00', startsAt: '2026-11-19 09:00' }, now)).toEqual({ error: 'past' });
    expect(buildPromotion({ ...base, stockCap: '0' }, now)).toEqual({ error: 'cap' });
    expect(buildPromotion({ ...base, stockCap: '1.5' }, now)).toEqual({ error: 'cap' });
  });
});
