import { describe, expect, it } from 'vitest';
import { dayToIso, toCouponRequest, validateCoupon, type CouponDraft } from './coupon-form';
import { formatMinor, minorToDecimalString, parseDecimalToMinor } from './money';
import { allowedNext, sortNewestFirst } from './order-flow';
import { can, canAdjustStock } from './permissions';
import { hasErrors, moveItem, toVariantInput, validateVariants, type VariantDraft } from './variants';

const draft = (o: Partial<VariantDraft> = {}): VariantDraft => ({
  key: 'k',
  sku: 'SKU-1',
  options: [],
  price: '12,50',
  currency: 'USD',
  stock: '3',
  trackStock: true,
  active: true,
  ...o,
});

describe('money', () => {
  it('parses decimals into minor units', () => {
    expect(parseDecimalToMinor('12,50', 'USD')).toBe(1250);
    expect(parseDecimalToMinor('12.5', 'USD')).toBe(1250);
    expect(parseDecimalToMinor(' 7 ', 'CDF')).toBe(700);
    expect(parseDecimalToMinor('1 000.05', 'USD')).toBe(100005);
    expect(parseDecimalToMinor('0.10', 'USD')).toBe(10);
  });
  it('honours zero-decimal currencies', () => {
    expect(parseDecimalToMinor('500', 'XAF')).toBe(500);
    expect(parseDecimalToMinor('500.5', 'XAF')).toBeNull();
  });
  it('rejects invalid input', () => {
    for (const bad of ['', 'abc', '-1', '0', '0,00', '1.234', '1.2.3', '1e3', '99999999999999']) {
      expect(parseDecimalToMinor(bad, 'USD')).toBeNull();
    }
  });
  it('round-trips minor units', () => {
    expect(minorToDecimalString(1250, 'USD')).toBe('12.50');
    expect(minorToDecimalString(5, 'USD')).toBe('0.05');
    expect(minorToDecimalString(500, 'XAF')).toBe('500');
    expect(parseDecimalToMinor(minorToDecimalString(123456, 'CDF'), 'CDF')).toBe(123456);
  });
  it('formats without throwing', () => {
    expect(formatMinor(1250, 'USD', 'en')).toContain('12.50');
  });
});

describe('order transitions', () => {
  it('offers only the allowed next statuses', () => {
    expect(allowedNext('pending', 'owner')).toEqual(['confirmed', 'cancelled']);
    expect(allowedNext('preparing', 'manager')).toEqual(['shipped', 'cancelled']);
    expect(allowedNext('shipped', 'sales')).toEqual(['delivered']);
    expect(allowedNext('delivered', 'owner')).toEqual([]);
    expect(allowedNext('cancelled', 'owner')).toEqual([]);
  });
  it('offers nothing to roles without orders.manage', () => {
    for (const role of ['finance', 'support', 'stock', 'delivery', 'employee'] as const) {
      expect(allowedNext('pending', role)).toEqual([]);
    }
    expect(allowedNext('pending', undefined)).toEqual([]);
  });
  it('puts pending orders first, then newest', () => {
    const sorted = sortNewestFirst([
      { id: 'a', status: 'confirmed' as const, createdAt: '2026-11-05T10:00:00Z' },
      { id: 'b', status: 'pending' as const, createdAt: '2026-11-01T10:00:00Z' },
      { id: 'c', status: 'pending' as const, createdAt: '2026-11-03T10:00:00Z' },
    ]);
    expect(sorted.map((o) => o.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('role permissions', () => {
  it('maps catalog, orders and stock rights', () => {
    expect(can('sales', 'catalog.manage')).toBe(true);
    expect(can('stock', 'catalog.manage')).toBe(false);
    expect(canAdjustStock('stock')).toBe(true);
    expect(canAdjustStock('finance')).toBe(false);
    expect(can('finance', 'orders.view')).toBe(true);
    expect(can('finance', 'orders.manage')).toBe(false);
  });
});

describe('variant validation', () => {
  it('accepts a valid variant', () => {
    expect(hasErrors(validateVariants([draft({ options: [{ name: 'taille', value: 'M' }] })]))).toBe(false);
  });
  it('flags sku, price and stock', () => {
    const [e] = validateVariants([draft({ sku: ' ', price: 'x', stock: '-2' })]);
    expect(e).toEqual({ sku: 'sku_required', price: 'price_invalid', stock: 'stock_invalid' });
  });
  it('flags duplicate SKUs on the later variant only (case-insensitive)', () => {
    const errs = validateVariants([draft({ key: '1' }), draft({ key: '2', sku: 'sku-1' })]);
    expect(errs[0].sku).toBeUndefined();
    expect(errs[1].sku).toBe('sku_duplicate');
  });
  it('flags incomplete and duplicate options', () => {
    expect(validateVariants([draft({ options: [{ name: 'taille', value: '' }] })])[0].options).toBe('option_incomplete');
    expect(
      validateVariants([draft({ options: [{ name: 'Taille', value: 'M' }, { name: 'taille', value: 'L' }] })])[0].options,
    ).toBe('option_duplicate');
  });
  it('ignores the initial stock of existing variants', () => {
    expect(validateVariants([draft({ id: 'v1', stock: 'oops' })])[0].stock).toBeUndefined();
    expect(toVariantInput(draft({ id: 'v1' }))).not.toHaveProperty('stock');
  });
  it('builds the API payload in minor units', () => {
    expect(toVariantInput(draft({ options: [{ name: ' couleur ', value: 'rouge' }, { name: '', value: '' }] }))).toEqual({
      sku: 'SKU-1',
      options: { couleur: 'rouge' },
      priceMinor: 1250,
      currency: 'USD',
      stock: 3,
      trackStock: true,
      active: true,
    });
    expect(toVariantInput(draft({ price: '' }))).toBeNull();
  });
});

describe('moveItem', () => {
  it('reorders without mutating', () => {
    const src = ['a', 'b', 'c'];
    expect(moveItem(src, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(src, 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(src, 0, 9)).toEqual(['a', 'b', 'c']);
    expect(src).toEqual(['a', 'b', 'c']);
  });
});

describe('coupon form', () => {
  const base: CouponDraft = { code: 'BIENVENUE', kind: 'percent', value: '10', currency: 'USD', min: '', startsAt: '', endsAt: '', maxUses: '', maxUsesPerUser: '' };
  it('accepts a minimal percent coupon', () => {
    expect(validateCoupon(base)).toEqual({});
    expect(toCouponRequest(base)).toEqual({ code: 'BIENVENUE', kind: 'percent', value: 10, minOrderMinor: 0 });
  });
  it('rejects out-of-range percentages and bad codes', () => {
    expect(validateCoupon({ ...base, value: '95' }).value).toBe('range');
    expect(validateCoupon({ ...base, value: 'x' }).value).toBe('invalid');
    expect(validateCoupon({ ...base, code: 'a b' }).code).toBe('invalid');
  });
  it('converts fixed amounts and minimum to minor units', () => {
    const d: CouponDraft = { ...base, kind: 'fixed', value: '2,50', min: '20', maxUses: '5' };
    expect(toCouponRequest(d)).toEqual({ code: 'BIENVENUE', kind: 'fixed', value: 250, currency: 'USD', minOrderMinor: 2000, maxUses: 5 });
  });
  it('validates dates', () => {
    expect(dayToIso('2026-02-30', false)).toBeNull();
    expect(validateCoupon({ ...base, startsAt: '2026-12-10', endsAt: '2026-12-01' }).endsAt).toBe('range');
    expect(validateCoupon({ ...base, startsAt: '10/12/2026' }).startsAt).toBe('invalid');
  });
});
