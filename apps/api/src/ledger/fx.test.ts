import { describe, expect, it } from 'vitest';
import { fxQuote, USD_TO_CDF } from './fx.js';

describe('fxQuote', () => {
  it('converts USD to CDF in integer minor units', () => {
    expect(fxQuote({ from: 'USD', to: 'CDF', amountMinor: 1050 }).convertedMinor).toBe(1050 * USD_TO_CDF);
  });
  it('rounds CDF to USD to the nearest cent and never invents money for tiny amounts', () => {
    expect(fxQuote({ from: 'CDF', to: 'USD', amountMinor: 280_000 }).convertedMinor).toBe(100);
    expect(fxQuote({ from: 'CDF', to: 'USD', amountMinor: 1000 }).convertedMinor).toBe(0);
  });
  it('same currency is identity and the quote is flagged indicative sandbox', () => {
    const q = fxQuote({ from: 'USD', to: 'USD', amountMinor: 77 });
    expect(q).toMatchObject({ convertedMinor: 77, rate: 1, indicative: true, mode: 'sandbox' });
  });
});
