import type { FxQuote, FxQuoteQuery } from '@caselind/contracts';

/** shortcut: fixed indicative rate (no market feed), replace by a rates provider when a partner is chosen. */
export const USD_TO_CDF = 2800;

/** Integer minor units: both currencies have 2 decimals, so only the rate scales the amount. */
export function fxQuote(q: FxQuoteQuery, now = new Date()): FxQuote {
  const rate = q.from === q.to ? 1 : q.from === 'USD' ? USD_TO_CDF : 1 / USD_TO_CDF;
  const convertedMinor = q.from === q.to ? q.amountMinor : q.from === 'USD' ? q.amountMinor * USD_TO_CDF : Math.round(q.amountMinor / USD_TO_CDF);
  return { mode: 'sandbox', indicative: true, from: q.from, to: q.to, amountMinor: q.amountMinor, convertedMinor, rate, asOf: now.toISOString() };
}
