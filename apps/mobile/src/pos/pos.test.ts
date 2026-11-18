import type { PosTicket } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { parseCashMinor, ticketText } from './logic';

describe('parseCashMinor', () => {
  it('accepts zero and decimals, refuses junk and negatives', () => {
    expect(parseCashMinor('0', 'USD')).toBe(0);
    expect(parseCashMinor(' 0,00 ', 'USD')).toBe(0);
    expect(parseCashMinor('25', 'USD')).toBe(2500);
    expect(parseCashMinor('12,5', 'CDF')).toBe(1250);
    expect(parseCashMinor('', 'USD')).toBeNull();
    expect(parseCashMinor('-3', 'USD')).toBeNull();
    expect(parseCashMinor('abc', 'USD')).toBeNull();
  });
});

describe('ticketText', () => {
  const ticket: PosTicket = {
    shop: { name: 'Boutique Soleil', address: '12 av. du Commerce', phone: null },
    sale: { id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f', currency: 'USD', totalMinor: 3500, paymentMethod: 'cash', createdAt: '2026-11-18T10:00:00.000Z', voidedAt: null, lines: [{ title: 'Savon', variantLabel: 'Citron', quantity: 2, unitPriceMinor: 1250 }, { title: 'Eau', variantLabel: null, quantity: 1, unitPriceMinor: 1000 }] },
  };
  const labels = { total: 'Total', mode: 'Mode', modeName: 'Espèces', voided: 'ANNULÉE' };
  it('prints header, lines, total and method; skips empty header fields', () => {
    const text = ticketText(ticket, labels, 'en');
    expect(text.split('\n').slice(0, 2)).toEqual(['Boutique Soleil', '12 av. du Commerce']);
    expect(text).toContain('Savon (Citron)');
    expect(text).toContain('2 x $12.50 = $25.00');
    expect(text).toContain('Total : $35.00');
    expect(text).toContain('Mode : Espèces');
    expect(text).not.toContain('ANNULÉE');
  });
  it('flags a voided sale', () => {
    expect(ticketText({ ...ticket, sale: { ...ticket.sale, voidedAt: '2026-11-18T11:00:00.000Z' } }, labels, 'en')).toContain('ANNULÉE');
  });
});
