import { fxQuoteSchema, type FxQuote } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchFxQuote = (from: string, to: string, amountMinor: number): Promise<FxQuote> =>
  api.request('/wallet/fx-quote', { query: { from, to, amountMinor }, schema: fxQuoteSchema });
