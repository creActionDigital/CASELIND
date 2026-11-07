import {
  challengeResponseSchema,
  kycSubmissionSchema,
  qrApproveResponseSchema,
  totpEnableResponseSchema,
  totpSetupResponseSchema,
  type CreateKycSubmissionRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const totpSetup = () => api.request('/me/2fa/totp/setup', { method: 'POST', schema: totpSetupResponseSchema });
export const totpEnable = (code: string, password: string) =>
  api.request('/me/2fa/totp/enable', { method: 'POST', body: { code, password }, schema: totpEnableResponseSchema });
export const totpDisable = (input: { password: string; code?: string; backupCode?: string }) =>
  api.request('/me/2fa/totp/disable', { method: 'POST', body: input });

export const requestIdentifierChange = (newIdentifier: string, password: string) =>
  api.request('/me/identifier-change', {
    method: 'POST',
    body: { newIdentifier: newIdentifier.trim(), password },
    schema: challengeResponseSchema,
  });
export const verifyIdentifierChange = (challengeId: string, code: string) =>
  api.request('/me/identifier-change/verify', { method: 'POST', body: { challengeId, code } });

export const qrPreview = (qrPayload: string) =>
  api.request('/auth/qr/approve', { method: 'POST', body: { qrPayload, confirm: false }, schema: qrApproveResponseSchema });
export const qrApprove = (qrPayload: string) =>
  api.request('/auth/qr/approve', { method: 'POST', body: { qrPayload, confirm: true }, schema: qrApproveResponseSchema });

export const submitKyc = (body: CreateKycSubmissionRequest) =>
  api.request('/me/kyc/submissions', { method: 'POST', body, schema: kycSubmissionSchema });
