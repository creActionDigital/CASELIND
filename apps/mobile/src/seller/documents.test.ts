import { describe, expect, it } from 'vitest';
import { nextStatuses, toDocumentRequest, type DocumentDraft } from './documents';

const base: DocumentDraft = { kind: 'quote', customerName: ' Awa ', customerContact: '', currency: 'USD', lines: [{ description: 'Coupe', quantity: '2', price: '12,50' }] };

describe('toDocumentRequest', () => {
  it('converts a valid form to minor units', () => {
    expect(toDocumentRequest(base)).toEqual({ kind: 'quote', customerName: 'Awa', customerContact: '', currency: 'USD', lines: [{ description: 'Coupe', quantity: 2, unitPriceMinor: 1250 }] });
  });
  it('refuses missing customer, bad quantity, bad price or no line', () => {
    expect(toDocumentRequest({ ...base, customerName: ' ' })).toBeNull();
    expect(toDocumentRequest({ ...base, lines: [{ description: 'x', quantity: '0', price: '1' }] })).toBeNull();
    expect(toDocumentRequest({ ...base, lines: [{ description: 'x', quantity: '1.5', price: '1' }] })).toBeNull();
    expect(toDocumentRequest({ ...base, lines: [{ description: 'x', quantity: '1', price: 'abc' }] })).toBeNull();
    expect(toDocumentRequest({ ...base, lines: [] })).toBeNull();
  });
});

describe('nextStatuses', () => {
  it('follows the quote and invoice paths; final states have none', () => {
    expect(nextStatuses('quote', 'draft')).toEqual(['sent', 'cancelled']);
    expect(nextStatuses('quote', 'sent')).toEqual(['accepted', 'cancelled']);
    expect(nextStatuses('invoice', 'sent')).toEqual(['paid', 'cancelled']);
    expect(nextStatuses('invoice', 'paid')).toEqual([]);
  });
});
