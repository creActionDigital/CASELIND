import { api } from '../auth/auth-context';

/** Lot 6B : `PUT /v1/me/payment-pin {pin, password}` (création ou changement). Isolé pour suivre le contrat. */
export const setPaymentPin = (pin: string, password: string) =>
  api.request('/me/payment-pin', { method: 'PUT', body: { pin, password } });
