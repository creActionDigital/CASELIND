import {
  createdPaymentQrSchema,
  qrPayloadResponseSchema,
  paymentQrListSchema,
  payQrResponseSchema,
  resolvedPaymentQrSchema,
  type CreatePaymentQrRequest,
  type PayQrRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

/** Lot 6B : QR marchand. Isolé pour suivre le contrat. */
export const resolveQr = (payload: string) =>
  api.request('/wallet/qr/resolve', { method: 'POST', body: { payload }, schema: resolvedPaymentQrSchema });
export const payQr = (body: PayQrRequest) => api.request('/wallet/qr/pay', { method: 'POST', body, schema: payQrResponseSchema });

export const fetchPaymentQrs = (orgId: string, cursor?: string) =>
  api.request(`/orgs/${orgId}/payment-qr`, { query: { cursor, limit: 30 }, schema: paymentQrListSchema });
export const createPaymentQr = (orgId: string, body: CreatePaymentQrRequest) =>
  api.request(`/orgs/${orgId}/payment-qr`, { method: 'POST', body, schema: createdPaymentQrSchema });
export const fetchPaymentQrPayload = (orgId: string, qrId: string) =>
  api.request(`/orgs/${orgId}/payment-qr/${qrId}`, { schema: qrPayloadResponseSchema });
export const revokePaymentQr = (orgId: string, qrId: string) => api.request(`/orgs/${orgId}/payment-qr/${qrId}`, { method: 'DELETE' });
