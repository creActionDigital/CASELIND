import { describe, expect, it } from 'vitest';
import {
  barWidths,
  buildExpense,
  buildPoLine,
  buildReceipt,
  buildSupplier,
  canCancelPo,
  canReceivePo,
  canSendPo,
  emptyExpenseForm,
  emptyLineForm,
  emptySupplierForm,
  exportFileName,
  isValidDate,
  marginPercent,
  parseCostToMinor,
  parseQuantity,
  periodFor,
  poTotal,
  receiptDefaults,
  remainingQty,
} from './logic';

describe('montants et quantités', () => {
  it('lit un coût avec virgule ou point, zéro accepté', () => {
    expect(parseCostToMinor('12,50', 'USD')).toBe(1250);
    expect(parseCostToMinor('12.5', 'USD')).toBe(1250);
    expect(parseCostToMinor('0', 'USD')).toBe(0);
    expect(parseCostToMinor(' 1 000 ', 'CDF')).toBe(100000);
  });
  it('refuse négatif, décimales en trop, texte et valeur hors plage', () => {
    expect(parseCostToMinor('-1', 'USD')).toBeNull();
    expect(parseCostToMinor('1.234', 'USD')).toBeNull();
    expect(parseCostToMinor('abc', 'USD')).toBeNull();
    expect(parseCostToMinor('', 'USD')).toBeNull();
    expect(parseCostToMinor('99999999999999', 'USD')).toBeNull();
  });
  it('quantité : entier de 1 à 1 000 000', () => {
    expect(parseQuantity('12')).toBe(12);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('1.5')).toBeNull();
    expect(parseQuantity('1000001')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });
});

describe('ligne de bon de commande', () => {
  it('exige une description pour une ligne libre, pas pour un article du catalogue', () => {
    expect(buildPoLine({ ...emptyLineForm(), quantity: '2', unitCost: '1' }, 'USD')).toEqual({ error: 'description' });
    const free = buildPoLine({ variantId: '', description: ' Transport ', quantity: '1', unitCost: '50' }, 'USD');
    expect(free).toEqual({ ok: { description: 'Transport', quantity: 1, unitCostMinor: 5000 } });
    const cat = buildPoLine({ variantId: 'v1', description: 'Riz (25kg)', quantity: '10', unitCost: '0,5' }, 'USD');
    expect(cat).toEqual({ ok: { variantId: 'v1', description: 'Riz (25kg)', quantity: 10, unitCostMinor: 50 } });
  });
  it('nomme le champ invalide', () => {
    expect(buildPoLine({ variantId: 'v1', description: '', quantity: '0', unitCost: '1' }, 'USD')).toEqual({ error: 'quantity' });
    expect(buildPoLine({ variantId: 'v1', description: '', quantity: '1', unitCost: 'x' }, 'USD')).toEqual({ error: 'unitCost' });
    expect(buildPoLine({ variantId: '', description: 'x'.repeat(121), quantity: '1', unitCost: '1' }, 'USD')).toEqual({ error: 'description' });
  });
  it('total d\'affichage', () => {
    expect(poTotal([{ quantity: 10, unitCostMinor: 100 }, { quantity: 2, unitCostMinor: 151 }])).toBe(1302);
    expect(poTotal([])).toBe(0);
  });
});

describe('états du bon et réception', () => {
  it('actions autorisées par statut', () => {
    expect(canSendPo('draft')).toBe(true);
    expect(canSendPo('ordered')).toBe(false);
    expect(canReceivePo('ordered')).toBe(true);
    expect(canReceivePo('partially_received')).toBe(true);
    expect(canReceivePo('draft')).toBe(false);
    expect(canCancelPo('received')).toBe(false);
    expect(canCancelPo('cancelled')).toBe(false);
    expect(canCancelPo('partially_received')).toBe(true);
  });
  const po = {
    lines: [
      { id: 'a', quantityOrdered: 10, quantityReceived: 4 },
      { id: 'b', quantityOrdered: 2, quantityReceived: 2 },
    ],
  };
  it('reste attendu et valeurs de départ', () => {
    expect(remainingQty(po.lines[0]!)).toBe(6);
    expect(remainingQty(po.lines[1]!)).toBe(0);
    expect(receiptDefaults(po as never)).toEqual({ a: '6' });
  });
  it('construit la réception, ignore les lignes vides, refuse les dépassements', () => {
    expect(buildReceipt(po as never, { a: '3' })).toEqual({ ok: { lines: [{ lineId: 'a', quantity: 3 }] } });
    expect(buildReceipt(po as never, { a: '', b: '0' })).toEqual({ error: 'empty' });
    expect(buildReceipt(po as never, { a: '7' })).toEqual({ error: 'exceeds' });
    expect(buildReceipt(po as never, { a: '1.5' })).toEqual({ error: 'quantity' });
  });
});

describe('fournisseur', () => {
  it('valide nom, téléphone et e-mail, omet les champs vides', () => {
    expect(buildSupplier(emptySupplierForm())).toEqual({ error: 'name' });
    expect(buildSupplier({ ...emptySupplierForm(), name: 'A', phone: '0810000000' })).toEqual({ error: 'phone' });
    expect(buildSupplier({ ...emptySupplierForm(), name: 'A', email: 'pas-un-email' })).toEqual({ error: 'email' });
    expect(buildSupplier({ ...emptySupplierForm(), name: ' Régideso ', phone: '+243 81 000 0000', email: 'a@b.cd' })).toEqual({
      ok: { name: 'Régideso', phone: '+243810000000', email: 'a@b.cd' },
    });
  });
});

describe('dépenses', () => {
  const base = { ...emptyExpenseForm('2026-11-19'), amount: '15,5', category: 'rent' as const };
  it('construit la requête', () => {
    expect(buildExpense(base)).toEqual({ ok: { category: 'rent', amountMinor: 1550, currency: 'USD', spentOn: '2026-11-19' } });
    expect(buildExpense({ ...base, note: ' loyer ' })).toEqual({ ok: { category: 'rent', amountMinor: 1550, currency: 'USD', spentOn: '2026-11-19', note: 'loyer' } });
  });
  it('refuse montant nul, date impossible, note trop longue', () => {
    expect(buildExpense({ ...base, amount: '0' })).toEqual({ error: 'amount' });
    expect(buildExpense({ ...base, spentOn: '2026-02-30' })).toEqual({ error: 'date' });
    expect(buildExpense({ ...base, note: 'x'.repeat(201) })).toEqual({ error: 'note' });
  });
  it('dates civiles', () => {
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2027-02-29')).toBe(false);
    expect(isValidDate('2027-2-9')).toBe(false);
  });
});

describe('périodes et affichage', () => {
  const today = new Date(2026, 10, 19); // 19 novembre 2026, heure de l'appareil
  it('presets inclus, dans la limite de 366 jours', () => {
    expect(periodFor('month', today)).toEqual({ from: '2026-11-01', to: '2026-11-19' });
    expect(periodFor('d30', today)).toEqual({ from: '2026-10-21', to: '2026-11-19' });
    expect(periodFor('d90', today)).toEqual({ from: '2026-08-22', to: '2026-11-19' });
    expect(periodFor('year', today)).toEqual({ from: '2026-01-01', to: '2026-11-19' });
    expect(periodFor('year', new Date(2028, 11, 31))).toEqual({ from: '2028-01-01', to: '2028-12-31' });
  });
  it('barres proportionnelles, minimum 2 % pour un montant non nul', () => {
    expect(barWidths([1000, 500, 0])).toEqual([100, 50, 0]);
    expect(barWidths([1_000_000, 1])).toEqual([100, 2]);
    expect(barWidths([0, 0])).toEqual([0, 0]);
    expect(barWidths([])).toEqual([]);
  });
  it('marge en pourcentage, une décimale', () => {
    expect(marginPercent(4600, 7000)).toBe(65.7);
    expect(marginPercent(-100, 1000)).toBe(-10);
    expect(marginPercent(0, 0)).toBeNull();
  });
  it('nom de fichier', () => {
    expect(exportFileName('sales', '2026-11-01', '2026-11-19')).toBe('sales-2026-11-01-2026-11-19.csv');
  });
});
