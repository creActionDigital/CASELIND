import { kycStatusViewSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

/** Lot 6B : `GET /v1/me/kyc` (niveau, limites par devise, `hasPaymentPin`). Isolé pour suivre le contrat. */
export const fetchKyc = () => api.request('/me/kyc', { schema: kycStatusViewSchema });
