import type { Cart, StorefrontVariant } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { canCheckout, countItems, quantityOf, totalsByCurrency, withLineQuantity } from './cart-logic';
import { couponErrorKey, stockConflict } from './errors';
import { formatMoney, parseMajorToMinor } from './format';
import { canCancel, canReview, commerceTarget, mediaContentUrl, normalizePhone } from './order-logic';
import { defaultSelection, findVariant, isValueAvailable, optionAxes, selectValue } from './variants';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const variant = (n: number, options: Record<string, string>, priceMinor: number, inStock = true): StorefrontVariant => ({
  id: id(n),
  options,
  priceMinor,
  currency: 'USD',
  inStock,
});

describe('formatMoney', () => {
  it('formate selon les décimales de la devise et la langue', () => {
    expect(formatMoney(1250, 'USD', 'en')).toBe('$12.50');
    expect(formatMoney(1250, 'USD', 'fr').replace(/\s/g, ' ')).toMatch(/^12,50 \$/);
    expect(formatMoney(1500, 'JPY', 'en')).toBe('¥1,500');
  });
  it('ne plante pas sur une devise inconnue', () => {
    expect(formatMoney(100, 'ZZZ', 'en')).toContain('1.00');
  });
  it('lit une saisie en unités mineures', () => {
    expect(parseMajorToMinor('12,5', 'USD')).toBe(1250);
    expect(parseMajorToMinor('abc', 'USD')).toBeNull();
  });
});

describe('variantes', () => {
  const vs = [
    variant(1, { taille: 'S', couleur: 'rouge' }, 1000),
    variant(2, { taille: 'S', couleur: 'bleu' }, 1200, false),
    variant(3, { taille: 'M', couleur: 'rouge' }, 1100, false),
    variant(4, { taille: 'M', couleur: 'bleu' }, 1300),
  ];
  it('liste les axes', () => {
    expect(optionAxes(vs)).toEqual([
      { name: 'taille', values: ['S', 'M'] },
      { name: 'couleur', values: ['rouge', 'bleu'] },
    ]);
  });
  it('retrouve la variante d\'une sélection complète', () => {
    expect(findVariant(vs, { taille: 'M', couleur: 'bleu' })?.id).toBe(id(4));
    expect(findVariant(vs, { taille: 'M' })).toBeNull();
  });
  it('désactive les combinaisons indisponibles', () => {
    const sel = { taille: 'S', couleur: 'rouge' };
    expect(isValueAvailable(vs, sel, 'couleur', 'bleu')).toBe(false);
    expect(isValueAvailable(vs, sel, 'taille', 'M')).toBe(false);
    expect(isValueAvailable(vs, sel, 'taille', 'S')).toBe(true);
  });
  it('choisit par défaut la moins chère en stock', () => {
    expect(defaultSelection(vs)).toEqual({ taille: 'S', couleur: 'rouge' });
    expect(defaultSelection([variant(9, {}, 500, false)])).toEqual({});
  });
  it('bascule vers la variante la plus proche quand la combinaison manque', () => {
    const partial = [variant(1, { taille: 'S', couleur: 'rouge' }, 1000), variant(2, { taille: 'M', couleur: 'bleu' }, 1300)];
    expect(selectValue(partial, { taille: 'S', couleur: 'rouge' }, 'taille', 'M')).toEqual({ taille: 'M', couleur: 'bleu' });
  });
  it('gère un produit sans option', () => {
    const one = [variant(7, {}, 900)];
    expect(findVariant(one, {})?.id).toBe(id(7));
  });
});

const line = (n: number, qty: number, unit: number) => ({
  variantId: id(n),
  productId: id(100 + n),
  title: `P${n}`,
  variantLabel: null,
  sku: null,
  imageAssetId: null,
  unitPriceMinor: unit,
  quantity: qty,
  lineTotalMinor: unit * qty,
});
const cart: Cart = {
  groups: [
    { orgId: id(50), orgName: 'A', orgSlug: 'aaa', currency: 'USD', subtotalMinor: 2500, lines: [line(1, 2, 1000), line(2, 1, 500)] },
    { orgId: id(51), orgName: 'B', orgSlug: 'bbb', currency: 'USD', subtotalMinor: 300, lines: [line(3, 1, 300)] },
    { orgId: id(51), orgName: 'B', orgSlug: 'bbb', currency: 'CDF', subtotalMinor: 90000, lines: [line(4, 3, 30000)] },
  ],
  unavailable: [],
  itemCount: 7,
};

describe('panier', () => {
  it('totalise par devise', () => {
    expect(totalsByCurrency(cart.groups)).toEqual([
      { currency: 'USD', totalMinor: 2800 },
      { currency: 'CDF', totalMinor: 90000 },
    ]);
    expect(countItems(cart.groups)).toBe(7);
  });
  it('recalcule après un changement de quantité', () => {
    const next = withLineQuantity(cart, id(1), 3);
    expect(next.groups[0]!.subtotalMinor).toBe(3500);
    expect(next.itemCount).toBe(8);
    expect(quantityOf(next, id(1))).toBe(3);
  });
  it('retire la ligne et le groupe vide à 0', () => {
    const next = withLineQuantity(cart, id(3), 0);
    expect(next.groups).toHaveLength(2);
    expect(withLineQuantity(cart, id(404), 5)).toEqual(cart);
  });
  it('bloque la commande avec une ligne indisponible', () => {
    expect(canCheckout(cart)).toBe(true);
    expect(canCheckout({ ...cart, unavailable: [{ variantId: id(9), quantity: 1 }] })).toBe(false);
    expect(canCheckout({ groups: [], unavailable: [], itemCount: 0 })).toBe(false);
  });
});

describe('erreurs de commande', () => {
  it('traduit les raisons de coupon', () => {
    const e = new ApiRequestError(400, 'validation_failed', 'x', { reason: 'min_not_reached', code: 'PROMO' });
    expect(couponErrorKey(e)).toBe('checkout.coupon.min_not_reached');
    expect(couponErrorKey(new ApiRequestError(400, 'validation_failed', 'x', { reason: 'autre' }))).toBeNull();
    expect(couponErrorKey(new ApiRequestError(409, 'conflict', 'x', { reason: 'expired' }))).toBeNull();
  });
  it('extrait les variantes en conflit de stock', () => {
    const e = new ApiRequestError(409, 'conflict', 'x', { reason: 'insufficient_stock', variantIds: [id(1), 3] });
    expect(stockConflict(e)).toEqual({ reason: 'insufficient_stock', variantIds: [id(1)] });
    expect(stockConflict(new ApiRequestError(409, 'empty_cart', 'x'))).toBeNull();
  });
});

describe('commandes', () => {
  it('annulation et avis selon le statut', () => {
    expect(canCancel('pending')).toBe(true);
    expect(canCancel('confirmed')).toBe(false);
    expect(canReview('delivered')).toBe(true);
    expect(canReview('shipped')).toBe(false);
  });
  it('normalise le téléphone E.164', () => {
    expect(normalizePhone('+243 81 234 5678')).toBe('+243812345678');
    expect(normalizePhone('0812345678')).toBeNull();
  });
  it('construit l\'URL des médias', () => {
    expect(mediaContentUrl(id(1))).toBe(`/v1/media/${id(1)}/content`);
    expect(mediaContentUrl(null)).toBeNull();
  });
  it('route une notification de commande acheteur, pas celle du vendeur', () => {
    expect(commerceTarget({ orderId: id(1) })).toEqual({ pathname: '/orders/[orderId]', params: { orderId: id(1) } });
    expect(commerceTarget({ orderId: id(1), orgId: id(2) })).toBeNull();
    expect(commerceTarget(null)).toBeNull();
  });
});
