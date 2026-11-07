import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

// Lot 6B: KYC tiers (manual admin review), payment PIN, signed merchant QR. Sandbox only (ADR-017).

const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code');
const uuidSchema = z.uuid();

export const kycLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type KycLevel = z.infer<typeof kycLevelSchema>;
export const kycStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type KycStatus = z.infer<typeof kycStatusSchema>;
export const kycIdTypeSchema = z.enum(['national_id', 'passport', 'driver_license', 'voter_card']);
export type KycIdType = z.infer<typeof kycIdTypeSchema>;

/** Limits of one tier in one currency, in minor units. */
export const kycLimitsSchema = z.object({
  currency: currencySchema,
  maxBalanceMinor: z.number().int(),
  maxSingleTransferMinor: z.number().int(),
  maxDailyOutgoingMinor: z.number().int(),
});
export type KycLimitsView = z.infer<typeof kycLimitsSchema>;

/**
 * POST /v1/me/kyc/submissions. `documentIds` are ready uploads of purpose `kyc_document` owned by the caller, in order:
 * level 1: [identity document (image or PDF), selfie (image)]; level 2: [proof of address (image or PDF)].
 * Level 2 requires an approved level 1 and no identity fields.
 */
export const createKycSubmissionRequestSchema = z.discriminatedUnion('level', [
  z.object({
    level: z.literal(1),
    legalName: z.string().trim().min(2).max(120),
    birthDate: z.iso.date(),
    idType: kycIdTypeSchema,
    idNumber: z.string().trim().min(4).max(40),
    city: z.string().trim().min(2).max(80),
    documentIds: z.array(uuidSchema).length(2),
  }),
  z.object({
    level: z.literal(2),
    documentIds: z.array(uuidSchema).length(1),
  }),
]);
export type CreateKycSubmissionRequest = z.infer<typeof createKycSubmissionRequestSchema>;

export const kycSubmissionSchema = z.object({
  id: z.uuid(),
  level: z.union([z.literal(1), z.literal(2)]),
  status: kycStatusSchema,
  legalName: z.string().nullable(),
  birthDate: z.string().nullable(),
  idType: kycIdTypeSchema.nullable(),
  /** Only the last 4 characters of the document number are ever exposed. */
  idNumberLast4: z.string().nullable(),
  city: z.string().nullable(),
  documentIds: z.array(z.uuid()),
  decisionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type KycSubmission = z.infer<typeof kycSubmissionSchema>;

/** GET /v1/me/kyc */
export const kycStatusViewSchema = z.object({
  level: kycLevelSchema,
  pending: kycSubmissionSchema.nullable(),
  /** Most recent decided request, to tell the user why it was refused. */
  lastDecision: kycSubmissionSchema.nullable(),
  /** Limits of the current tier, per currency. */
  limits: z.array(kycLimitsSchema),
  /** Limits of the next tier (null at tier 2). */
  nextLevelLimits: z.array(kycLimitsSchema).nullable(),
  hasPaymentPin: z.boolean(),
});
export type KycStatusView = z.infer<typeof kycStatusViewSchema>;

export const adminKycSubmissionSchema = kycSubmissionSchema.extend({
  userId: z.uuid(),
  userHandle: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
  /** Document access is restricted to the owner and admins (GET contentUrl with an admin token). */
  documents: z.array(z.object({ id: z.uuid(), contentUrl: z.string() })),
});
export type AdminKycSubmission = z.infer<typeof adminKycSubmissionSchema>;

export const adminKycListQuerySchema = pageQuerySchema.extend({
  status: kycStatusSchema.optional(),
});
export type AdminKycListQuery = z.infer<typeof adminKycListQuerySchema>;

export const adminKycListSchema = z.object({
  items: z.array(adminKycSubmissionSchema),
  nextCursor: z.string().nullable(),
});
export type AdminKycList = z.infer<typeof adminKycListSchema>;

export const kycDecisionRequestSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.decision === 'approve' || v.reason !== undefined, {
    path: ['reason'],
    message: 'a reason is required to reject',
  });
export type KycDecisionRequest = z.infer<typeof kycDecisionRequestSchema>;

// --- Payment PIN ---

const isWeakPin = (pin: string): boolean => {
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return true;
  const steps = d.slice(1).map((x, i) => x - d[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  // 121212, 123123 and the like
  return pin.slice(0, 2).repeat(3) === pin || pin.slice(0, 3).repeat(2) === pin;
};

export const paymentPinSchema = z
  .string()
  .regex(/^\d{6}$/, 'must be exactly 6 digits')
  .refine((p) => !isWeakPin(p), 'too easy to guess (sequence or repetition)');

export const setPaymentPinRequestSchema = z.object({
  pin: paymentPinSchema,
  /** Account password, required to set or change the PIN. */
  password: z.string().min(1).max(200),
});
export type SetPaymentPinRequest = z.infer<typeof setPaymentPinRequestSchema>;

// --- Merchant QR ---

export const createPaymentQrRequestSchema = z
  .object({
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    currency: currencySchema,
    label: z.string().trim().min(1).max(80).optional(),
    /** 60 s to 24 h. Default: none (static QR) when no amount is set, 15 min when one is. */
    expiresInSeconds: z.number().int().min(60).max(86_400).optional(),
    /** Consumed by the first payment. Only for a fixed amount; defaults to true then. */
    singleUse: z.boolean().optional(),
  })
  .refine((v) => v.singleUse !== true || v.amountMinor !== undefined, {
    path: ['singleUse'],
    message: 'a single-use QR needs a fixed amount',
  });
export type CreatePaymentQrRequest = z.infer<typeof createPaymentQrRequestSchema>;

export const paymentQrSchema = z.object({
  qrId: z.uuid(),
  orgId: z.uuid(),
  amountMinor: z.number().int().nullable(),
  currency: currencySchema,
  label: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  singleUse: z.boolean(),
  status: z.enum(['active', 'expired', 'revoked', 'consumed']),
  createdAt: z.iso.datetime(),
});
export type PaymentQr = z.infer<typeof paymentQrSchema>;

export const createdPaymentQrSchema = paymentQrSchema.extend({
  /** Compact signed string to encode in the QR image. */
  payload: z.string(),
});
export type CreatedPaymentQr = z.infer<typeof createdPaymentQrSchema>;

export const qrPayloadResponseSchema = z.object({ payload: z.string() });
export type QrPayloadResponse = z.infer<typeof qrPayloadResponseSchema>;

export const paymentQrListSchema = z.object({
  items: z.array(paymentQrSchema),
  nextCursor: z.string().nullable(),
});
export type PaymentQrList = z.infer<typeof paymentQrListSchema>;

export const qrPayloadSchema = z.object({ payload: z.string().min(10).max(400) });
export type QrPayloadRequest = z.infer<typeof qrPayloadSchema>;

export const resolvedPaymentQrSchema = z.object({
  org: z.object({ id: z.uuid(), name: z.string(), verified: z.boolean() }),
  amountMinor: z.number().int().nullable(),
  currency: currencySchema,
  label: z.string().nullable(),
  qrId: z.uuid(),
});
export type ResolvedPaymentQr = z.infer<typeof resolvedPaymentQrSchema>;

export const payQrRequestSchema = z.object({
  clientId: z.uuid(),
  payload: z.string().min(10).max(400),
  /** Required when the QR sets no amount; ignored otherwise. */
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  pin: z.string().regex(/^\d{6}$/),
});
export type PayQrRequest = z.infer<typeof payQrRequestSchema>;

export const payQrResponseSchema = z.object({
  transferId: z.uuid(),
  replayed: z.boolean(),
  amountMinor: z.number().int(),
  currency: currencySchema,
  org: z.object({ id: z.uuid(), name: z.string() }),
});
export type PayQrResponse = z.infer<typeof payQrResponseSchema>;

/** Why a QR or a payment was refused (`details.reason`). Never more precise than this. */
export const qrRejectionReasonSchema = z.enum([
  'invalid_qr',
  'expired',
  'revoked',
  'already_used',
  'amount_required',
  'pin_not_set',
  'pin_invalid',
  'pin_locked',
  'insufficient_funds',
  'limit_exceeded',
  'account_frozen',
  'invalid_counterparty',
]);
export type QrRejectionReason = z.infer<typeof qrRejectionReasonSchema>;

/** Account export: status and dates only, never the document number nor the files. */
export const exportedKycSchema = z.object({
  level: kycLevelSchema,
  hasPaymentPin: z.boolean(),
  submissions: z.array(
    z.object({
      id: z.uuid(),
      level: z.number().int(),
      status: kycStatusSchema,
      submittedAt: z.iso.datetime(),
      decidedAt: z.iso.datetime().nullable(),
    }),
  ),
});
export type ExportedKyc = z.infer<typeof exportedKycSchema>;
